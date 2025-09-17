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

// ===== Lista de usuários autorizados =====
const authorizedUsers = [
  process.env.MY_NUMBER.replace('+', ''), // seu número sem "+"
  "5541996820681",                         // contato 1
  "5541998682114"                          // contato 2
];

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
    console.log("Número recebido do WhatsApp:", from);

    // ===== Verificar se usuário é autorizado =====
    if (!authorizedUsers.includes(from)) {
      console.log("❌ Usuário não autorizado:", from);
      return res.sendStatus(200);
    }

    let userMessage = entry.text?.body || "";
    console.log("📩 Mensagem recebida:", userMessage);

    // ===== Processar áudio =====
    if (entry.type === 'audio') {
      try {
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
      } catch (err) {
        console.error("❌ Erro no processamento de áudio:", err.response?.data || err.message);
        userMessage = "❌ Não consegui processar seu áudio.";
      }
    }

    // ===== Processar imagem =====
    let imageUrl = null;
    if (entry.type === 'image') {
      try {
        const mediaId = entry.image.id;
        const mediaUrlRes = await axios.get(
          `https://graph.facebook.com/v21.0/${mediaId}`,
          { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
        );
        imageUrl = mediaUrlRes.data.url;
        userMessage = "📷 Imagem recebida. Analisando...";
      } catch (err) {
        console.error("❌ Erro no processamento de imagem:", err.response?.data || err.message);
        userMessage = "❌ Não consegui processar sua imagem.";
      }
    }

    // ===== Salvar mensagem no histórico =====
    await Conversation.create({ from, role: 'user', content: userMessage });
    await saveMemory(from, 'user', userMessage);

    // ===== Hora e data =====
    const now = DateTime.now().setZone('America/Sao_Paulo');
    const currentTime = now.toFormat('HH:mm:ss');
    const currentDate = now.toFormat('dd/MM/yyyy');

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
      // ===== Histórico de curto prazo =====
      const history = await Conversation.find({ from }).sort({ createdAt: 1 });
      const conversationContext = history.map(h => `${h.role === 'user' ? 'Usuário' : ''}${h.content}`).join("\n");

      // ===== Histórico de memória semântica =====
      const relevantMemories = await getRelevantMemory(from, userMessage, 5);
      const memoryContext = relevantMemories.map(m => `${m.role === 'user' ? 'Usuário' : ''}${m.content}`).join("\n");

      // ===== Resposta GPT =====
      responseText = await getGPTResponse(`
Você é Donna, assistente perspicaz e elegante.
Hora e data atuais: ${currentTime} do dia ${currentDate}.
Seu papel:
- Ajudar em administração, RH e negócios.
- Dar dicas estratégicas.
- Ajudar com lembretes e compromissos.
Histórico recente:
${conversationContext}

Histórico de memória relevante:
${memoryContext}

Mensagem do usuário: "${userMessage}"
      `, imageUrl);
    }

    // ===== Salvar resposta no histórico e memória =====
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

// ===== Cron job para lembretes =====
cron.schedule('* * * * *', async () => {
  const now = new Date();
  const reminders = await Reminder.find({ date: { $lte: now } });

  for (const r of reminders) {
    await sendWhatsApp(r.from, `⏰ Lembrete: ${r.text} (agendado para ${r.date.toLocaleString('pt-BR')})`);
    await Reminder.findByIdAndDelete(r._id);
  }
});

module.exports = router;
