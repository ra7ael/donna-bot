require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const chrono = require('chrono-node'); // Para interpretar datas naturais
const { getGPTResponse } = require('../services/gptService');
const Message = require('../models/Message');
const Reminder = require('../models/Reminder');

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
    const userMessage = entry.text?.body || "";

    if (from !== MY_NUMBER) return res.sendStatus(200); // só responde você

    console.log("📩 Mensagem recebida:", userMessage);

    const now = new Date();
    const currentTime = now.toLocaleTimeString('pt-BR');
    const currentDate = now.toLocaleDateString('pt-BR');

    let responseText = "";

    // ===== Lembretes =====
    const lembreteRegex = /lembre-me de (.+) (em|para|às) (.+)/i;
    const horaRegex = /\b(hora|que horas|horário|data|dia)\b/i;

    if (lembreteRegex.test(userMessage)) {
      const match = userMessage.match(lembreteRegex);
      const text = match[1];
      const dateStr = match[3];
      const date = chrono.parseDate(dateStr); // interpretação natural da data

      if (!date) {
        responseText = "❌ Não consegui entender a data/hora do lembrete. Use formato claro, ex: 'Lembre-me de reunião amanhã às 15:00'";
      } else {
        await Reminder.create({ from, text, date });
        responseText = `✅ Lembrete salvo: "${text}" para ${date.toLocaleString('pt-BR')}`;
      }

    } else if (horaRegex.test(userMessage)) {
      responseText = `⏰ Agora são ${currentTime} do dia ${currentDate}.`;

    } else {
      // ===== Histórico de conversa =====
      const history = await Message.find({ from }).sort({ createdAt: 1 });
      const historyText = history.map(m => `Usuário: ${m.body}\nDonna: ${m.response}`).join("\n");

      const prompt = `
Você é Donna Paulsen, assistente executiva extremamente perspicaz, elegante e humanizada.
Hora e data atuais: ${currentTime} do dia ${currentDate}.
Histórico da conversa:
${historyText}
Mensagem nova do usuário: "${userMessage}"
Responda de forma natural, personalizada, com toque de humor ou empatia.
Se for sobre lembretes, indique claramente que você pode salvar e avisar no horário.
      `;

      responseText = await getGPTResponse(prompt);
    }

    // ===== Salvar no MongoDB =====
    await Message.create({ from, body: userMessage, response: responseText });

    // ===== Enviar resposta pelo WhatsApp =====
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

