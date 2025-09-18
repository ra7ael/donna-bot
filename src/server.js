// server.js
import express from 'express';
import { MongoClient } from 'mongodb';
import bodyParser from 'body-parser';
import axios from 'axios';

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI; // Sua URI do MongoDB
const GPT_API_KEY = process.env.GPT_API_KEY; // Sua chave da OpenAI
const MY_NUMBER = '554195194485'; // Seu número autorizado

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
        ],
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
    console.error('Erro GPT:', err);
    return null;
  }
}

// Função para enviar mensagem no WhatsApp
async function sendMessage(to, message) {
  try {
    // Exemplo de envio via sua API existente
    await axios.post(`https://api.whatsapp.com/send?phone=${to}&text=${encodeURIComponent(message)}`);
    console.log('📤 Mensagem enviada:', message);
  } catch (err) {
    console.error('Erro ao enviar WhatsApp:', err);
  }
}

// Endpoint para receber mensagens do WhatsApp
app.post('/webhook', async (req, res) => {
  const { from, body } = req.body;
  console.log('Número recebido do WhatsApp:', from);
  console.log('Mensagem recebida:', body);

  // Pegar histórico do usuário
  const history = await db.collection('historico')
    .find({ numero: from })
    .sort({ timestamp: -1 })
    .limit(5)
    .toArray();

  // Criar prompt com histórico
  const chatHistory = history.map(h => ({
    role: 'user', content: h.mensagem
  })).reverse();

  const prompt = `Você é a assistente Donna. Converse de forma amigável e interativa. Usuário disse: "${body}"`;

  let reply = await askGPT(prompt, chatHistory);

  // Se GPT falhar, não quebre a conversa
  if (!reply) reply = 'Hmm… estou pensando ainda… me dê só mais um segundo!';

  // Salvar histórico
  await db.collection('historico').insertOne({
    numero: from,
    mensagem: body,
    resposta: reply,
    timestamp: new Date()
  });

  // Enviar resposta
  await sendMessage(from, reply);

  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
