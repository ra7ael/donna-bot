// src/server.js
import express from 'express';
import { MongoClient } from 'mongodb';
import bodyParser from 'body-parser';
import axios from 'axios';
import dotenv from 'dotenv';
import FormData from 'form-data';
import mongoose from "mongoose";
import { startReminderCron } from "./cron/reminders.js";
import SemanticMemory from "./models/semanticMemory.js";
import { getWeather } from "./utils/weather.js";
import OpenAI from "openai";
import { DateTime } from 'luxon';

dotenv.config();

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const GPT_API_KEY = process.env.OPENAI_API_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

const openai = new OpenAI({ apiKey: GPT_API_KEY });
let db;

// ===== Conectar ao MongoDB =====
async function connectDB() {
  try {
    const client = await MongoClient.connect(MONGO_URI, { useUnifiedTopology: true });
    db = client.db();
    console.log('✅ Conectado ao MongoDB (histórico)');
  } catch (err) {
    console.error('❌ Erro ao conectar ao MongoDB (histórico):', err);
  }
}
connectDB();

// ===== Funções auxiliares =====
async function askGPT(prompt, history = []) {
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      { model: 'gpt-5-mini', messages: history.concat({ role: 'user', content: prompt }) },
      { headers: { Authorization: `Bearer ${GPT_API_KEY}`, 'Content-Type': 'application/json' } }
    );
    return response.data.choices?.[0]?.message?.content || "Hmm… ainda estou pensando!";
  } catch (err) {
    console.error('❌ Erro GPT:', err.response?.data || err);
    return "Hmm… ainda estou pensando!";
  }
}

async function sendMessage(to, message) {
  try {
    await axios.post(
      `https://graph.facebook.com/v17.0/${WHATSAPP_PHONE_ID}/messages`,
      { messaging_product: "whatsapp", to, text: { body: message } },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } }
    );
    console.log('📤 Mensagem enviada:', message);
  } catch (err) {
    console.error('❌ Erro ao enviar WhatsApp:', err.response?.data || err);
  }
}

async function downloadMedia(mediaId) {
  try {
    const mediaUrlResp = await axios.get(`https://graph.facebook.com/v17.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
    });
    const mediaResp = await axios.get(mediaUrlResp.data.url, {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
      responseType: "arraybuffer"
    });
    return mediaResp.data;
  } catch (err) {
    console.error("❌ Erro ao baixar mídia:", err.response?.data || err);
    return null;
  }
}

async function transcribeAudio(audioBuffer) {
  try {
    const formData = new FormData();
    formData.append("file", audioBuffer, { filename: "audio.ogg" });
    formData.append("model", "gpt-4o-transcribe");

    const response = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      formData,
      { headers: { Authorization: `Bearer ${GPT_API_KEY}`, ...formData.getHeaders() } }
    );
    return response.data.text || null;
  } catch (err) {
    console.error("❌ Erro Whisper:", err.response?.data || err);
    return null;
  }
}

// ===== Memória semântica =====
async function generateEmbedding(text) {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;
}

async function getUserMemory(userId, limit = 6) {
  return await SemanticMemory.find({ userId }).sort({ createdAt: -1 }).limit(limit).lean();
}

async function saveMemory(userId, role, content) {
  const embedding = await generateEmbedding(content);
  const memory = new SemanticMemory({ userId, role, content, embedding });
  await memory.save();
}

// ===== Webhook endpoint =====
app.post('/webhook', async (req, res) => {
  try {
    const messageObj = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!messageObj) return res.sendStatus(200);

    const from = messageObj.from;
    const allowedNumbers = ['554195194485', '554199833283'];
    if (!allowedNumbers.includes(from)) return res.sendStatus(200);

    let body;
    if (messageObj.type === "text") body = messageObj.text?.body;
    else if (messageObj.type === "audio") {
      const audioBuffer = await downloadMedia(messageObj.audio?.id);
      if (audioBuffer) body = await transcribeAudio(audioBuffer);
    } else {
      await sendMessage(from, "Só consigo responder mensagens de texto ou áudio 😉");
      return res.sendStatus(200);
    }

    if (!body) return res.sendStatus(200);

    // Histórico de memória semântica
    const memories = await getUserMemory(from, 6);
    const chatHistory = memories.reverse().map(m => ({ role: m.role, content: m.content }));

    // Sistema GPT
    const systemMessage = {
      role: "system",
      content: "Você é a Rafa, assistente pessoal do usuário. Responda de forma objetiva, curta e direta. Não repita apresentações."
    };
    
    // Comandos especiais: hora, data, clima
    let reply;
    const now = DateTime.now().setZone('America/Sao_Paulo');
    
    if (/que horas são\??/i.test(body)) {
      reply = `🕒 Agora são ${now.toFormat('HH:mm')}`;
    } else if (/qual a data( de hoje)?\??/i.test(body)) {
      reply = `📅 Hoje é ${now.toFormat('dd/MM/yyyy')}`;
    } else if (/como está o tempo em (.+)\??/i.test(body)) {
      const cityMatch = body.match(/como está o tempo em (.+)\??/i);
      const city = cityMatch[1].trim();
      reply = await getWeather(city);
    } else {
      reply = await askGPT(body, [systemMessage, ...chatHistory]);
    }

    // Salvar histórico e memória semântica
    await db.collection('historico').insertOne({
      numero: from,
      mensagem: body,
      resposta: reply,
      timestamp: new Date()
    });
    await saveMemory(from, "user", body);
    await saveMemory(from, "assistant", reply);

    await sendMessage(from, reply);

  } catch (err) {
    console.error('❌ Erro ao processar webhook:', err);
  }

  res.sendStatus(200);
});

// ===== Conexão Mongoose + cron + servidor =====
(async () => {
  try {
    await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log("✅ Conectado ao MongoDB (reminders)");

    // Inicia cron de reminders
    startReminderCron();

    // Inicia servidor
    app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
  } catch (err) {
    console.error("❌ Erro ao conectar ao MongoDB:", err);
  }
})();
