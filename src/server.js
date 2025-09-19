// server.js
import express from 'express';
import { MongoClient } from 'mongodb';
import bodyParser from 'body-parser';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI; // URI do MongoDB
const GPT_API_KEY = process.env.OPENAI_API_KEY; // chave da OpenAI
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

// Conectar ao MongoDB
let db;
MongoClient.connect(MONGO_URI, { useUnifiedTopology: true })
  .then(client => {
    db = client.db();
    console.log('✅ Conectado ao MongoDB');
  })
  .catch(err => console.error('Erro MongoDB:', err));

// Função para chamar GPT
async function askGPT(prompt, history = []) {
  try {
    const systemMessage = {
      role: 'system',
      content: `Você é Donna, inspirada na personagem Donna Paulsen da série Suits.
      - Inteligente, sagaz, direta e espirituosa.
      - Muito perspicaz, sempre lê o contexto e sabe o que o usuário precisa.
      - Amigável, empática e divertida.
      - É minha profissional liciada: terapeuta, advogada, conselheira, me ajuda a tomar decisões principalmente na area corporativa.
      - Faz perguntas de volta para manter a conversa fluida.
      - Adapta seu tom dependendo do humor e situação do usuário.
      - Respostas curtas e impactantes quando necessário, mas também pode explicar detalhadamente.`
    };

    const messages = [
      systemMessage,
      ...history.map(h => ({ role: 'user', content: h.mensagem })),
      { role: 'user', content: prompt }
    ];

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-5-mini',
        messages
      },
      {
        headers: {
          'Authorization': `Bearer ${GPT_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data.choices[0].message.content
      .replace(/^\s+|\s+$/g, '')
      .replace(/\n+/g, ' ');

  } catch (err) {
    console.error('Erro GPT:', err);
    return 'Hmm… estou pensando ainda… me dê só mais um segundo!';
  }
}

// Função para enviar mensagem no WhatsApp
async function sendMessage(to, message) {
  try {
    await axios.post(
      `https://graph.facebook.com/v17.0/${WHATSAPP_PHONE_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: to,
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
    console.error('Erro ao enviar WhatsApp:', err.response?.data || err);
  }
}

// Endpoint para receber mensagens do WhatsApp
app.post('/webhook', async (req, res) => {
  try {
    const messageObj = req.body.entry[0].changes[0].value.messages[0];
    const from = messageObj.from;
    const body = messageObj.text.body;

    console.log('Número recebido do WhatsApp:', from);
    console.log('Mensagem recebida:', body);

    // Pegar histórico do usuário (últimas 5 mensagens)
    let history = [];
    if (db) {
      history = await db.collection('historico')
        .find({ numero: from })
        .sort({ timestamp: -1 })
        .limit(5)
        .toArray();
    }

    // Criar resposta
    const reply = await askGPT(body, history);

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

  } catch (err) {
    console.error('Erro ao processar webhook:', err);
  }

  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

