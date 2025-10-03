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

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_ID;

// Lista de usuários autorizados
const authorizedUsers = [
  process.env.MY_NUMBER.replace('+', ''),
];

// Função para enviar WhatsApp
async function sendWhatsApp(to, text) {
  if (!text) return;
  try {
    await axios.post(
      `https://graph.facebook.com/v21.0/${PHONE_ID}/messages`,
      { messaging_product: "whatsapp", to, text: { body: text } },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
    );
    console.log("📤 Mensagem enviada:", text);
  } catch (err) {
    console.error("❌ Erro ao enviar WhatsApp:", err.response?.data || err.message);
  }
}

// Função principal do webhook
export async function chat(req, res) {
  try {
    const body = req.body;
    if (!body.object) return res.sendStatus(400);

    const entry = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!entry) return res.sendStatus(200);

    const from = entry.from;
    console.log("Número recebido do WhatsApp:", from);

    if (!authorizedUsers.includes(from)) {
      console.log("❌ Usuário não autorizado:", from);
      return res.sendStatus(200);
    }

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

    if (!userMessage?.trim()) {
      console.log("Mensagem sem conteúdo válido, ignorando.");
      return res.sendStatus(200);
    }

    // ===== Salvar no histórico =====
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
      const cityMatch = userMessage.match(/como está o tempo em (.+)\??/i);
      const city = cityMatch[1];
      responseText = await getWeather(city);
    } else {
      // ===== Lembretes =====
  const lembreteRegex = /lembre-me de (.+) (em|para|às) (.+)/i;
  if (lembreteRegex.test(userMessage)) {
    const match = userMessage.match(lembreteRegex);
    const text = match[1];
    const dateStr = match[3];
    const date = new Date(dateStr);

    if (isNaN(date)) {
      responseText = "❌ Não consegui entender a data/hora do lembrete. Use formato: 'Lembre-me de reunião em 2025-09-18 14:00'";
    } else {
      await Reminder.create({ from, text, date });
      responseText = `✅ Lembrete salvo: "${text}" para ${date.toLocaleString('pt-BR')}`;
    }
  } else {
    // ===== Histórico curto e memória =====
    const history = await Conversation.find({ from }).sort({ createdAt: 1 });
    const conversationContext = history
      .filter(h => h.content)
      .map(h => `${h.role === 'user' ? 'Usuário' : 'Assistente'}: ${h.content}`)
      .join("\n");

    let memoryContext = "";
    let relevantMemories = [];

    // ===== Patch: detectar temas emocionais e forçar busca semântica =====
    if (/terapia|psic[oó]logo|ansiedade|emoções|emocional|sentimentos/i.test(userMessage)) {
      relevantMemories = await getRelevantMemory(from, "terapia", 5);
    } else {
      relevantMemories = await getRelevantMemory(from, userMessage, 5);
    }

    memoryContext = relevantMemories
      .filter(m => m.content)
      .map(m => `${m.role === 'user' ? 'Usuário' : 'Assistente'}: ${m.content}`)
      .join("\n");

    // ===== Chamada GPT com contexto =====
    import { getDonnaResponse } from '../services/getDonnaResponse.js';
    responseText = await getDonnaResponse(userMessage, from, conversationContext, memoryContext);
  }
}

    await Conversation.create({ from, role: 'assistant', content: responseText });
    await saveMemory(from, 'assistant', responseText);
    await Message.create({ from, body: userMessage, response: responseText });

    await sendWhatsApp(from, responseText);
    res.sendStatus(200);

  } catch (error) {
    console.error("❌ Erro no webhook:", error.response?.data || error.message);
    res.sendStatus(500);
  }
}

// ===== Cron job para lembretes =====
cron.schedule('* * * * *', async () => {
  const now = new Date();
  const reminders = await Reminder.find({ date: { $lte: now } });
  for (const r of reminders) {
    await sendWhatsApp(r.from, `⏰ Lembrete: ${r.text} (agendado para ${r.date.toLocaleString('pt-BR')})`);
    await Reminder.findByIdAndDelete(r._id);
  }
});
