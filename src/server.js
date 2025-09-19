import express from 'express';
import { MongoClient } from 'mongodb';
import bodyParser from 'body-parser';
import axios from 'axios';
import dotenv from 'dotenv';
import FormData from 'form-data';

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
  '554195194485'// você
  '554199833283'// contatos
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

// Função para baixar mídia do WhatsApp
async function downloadMedia(mediaId) {
  try {
    const mediaUrlResp = await axios.get(
      `https://graph.facebook.com/v17.0/${mediaId}`,
      {
        headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
      }
    );

    const mediaUrl = mediaUrlResp.data.url;

    const mediaResp = await axios.get(mediaUrl, {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
      responseType: "arraybuffer"
    });

    return mediaResp.data;
  } catch (err) {
    console.error("Erro ao baixar mídia:", err.response?.data || err);
    return null;
  }
}

// Função para transcrever áudio com Whisper
async function transcribeAudio(audioBuffer) {
  try {
    const formData = new FormData();
    formData.append("file", audioBuffer, { filename: "audio.ogg" });
    formData.append("model", "gpt-4o-transcribe");

    const response = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      formData,
      {
        headers: {
          "Authorization": `Bearer ${GPT_API_KEY}`,
          ...formData.getHeaders()
        }
      }
    );

    return response.data.text;
  } catch (err) {
    console.error("Erro Whisper:", err.response?.data || err);
    return null;
  }
}

// Endpoint do webhook
app.post('/webhook', async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const messageObj = changes?.value?.messages?.[0];

    if (!messageObj) {
      return res.sendStatus(200); // nada para processar
    }

    const from = messageObj.from;

    // Ignora números não autorizados
    if (!allowedNumbers.includes(from)) {
      console.log('Número não autorizado:', from);
      return res.sendStatus(200);
    }

    let body;

    if (messageObj.type === "text") {
      body = messageObj.text?.body;
    } else if (messageObj.type === "audio") {
      console.log("🎤 Recebi um áudio, baixando...");

      const audioId = messageObj.audio?.id;
      const audioBuffer = await downloadMedia(audioId);

      if (audioBuffer) {
        body = await transcribeAudio(audioBuffer);
        console.log("📝 Transcrição:", body);
      }
    } else {
      console.log(`Mensagem ignorada (tipo: ${messageObj.type})`);
      await sendMessage(from, "Só consigo responder mensagens de texto ou áudio no momento 😉");
      return res.sendStatus(200);
    }

    if (!body) {
      console.log("Mensagem sem conteúdo válido, ignorando.");
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

    // Prompt estilo Donna
    const prompt = `
Você é a Rafa, assistente pessoal.
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
