import express from 'express';
import { MongoClient } from 'mongodb';
import bodyParser from 'body-parser';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const GPT_API_KEY = process.env.OPENAI_API_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

// Lista de números autorizados (formato internacional)
const allowedNumbers = [
  '554195194485' // você
];

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
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-5-mini',
        messages: [
          ...history,
          { role: 'user', content: prompt }
        ]
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
    console.error('Erro GPT:', err.response?.data || err);
    return 'Hmm… estou pensando ainda… me dê só mais um segundo!';
  }
}

// Função para enviar mensagem via WhatsApp
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

// Endpoint do webhook
app.post('/webhook', async (req, res) => {
  try {
    const messageObj = req.body.entry[0].changes[0].value.messages[0];
    const from = messageObj.from;
    const body = messageObj.text?.body;

    // Ignora números não autorizados
    if (!allowedNumbers.includes(from)) {
      console.log('Número não autorizado:', from);
      return res.sendStatus(200);
    }

    console.log('Número autorizado:', from);
    console.log('Mensagem recebida:', body);

    // Histórico do usuário
    const history = await db.collection('historico')
      .find({ numero: from })
      .sort({ timestamp: -1 })
      .limit(6)
      .toArray();

    const chatHistory = history.map(h => ({
      role: 'user',
      content: h.mensagem
    })).reverse();

    // Prompt inicial baseado em Harvey Specter / Donna Paulsen
    const prompt = `
Você é a Donna, assistente de estilo Paulsen de Suits.
Características:
- Confiante, elegante, sarcástica de forma inteligente, carismática.
- Respostas curtas, diretas, impactantes.
- Usa humor sutil quando apropriado.
- Mantém um tom profissional e envolvente, como se sempre estivesse um passo à frente.
- Não escreve parágrafos longos; frases curtas.
Responda de forma confiante, elegante, direta e inteligente, com humor sutil quando apropriado.
Ofereça apoio, ideias ou respostas afiadas, mas nunca exageradas.
Seja amigável e carismática, mantendo a sensação de poder e confiança.
Usuário disse: "${body}"
`;

    const reply = await askGPT(prompt, chatHistory);

    // Salvar histórico
    await db.collection('historico').insertOne({
      numero: from,
      mensagem: body,
      resposta: reply,
      timestamp: new Date()
    });

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
