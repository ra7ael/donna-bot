// Importações
import 'dotenv/config';
import express from 'express';
import axios from 'axios';
import fs from 'fs';
import FormData from 'form-data';
import cron from 'node-cron';
import { DateTime } from 'luxon';

import { getGPTResponse } from '../services/gptService.js';
import Message from '../models/Message.js';
import Reminder from '../models/Reminder.js';
import Conversation from '../models/Conversation.js';
import { saveMemory, getRelevantMemory } from '../utils/memory.js';
import { getWeather } from '../utils/weather.js';

const router = express.Router();
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_ID;

// Lista de usuários autorizados
const authorizedUsers = [process.env.MY_NUMBER.replace('+', '')];

// ================= Função de envio com limite =================
async function sendWhatsApp(to, text) {
  if (!text) return;
  // Trunca mensagens acima de 400 caracteres
  const CHUNK_SIZE = 400;
  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    const chunk = text.substring(i, i + CHUNK_SIZE);
    try {
      await axios.post(
        `https://graph.facebook.com/v21.0/${PHONE_ID}/messages`,
        { messaging_product: "whatsapp", to, text: { body: chunk } },
        { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
      );
      console.log("📤 Mensagem enviada:", chunk);
    } catch (err) {
      console.error("❌ Erro ao enviar WhatsApp:", err.response?.data || err.message);
    }
  }
}

// ================= GET webhook =================
router.get('/', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verificado com sucesso!');
    return res.status(200).send(challenge);
  }
  console.log('❌ Verificação de webhook falhou');
  res.sendStatus(403);
});

// ================= POST webhook =================
router.post('/', async (req, res) => {
  try {
    const body = req.body;
    if (!body.object) return res.sendStatus(400);

    const entry = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!entry) return res.sendStatus(200);

    const from = entry.from;
    console.log("Número recebido do WhatsApp:", from);
    if (!authorizedUsers.includes(from)) return res.sendStatus(200);

    let userMessage = "";
    let mediaUrl = null;

    // ===== Processar mensagens =====
    if (entry.type === 'text') {
      userMessage = entry.text?.body || "";

    } else if (entry.type === 'audio') {
      try {
        const mediaId = entry.audio.id;
        const mediaRes = await axios.get(
          `https://graph.facebook.com/v21.0/${mediaId}`,
          { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
        );
        mediaUrl = mediaRes.data.url;

        const audioData = await axios.get(mediaUrl, { responseType: 'arraybuffer', headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } });
        fs.writeFileSync('/tmp/audio.ogg', audioData.data);

        const form = new FormData();
        form.append('file', fs.createReadStream('/tmp/audio.ogg'));
        form.append('model', 'whisper-1');

        const whisperRes = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
          headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, ...form.getHeaders() }
        });

        userMessage = whisperRes.data?.text || "";
        console.log("🎙️ Transcrição de áudio:", userMessage);

      } catch (err) {
        console.error("❌ Erro no processamento de áudio:", err.response?.data || err.message);
        userMessage = "❌ Não consegui processar seu áudio. Envie como texto.";
      } finally {
        try { fs.unlinkSync('/tmp/audio.ogg'); } catch(e) {}
      }

    } else if (entry.type === 'image') {
      try {
        const mediaId = entry.image.id;
        const mediaRes = await axios.get(
          `https://graph.facebook.com/v21.0/${mediaId}`,
          { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
        );
        mediaUrl = mediaRes.data.url;
        userMessage = "📷 Imagem recebida. Analisando...";
      } catch (err) {
        console.error("❌ Erro no processamento de imagem:", err.response?.data || err.message);
        userMessage = "❌ Não consegui processar sua imagem.";
      }
    } else {
      await sendWhatsApp(from, "❌ Tipo de mensagem não suportado. Envie texto ou áudio.");
      return res.sendStatus(200);
    }

    if (!userMessage?.trim()) return res.sendStatus(200);

    // ===== Salvar histórico e memória =====
    await Conversation.create({ from, role: 'user', content: userMessage });
    await saveMemory(from, 'user', userMessage);

    const now = DateTime.now().setZone('America/Sao_Paulo');
    const currentTime = now.toFormat('HH:mm:ss');
    const currentDate = now.toFormat('dd/MM/yyyy');

    let responseText = "";

    // ===== Comandos especiais: hora, data e clima =====
    if (/que horas são\??/i.test(userMessage)) {
      responseText = `🕒 Agora são ${currentTime}`;
    } else if (/qual a data( de hoje)?\??/i.test(userMessage)) {
      responseText = `📅 Hoje é ${currentDate}`;
    } else if (/como está o tempo em (.+)\??/i.test(userMessage)) {
      const city = userMessage.match(/como está o tempo em (.+)\??/i)[1];
      responseText = await getWeather(city);
    } else {
      // ===== Lembretes =====
      const lembreteRegex = /lembre-me de (.+) (em|para|às) (.+)/i;
      if (lembreteRegex.test(userMessage)) {
        const [_, text, __, dateStr] = userMessage.match(lembreteRegex);
        const date = new Date(dateStr);

        if (isNaN(date)) {
          responseText = "❌ Não consegui entender a data/hora do lembrete. Use formato: 'Lembre-me de reunião em 2025-09-18 14:00'";
        } else {
          await Reminder.create({ from, text, date });
          responseText = `✅ Lembrete salvo: "${text}" para ${date.toLocaleString('pt-BR')}`;
        }
      } else {
        // ===== Histórico e memória relevantes =====
        const history = await Conversation.find({ from }).sort({ createdAt: 1 });
        const conversationContext = history.map(h => `${h.role === 'user' ? 'Usuário' : 'Assistente'}: ${h.content}`).join("\n");

        const relevantMemories = await getRelevantMemory(from, userMessage, 5);
        const memoryContext = relevantMemories.map(m => `${m.role === 'user' ? 'Usuário' : 'Assistente'}: ${m.content}`).join("\n");

        // ===== Chamada GPT =====
        responseText = await getGPTResponse(
          `Hora e data atuais: ${currentTime} do dia ${currentDate}.
Histórico recente:
${conversationContext}

Histórico de memória relevante:
${memoryContext}

Mensagem do usuário: "${userMessage}"`,
          mediaUrl,
          from,
          from
        );
      }
    }

    // ===== Salvar resposta =====
    await Conversation.create({ from, role: 'assistant', content: responseText });
    await saveMemory(from, 'assistant', responseText);
    await Message.create({ from, body: userMessage, response: responseText });

    // ===== Enviar resposta com limite =====
    await sendWhatsApp(from, responseText);

    res.sendStatus(200);

  } catch (error) {
    console.error("❌ Erro no webhook:", error.response?.data || error.message);
    res.sendStatus(500);
  }
});

// ===== Cron job para lembretes =====
cron.schedule('* * * * *', async () => {
  const now = new Date();
  const reminders = await Reminder.find({ date: { $lte: now } });
  for (const r of reminders) {
    await sendWhatsApp(r.from, `⏰ Lembrete: ${r.text} (agendado para ${r.date.toLocaleString('pt-BR')})`);
    await Reminder.findByIdAndDelete(r._id);
  }
});

export default router;
