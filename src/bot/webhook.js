require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { getGPTResponse } = require('../services/gptService');
const Message = require('../models/Message');

const router = express.Router();
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_ID;

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
router.post('/', async (req, res) => {
  try {
    const body = req.body;

    if (body.object) {
      const entry = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

      if (entry && entry.from === process.env.MY_NUMBER) { // só responde ao seu número
        const from = entry.from;
        const userMessage = entry.text?.body || "";

        // Obter resposta humanizada do GPT
        const aiResponse = await getGPTResponse(userMessag

