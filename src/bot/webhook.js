require('dotenv').config();
const express = require('express');
const router = express.Router();

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// Verificação do webhook (GET)
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

// Receber mensagens do WhatsApp (POST)
router.post('/', (req, res) => {
  const body = req.body;

  console.log('📩 Mensagem recebida:', JSON.stringify(body, null, 2));

  res.sendStatus(200);
});

module.exports = router;
