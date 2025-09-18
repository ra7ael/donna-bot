// server.js
require('dotenv').config(); // carregar variáveis do .env
const express = require('express');
const { MongoClient } = require('mongodb');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const GPT_API_KEY = process.env.GPT_API_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN; // token da Meta API
const PHONE_ID = process.env.PHONE_ID; // id do número da Meta API

// Conectar ao MongoDB
let db;
MongoClient.connect(MONGO_URI)
  .then(client => {
    db = client.db();
    console.log('✅ Conectado ao MongoDB');
  })
  .catch(err => console.error('Erro MongoDB:', err));

// Função para chamar GPT
async function askGPT(prompt, history = []) {
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-5-mini',
        messages: [...history, { role: 'user', content: prompt }],
        temperature: 0.7
      },
      {
        headers: {
          'Authorization': `Bearer ${GPT_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data.choices[0].message.content;
  } catch (err) {
    console.error('Erro GPT:', err.response?.data || err.message);
    return null;
  }
}

// Função para enviar mensagem pelo WhatsApp via Meta API
async function sendMessage(to, message) {
  try {
    await axios.post(
      `https://graph.facebook.com/v17.0/${PHONE_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to,
        text: { body: message }
      },
      {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log('📤 Mensagem enviada:', message);
  } catch (err) {
    console.error('Erro ao enviar WhatsApp:', err.response?.data || err.message);
  }
}

// Endpoint para receber mensagens do WhatsApp
app.post('/webhook', async (req, res) => {
  const { from, body } = req.body; // garantir que o webhook envia "from" e "body"
  console.log('Número recebido do WhatsApp:', from);
  console.log('Mensagem recebida:', body);

  // Histórico do usuário
  let history = [];
  if (db) {
    history = await db.collection('historico')
      .find({ numero: from })
      .sort({ timestamp: -1 })
      .limit(5)
      .toArray();
  }

  const chatHistory = history.map(h => ({
    role: 'user',
    content: h.mensagem
  })).reverse();

  const prompt = `Você é a assistente Donna. Converse de forma amigável e interativa. Usuário disse: "${body}"`;

  let reply = await askGPT(prompt, chatHistory);

  if (!reply) reply = 'Hmm… estou pensando ainda… me dê só mais um segundo!';

  // Salvar histórico
  if (db) {
    await db.collection('historico').insertOne({
      numero: from,
      mensagem: body,
      resposta: reply,
      timestamp: new Date()
    });
  }

  // Enviar resposta
  await sendMessage(from, reply);

  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
