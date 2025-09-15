require("dotenv").config();
const express = require("express");
const axios = require("axios");

const router = express.Router();

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_ID;

// Função para enviar mensagem pelo WhatsApp
async function sendMessage(to, message) {
  try {
    const url = `https://graph.facebook.com/v20.0/${PHONE_ID}/messages`;

    await axios.post(
      url,
      {
        messaging_product: "whatsapp",
        to: to,
        text: { body: message },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log(`📤 Mensagem enviada para ${to}: ${message}`);
  } catch (error) {
    console.error("❌ Erro ao enviar mensagem:", error.response?.data || error);
  }
}

// =======================
// Verificação do webhook
// =======================
router.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("✅ Webhook verificado com sucesso!");
      res.status(200).send(challenge);
    } else {
      console.log("❌ Token de verificação inválido");
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
});

// =======================
// Receber mensagens
// =======================
router.post("/", (req, res) => {
  const body = req.body;

  if (body.object) {
    const messageObj = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (messageObj) {
      const from = messageObj.from; // número de quem enviou
      const msg = messageObj.text?.body;

      console.log("📩 Mensagem recebida de:", from, "->", msg);

      // Só responde ao número do Rafael
      if (from === "5541995194485") {
        // Responde mensagem
        if (msg?.toLowerCase() === "status") {
          sendMessage(from, "🚀 Donna está online e funcionando!");
        } else {
          sendMessage(from, `Oi Rafael 👋, eu sou a Donna 🤖! Você disse: "${msg}"`);
        }
      } else {
        console.log("⚠️ Mensagem recebida de outro número, ignorada.");
      }
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

module.exports = router;
