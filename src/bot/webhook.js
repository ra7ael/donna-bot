require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { getGPTResponse } = require('../services/gptService');
const Message = require('../models/Message');

const router = express.Router();

// Variáveis de ambiente
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const MY_NUMBER = process.env.MY_NUMBER; // Coloque seu número +5541995194485

// ====== Verificação do Webhook (GET) ======
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log("🔹 GET Webhook recebido:", req.query);

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('✅ Webhook verificado com sucesso!');
      return res.status(200).send(challenge);
    } else {
      console.log('❌ Token de verificação inválido');
      return res.sendStatus(403);
    }
  } else {
    console.log('⚠️ GET inválido');
    return res.sendStatus(400);
  }
});

// ====== Receber mensagens do WhatsApp (POST) ======
router.post('/', async (req, res) => {
  try {
    const body = req.body;
    console.log("📩 POST Webhook recebido:", JSON.stringify(body, null, 2));

    if (!body.object) {
      console.log("⚠️ Objeto do corpo inválido");
      return res.sendStatus(400);
    }

    const entry = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!entry) {
      console.log("⚠️ Nenhuma mensagem encontrada");
      return res.sendStatus(200);
    }

    // ====== Responder apenas seu número ======
    if (entry.from !== MY_NUMBER) {
      console.log(`⚠️ Número não autorizado: ${entry.from}`);
      return res.sendStatus(200);
    }

    const from = entry.from;
    const userMessage = entry.text?.body || "";
    console.log("📝 Mensagem do usuário:", userMessage);

    // ====== Obter resposta do GPT ======
    const aiResponse = await getGPTResponse(userMessage);
    console.log("🤖 Resposta GPT:", aiResponse);

    // ====== Salvar mensagem no MongoDB ======
    const savedMessage = await Message.create({ from, body: userMessage, response: aiResponse });
    console.log("💾 Mensagem salva no MongoDB:", savedMessage);

    // ====== Enviar resposta pelo WhatsApp ======
    await axios.post(
      `https://graph.facebook.com/v21.0/${PHONE_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: from,
        text: { body: aiResponse }
      },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
    );
    console.log("📤 Resposta enviada ao WhatsApp");

    res.sendStatus(200);

  } catch (error) {
    console.error("❌ Erro no webhook:", error.response?.data || error.message);
    res.sendStatus(500);
  }
});

module.exports = router;

