// src/server.js
import express from 'express';
import OpenAI from "openai";
import { MongoClient } from 'mongodb';
import bodyParser from 'body-parser';
import axios from 'axios';
import dotenv from 'dotenv';
import FormData from 'form-data';
import mongoose from "mongoose";
import { DateTime } from 'luxon';
import { startReminderCron } from "./cron/reminders.js";
import { getWeather } from "./utils/weather.js";
import speak from "./utils/speak.js"; // TTS opcional
import { downloadMedia } from './utils/downloadMedia.js';
import cron from 'node-cron';
import { responderFAQ } from "./utils/faqHandler.js";
import { numerosAutorizados } from "./config/autorizados.js";

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

// ===== Conectar MongoDB =====
async function connectDB() {
  try {
    const client = await MongoClient.connect(MONGO_URI, { useUnifiedTopology: true });
    db = client.db();
    console.log('✅ Conectado ao MongoDB (histórico, usuários, agenda)');
  } catch (err) {
    console.error('❌ Erro ao conectar ao MongoDB:', err);
  }
}
connectDB();

// ===== Funções GPT =====
async function askGPT(prompt, history = []) {
  try {
    // Garante que não há mensagens nulas/vazias
    const safeMessages = history
      .map(m => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : ""
      }))
      .filter(m => m.content.trim() !== "");

    safeMessages.push({ role: "user", content: prompt || "" });

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      { model: "gpt-5-mini", messages: safeMessages },
      { headers: { Authorization: `Bearer ${GPT_API_KEY}`, "Content-Type": "application/json" } }
    );

    return response.data.choices?.[0]?.message?.content || "Hmm… ainda estou pensando!";
  } catch (err) {
    console.error("❌ Erro GPT:", err.response?.data || err);
    return "Hmm… ainda estou pensando!";
  }
}

// ===== WhatsApp =====
async function sendMessage(to, message) {
  if (!message) return;
  try {
    await axios.post(
      `https://graph.facebook.com/v17.0/${WHATSAPP_PHONE_ID}/messages`,
      { messaging_product: "whatsapp", to, text: { body: message } },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
    );
    console.log("📤 Mensagem enviada:", message);
  } catch (err) {
    console.error("❌ Erro ao enviar WhatsApp:", err.response?.data || err);
  }
}

async function sendAudio(to, audioBuffer) {
  if (!audioBuffer) return;
  try {
    const formData = new FormData();
    formData.append("messaging_product", "whatsapp");
    formData.append("to", to);
    formData.append("type", "audio");
    formData.append("audio", audioBuffer, { filename: "audio.mp3" });

    await axios.post(
      `https://graph.facebook.com/v17.0/${WHATSAPP_PHONE_ID}/messages`,
      formData,
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, ...formData.getHeaders() } }
    );
    console.log("📤 Áudio enviado");
  } catch (err) {
    console.error("❌ Erro ao enviar áudio:", err.response?.data || err);
  }
}

// ===== Usuários e memória =====
async function getUserName(number) {
  const doc = await db.collection("users").findOne({ numero: number });
  return doc?.nome || null;
}

async function setUserName(number, name) {
  await db.collection("users").updateOne(
    { numero: number },
    { $set: { nome: name } },
    { upsert: true }
  );
}

async function getUserMemory(number, limit = 5) {
  return await db.collection("semanticMemory")
    .find({ numero: number })
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();
}

async function saveMemory(number, role, content) {
  if (!content || !content.trim()) return; // evita null ou vazio
  await db.collection("semanticMemory").insertOne({
    numero: number,
    role,
    content,
    timestamp: new Date()
  });
}

// ===== Transcrição =====
async function transcribeAudio(audioBuffer) {
  try {
    const form = new FormData();
    form.append("file", audioBuffer, { filename: "audio.ogg" });
    form.append("model", "whisper-1");

    const res = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      form,
      { headers: { Authorization: `Bearer ${GPT_API_KEY}`, ...form.getHeaders() } }
    );

    return res.data?.text || "";
  } catch (err) {
    console.error("❌ Erro na transcrição:", err.response?.data || err.message);
    return "";
  }
}

// ===== Agenda =====
async function addEvent(number, title, description, date, time) {
  await db.collection("donna").insertOne({
    numero: number,
    titulo: title,
    descricao: description || title,
    date,
    hora: time,
    sent: false,
    timestamp: new Date()
  });
}

async function getTodayEvents(number) {
  const today = DateTime.now().toFormat("yyyy-MM-dd");
  return await db.collection("donna").find({ numero, data: today }).sort({ hora: 1 }).toArray();
}

// ===== Webhook =====
app.post("/webhook", async (req, res) => {
  try {
    const messageObj = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!messageObj) return res.sendStatus(200);

    const from = messageObj.from;

    let body = "";
    let isAudioResponse = false;

    if (messageObj.type === "text") {
      body = messageObj.text?.body || "";
      if (body.toLowerCase().startsWith("fala ")) {
        body = body.slice(5).trim();
        isAudioResponse = true;
      }
    } else if (messageObj.type === "audio") {
      const audioBuffer = await downloadMedia(messageObj.audio?.id);
      if (audioBuffer) body = await transcribeAudio(audioBuffer);
      isAudioResponse = false;
    } else {
      await sendMessage(from, "Só consigo responder mensagens de texto ou áudio 😉");
      return res.sendStatus(200);
    }

    const promptBody = (body || "").trim();
    if (!promptBody) return res.sendStatus(200);

    // 🔒 NÃO AUTORIZADO → apenas FAQ
    if (!numerosAutorizados.includes(from)) {
      const faqReply = await responderFAQ(promptBody);
      const respostaFinal = faqReply || "❓ Só consigo responder perguntas do FAQ (benefícios, férias, folha, horário, endereço, contato).";
      await sendMessage(from, respostaFinal);
      return res.sendStatus(200);
    }

    // 🔓 AUTORIZADO → fluxo completo GPT
    let userName = await getUserName(from);
    const nameMatch = promptBody.match(/meu nome é (\w+)/i);
    if (nameMatch) {
      userName = nameMatch[1];
      await setUserName(from, userName);
      await sendMessage(from, `Ótimo! Agora vou te chamar de ${userName} 😊`);
      return res.sendStatus(200);
    }

    const memories = await getUserMemory(from, 6);
    const chatHistory = memories.reverse()
      .map(m => ({ role: m.role, content: m.content || "" }))
      .filter(m => m.content.trim() !== "");

    const systemMessage = {
      role: "system",
      content: `
        Você é a Donna, assistente pessoal do usuário. 
        - Use o nome do usuário quando souber. 
        - Responda de forma objetiva, clara, direta e amigável. 
        - Priorize respostas curtas e práticas. 
        - Se a pergunta for sobre horário, data, clima ou lembretes, responda de forma precisa. 
        - Não invente informações; se não souber, admita de forma educada. 
        - Adapte seu tom para ser acolhedora e prestativa.
      `
    };

    let reply;
    const now = DateTime.now().setZone("America/Sao_Paulo");

    if (/que horas são\??/i.test(promptBody)) {
      reply = `🕒 Agora são ${now.toFormat("HH:mm")}`;
    } else if (/qual a data( de hoje)?\??/i.test(promptBody)) {
      const weekday = now.toFormat("cccc");
      reply = `📅 Hoje é ${weekday}, ${now.toFormat("dd/MM/yyyy")}`;
    } else if (/tempo|clima|previsão/i.test(promptBody)) {
      const matchCity = promptBody.match(/em\s+([a-z\s]+)/i);
      const city = matchCity ? matchCity[1].trim() : "Curitiba";
      reply = await getWeather(city, "hoje");
    } else if (/lembrete|evento|agenda/i.test(promptBody)) {
      const match = promptBody.match(/lembrete de (.+) às (\d{1,2}:\d{2})/i);
      if (match) {
        const title = match[1];
        const time = match[2];
        const date = DateTime.now().toFormat("yyyy-MM-dd");
        await addEvent(from, title, title, date, time);
        reply = `✅ Lembrete "${title}" criado para hoje às ${time}`;
      } else if (/mostrar agenda|meus lembretes/i.test(promptBody)) {
        const events = await getTodayEvents(from);
        reply = events.length === 0
          ? "📭 Você não tem nenhum evento para hoje."
          : "📅 Seus eventos de hoje:\n" + events.map(e => `- ${e.hora}: ${e.titulo}`).join("\n");
      }
    } else {
      const personalizedPrompt = userName ? `O usuário se chama ${userName}. ${promptBody}` : promptBody;
      reply = await askGPT(personalizedPrompt, [systemMessage, ...chatHistory]);
    }

    await db.collection("historico").insertOne({
      numero: from,
      mensagem: promptBody,
      resposta: reply,
      timestamp: new Date()
    });
    await saveMemory(from, "user", promptBody);
    await saveMemory(from, "assistant", reply);

    if (isAudioResponse) {
      const audioData = await speak(reply);
      if (audioData) await sendAudio(from, audioData);
    } else {
      await sendMessage(from, reply);
    }

  } catch (err) {
    console.error("❌ Erro ao processar webhook:", err);
  }

  res.sendStatus(200);
});

// ===== Cron job =====
cron.schedule("* * * * *", async () => {
  const now = DateTime.now().setZone("America/Sao_Paulo").toFormat("HH:mm");
  const today = DateTime.now().toFormat("yyyy-MM-dd");

  const events = await db.collection("donna").find({ data: today, hora: now }).toArray();
  for (const ev of events) {
    await sendMessage(ev.numero, `⏰ Lembrete: ${ev.titulo}`);
  }
});

// ===== Start =====
(async () => {
  try {
    await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log("✅ Conectado ao MongoDB (reminders)");

    startReminderCron();

    app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
  } catch (err) {
    console.error("❌ Erro ao conectar ao MongoDB:", err);
  }
})();
