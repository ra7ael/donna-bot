require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const cron = require('node-cron');
const { DateTime } = require('luxon');

const router = express.Router();

const { getGPTResponse } = require('../services/gptService');
const Message = require('../models/Message');
const Reminder = require('../models/Reminder');
const Conversation = require('../models/Conversation');
const { saveMemory, getRelevantMemory } = require('../utils/memory');

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const MY_NUMBER = process.env.MY_NUMBER;

// ===== GET webhook (verificação) =====
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('✅ Webhook verificado com sucesso!');
      res.status(200).send(challenge);
    } else {
      console.log('❌ Token de verificação inválido');
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
});

// ===== Função para enviar WhatsApp =====
async function sendWhatsApp(to, text) {
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

// ===== POST webhook (receber mensagens) =====
router.post('/', async (req, res) => {
  try {
    const body = req.body;
    if (!body.object) return res.sendStatus(400);

    const entry = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!entry) return res.sendStatus(200);

    const from = entry.from;
    if (from !== MY_NUMBER) return res.sendStatus(200);

    let userMessage = entry.text?.body || "";
    console.log("📩 Mensagem recebida:", userMessage);

    // ===== Processar áudio =====
    if (entry.type === 'audio') {
      const mediaId = entry.audio.id;
      const mediaUrlRes = await axios.get(
        `https://graph.facebook.com/v21.0/${mediaId}`,
        { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
      );
      const mediaUrl = mediaUrlRes.data.url;
      const audioRes = await axios.get(mediaUrl, { responseType: 'arraybuffer', headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } });
      fs.writeFileSync('/tmp/audio.ogg', audioRes.data);

      const form = new FormData();
      form.append('file', fs.createReadStream('/tmp/audio.ogg'));
      form.append('model', 'whisper-1');

      const whisperRes = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, ...form.getHeaders() }
      });

      userMessage = whisperRes.data.text;
      console.log("🎙️ Transcrição de áudio:", userMessage);
      fs.unlinkSync('/tmp/audio.ogg');
    }

    // ===== Processar imagem com GPT multimodal =====
    let imageUrl = null;
    if (entry.type === 'image') {
      const mediaId = entry.image.id;
      const mediaUrlRes = await axios.get(
        `https://graph.facebook.com/v21.0/${mediaId}`,
        { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
      );
      imageUrl = mediaUrlRes.data.url;
      userMessage = "📷 Imagem recebida. Analisando...";
    }

    // ===== Salvar mensagem do usuário no histórico =====
    await Conversation.create({ from, role: 'user', content: userMessage });
    await saveMemory(from, 'user', userMessage); // salvar na memória semântica

    // ===== Hora e data corretas =====
    const now = DateTime.now().setZone('America/Sao_Paulo');
    const currentTime = now.toFormat('HH:mm');       // ex: 20:24
    const currentDate = now.toFormat('dd/MM/yyyy');  // ex: 17/09/2025

    let responseText = "";

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
      // ===== Recuperar histórico de curto prazo =====
      const history = await Conversation.find({ from }).sort({ createdAt: 1 });
      const conversationContext = history.map(h => `${h.role === 'user' ? 'Usuário' : 'Assistente'}: ${h.content}`).join("\n");

      // ===== Recuperar histórico de longo prazo (memória semântica) =====
      const relevantMemories = await getRelevantMemory(from, userMessage, 5);
      const memoryContext = relevantMemories.map(m => `${m.role === 'user' ? 'Usuário' : 'Assistente'}: ${m.content}`).join("\n");

      // ===== Gerar resposta da Donna =====
      responseText = await getGPTResponse(`
Você é Donna, assistente executiva perspicaz, elegante e humanizada.
Hora e data atuais (não altere, use exatamente como está abaixo):
Hora: ${currentTime}
Data: ${currentDate}
Seu papel:
- Ajudar em administração, legislação, RH e negócios.
- Ser poliglota: responda no idioma da mensagem do usuário.
- Dar dicas estratégicas e conselhos, ser terapeuta quando necessário.
- Ajudar com lembretes e compromissos.
- Evitar chamar o usuário de "Rafa" sempre e não iniciar mensagens com "Donna:".
Histórico de conversa recente:
${conversationContext}

Histórico de memória relevante:
${memoryContext}

Mensagem do usuário: "${userMessage}"
      `, imageUrl);
    }

    // ===== Salvar resposta da Donna no histórico e memória =====
    await Conversation.create({ from, role: 'assistant', content: responseText });
    await saveMemory(from, 'assistant', responseText);

    // ===== Salvar no MongoDB e enviar WhatsApp =====
    await Message.create({ from, body: userMessage, response: responseText });
    await sendWhatsApp(from, responseText);

    res.sendStatus(200);

  } catch (error) {
    console.error("❌ Erro no webhook:", error.response?.data || error.message);
    res.sendStatus(500);
  }
});

// ===== Cron job para enviar lembretes =====
cron.schedule('* * * * *', async () => {
  const now = new Date();
  const reminders = await Reminder.find({ date: { $lte: now } });

  for (const r of reminders) {
    await sendWhatsApp(r.from, `⏰ Lembrete: ${r.text} (agendado para ${r.date.toLocaleString('pt-BR')})`);
    await Reminder.findByIdAndDelete(r._id);
  }
});

module.exports = router;



