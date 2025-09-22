// src/server.js
import express from 'express';
import { MongoClient } from 'mongodb';
import bodyParser from 'body-parser';
import axios from 'axios';
import dotenv from 'dotenv';
import FormData from 'form-data';
import mongoose from "mongoose";
import { startReminderCron } from "./cron/reminders.js";
import { getWeather } from "./utils/weather.js";
import OpenAI from "openai";
import { DateTime } from 'luxon';
import speak from "./utils/speak.js"; // agora usando Coqui TTS
import { downloadMedia } from './utils/downloadMedia.js';

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
    console.log('✅ Conectado ao MongoDB (histórico e usuários)');
  } catch (err) {
    console.error('❌ Erro ao conectar ao MongoDB:', err);
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

async function sendAudio(to, audioBuffer) {
  try {
    const formData = new FormData();
    formData.append('messaging_product', 'whatsapp');
    formData.append('to', to);
    formData.append('type', 'audio');
    formData.append('audio', audioBuffer, { filename: 'audio.mp3' });

    await axios.post(
      `https://graph.facebook.com/v17.0/${WHATSAPP_PHONE_ID}/messages`,
      formData,
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, ...formData.getHeaders() } }
    );
    console.log('📤 Áudio enviado');
  } catch (err) {
    console.error('❌ Erro ao enviar áudio:', err.response?.data || err);
  }
}

// ===== Funções de usuários e memória =====
async function getUserName(number) {
  const doc = await db.collection('users').findOne({ numero: number });
  return doc?.nome || null;
}

async function setUserName(number, name) {
  await db.collection('users').updateOne(
    { numero: number },
    { $set: { nome: name } },
    { upsert: true }
  );
}

async function getUserMemory(number, limit = 5) {
  return await db.collection('semanticMemory')
    .find({ numero: number })
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();
}

async function saveMemory(number, role, content) {
  await db.collection('semanticMemory').insertOne({
    numero: number,
    role,
    content,
    timestamp: new Date()
  });
}

// ===== Webhook endpoint =====
app.post('/webhook', async (req, res) => {
  try {
    const messageObj = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!messageObj) return res.sendStatus(200);

    const from = messageObj.from;
    const allowedNumbers = ['554195194485', '554199833283','554196820681'];
    if (!allowedNumbers.includes(from)) return res.sendStatus(200);

    let body;
    let isAudioResponse = false;

    if (messageObj.type === "text") {
      body = messageObj.text?.body;
      if (body.toLowerCase().startsWith("fala ")) {
        body = body.slice(5).trim();
        isAudioResponse = true;
      }
    } else if (messageObj.type === "audio") {
      const audioBuffer = await downloadMedia(messageObj.audio?.id);
      if (audioBuffer) {
        body = await transcribeAudio(audioBuffer);
        isAudioResponse = true;
      }
    } else {
      await sendMessage(from, "Só consigo responder mensagens de texto ou áudio 😉");
      return res.sendStatus(200);
    }

    if (!body) return res.sendStatus(200);

    // ===== Recuperar nome do usuário =====
    let userName = await getUserName(from);

    // ===== Captura de nome =====
    const nameMatch = body.match(/meu nome é (\w+)/i);
    if (nameMatch) {
      userName = nameMatch[1];
      await setUserName(from, userName);
      await sendMessage(from, `Ótimo! Agora vou te chamar de ${userName} 😊`);
      return res.sendStatus(200);
    }

    // Histórico de memória semântica
    const memories = await getUserMemory(from, 6);
    const chatHistory = memories.reverse().map(m => ({ role: m.role, content: m.content }));

    // Sistema GPT
    const systemMessage = {
      role: "system",
      content: `Você é a Donna, assistente pessoal do usuário. Sempre chame o usuário pelo nome se souber. Responda de forma objetiva, curta e direta.`
    };

    // Comandos especiais
    let reply;
    const now = DateTime.now().setZone('America/Sao_Paulo');

    if (/que horas são\??/i.test(body)) {
      reply = `🕒 Agora são ${now.toFormat('HH:mm')}`;
    } else if (/qual a data( de hoje)?\??/i.test(body)) {
      const weekday = now.toFormat('cccc');
      reply = `📅 Hoje é ${weekday}, ${now.toFormat('dd/MM/yyyy')}`;
    } else if (/tempo|clima|previsão/i.test(body)) {
      const matchCity = body.match(/em\s+([a-z\s]+)/i);
      const city = matchCity ? matchCity[1].trim() : "Curitiba";
      reply = await getWeather(city, "hoje");
    } else {
      const personalizedPrompt = userName ? `O usuário se chama ${userName}. ${body}` : body;
      reply = await askGPT(personalizedPrompt, [systemMessage, ...chatHistory]);
    }

    // Salvar histórico
    await db.collection('historico').insertOne({
      numero: from,
      mensagem: body,
      resposta: reply,
      timestamp: new Date()
    });
    await saveMemory(from, "user", body);
    await saveMemory(from, "assistant", reply);

    // ===== Enviar resposta =====
    if (isAudioResponse) {
      const audioData = await speak(reply); // SDK ElevenLabs
      if (audioData) await sendAudio(from, audioData);
    } else {
      await sendMessage(from, reply);
    }

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

    startReminderCron();

    app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
  } catch (err) {
    console.error("❌ Erro ao conectar ao MongoDB:", err);
  }
})();
