require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const { getGPTResponse } = require('../services/gptService');
const Message = require('../models/Message');
const Reminder = require('../models/Reminder');
const FormData = require('form-data');
const fs = require('fs');

const router = express.Router();
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
    if (entry.type === 'image') {
      const mediaId = entry.image.id;
      const mediaUrlRes = await axios.get(
        `https://graph.facebook.com/v21.0/${mediaId}`,
        { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
      );
      const mediaUrl = mediaUrlRes.data.url;

      const gptRes = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: "Você é Donna Paulsen, uma assistente executiva perspicaz e humanizada. Descreva a imagem ou extraia qualquer texto visível."
            },
            {
              role: "user",
              content: [
                { type: "text", text: "Analise esta imagem e me diga o que contém:" },
                { type: "image_url", image_url: { url: mediaUrl } }
              ]
            }
          ]
        },
        { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
      );

      userMessage = "📷 Imagem recebida. Análise: " + gptRes.data.choices[0].message.content;
      console.log("🖼️ Resposta da imagem:", userMessage);
    }

    // ===== Hora e data =====
    const now = new Date();
    const currentTime = now.toLocaleTimeString('pt-BR');
    const currentDate = now.toLocaleDateString('pt-BR');

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
      const prompt = `
Você é Donna Paulsen, assistente executiva perspicaz, elegante e humanizada.
Hora e data atuais: ${currentTime} do dia ${currentDate}.
Seu papel:
- Ajudar em administração, legislação, RH e negócios.
- Ser poliglota: responda no idioma da mensagem do usuário.
- Dar dicas estratégicas e conselhos.
- Ajudar com lembretes e compromissos.
Mensagem do usuário: "${userMessage}"
      `;
      responseText = await getGPTResponse(prompt);
    }

    // Salvar no MongoDB
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
