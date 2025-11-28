// src/server.js
import "dotenv/config";
import express from "express";
import OpenAI from "openai";
import { MongoClient } from "mongodb";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import bodyParser from "body-parser";
import axios from "axios";
import mongoose from "mongoose";
import cron from "node-cron";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import FormData from "form-data";

import { DateTime } from "luxon";

import { buscarPergunta } from "./utils/buscarPdf.js";
import { getWeather } from "./utils/weather.js";
import { downloadMedia } from "./utils/downloadMedia.js";
import { falar, sendAudio } from "./utils/speak.js";
import { numerosAutorizados } from "./config/autorizados.js";
import { treinarDonna, obterResposta, setPapeis, clearPapeis } from "./utils/treinoDonna.js";
import { funcoesExtras } from "./utils/funcoesExtras.js";
import { salvarMemoria, buscarMemoria, limparMemoria } from "./utils/memory.js";
import Message from "./models/Message.js";
import Reminder from "./models/Reminder.js";
import Conversation from "./models/Conversation.js";

// Permite usar __dirname em ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Express app
const app = express();
app.use(bodyParser.json());

// OpenAI inicialização
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Mongo globals (driver)
let dbInstance = null;
let mongoClient = null;
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

// Função para obter DB fora do arquivo sem quebrar ESM
export function getDB() {
  return dbInstance;
}

// Conexão MongoDB (driver nativo)
async function connectMongo() {
  if (dbInstance) return dbInstance;
  if (!MONGO_URI) {
    console.error("❌ MONGO_URI ausente no .env");
    process.exit(1);
  }

  try {
    console.log("🔹 Conectando ao MongoDB...");
    mongoClient = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    await mongoClient.connect();
    dbInstance = mongoClient.db("donna");
    console.log("✅ MongoDB conectado!");
    return dbInstance;
  } catch (err) {
    console.error("❌ Falha conexão MongoDB:", err?.message || err);
    process.exit(1);
  }
}
await connectMongo();

// Simulação de cron pra lembretes (mongoose model)
cron.schedule("* * * * *", async () => {
  try {
    const now = new Date();
    const reminders = await Reminder.find({ date: { $lte: now }, sent: false }).lean();

    console.log("⏰ Buscando lembretes pendentes...");

    if (!reminders.length) {
      console.log("🔹 Nenhum lembrete pendente.");
      return;
    }

    for (const r of reminders) {
      await sendMessage(r.from, `⏰ Lembrete: ${r.text} (Agendado: ${r.date.toLocaleString("pt-BR")})`);
      await Reminder.updateOne({ _id: r._id }, { $set: { sent: true, disparadoEm: new Date() } });
    }
  } catch (err) {
    console.error("❌ Erro cron lembrete:", err?.message || err);
  }
});

// Webhook do WhatsApp
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!entry) return res.sendStatus(200);

    const from = entry.from;
    let body = "";

    if (!numerosAutorizados.includes(from)) {
      console.log("⛔ Número não autorizado:", from);
      return res.sendStatus(200);
    }

    if (entry.type === "text") {
      body = entry.text.body;
    } else if (entry.type === "audio") {
      const audioBuffer = await downloadMedia(entry.audio.id);
      body = audioBuffer ? await falar(audioBuffer) : "❌ Falha transcrição";
    } else if (entry.type === "document") {
      const pdfBuffer = await downloadMedia(entry.document.id);
      const pdfPath = `./src/utils/pdfs/${entry.document.filename}`;
      await fs.promises.writeFile(pdfPath, pdfBuffer);
      await sendMessage(from, `✅ Documento salvo: ${entry.document.filename}`);
      return res.sendStatus(200);
    } else {
      await sendMessage(from, "Formato não suportado.");
      return res.sendStatus(200);
    }

    body = body.trim();

    await salvarMemoria(from, { ultimaMensagem: body });
    const memoria = await buscarMemoria(from);

    const messages = [
      { role: "system", content: "Você é a Donna, assistente pessoal. Respostas diretas e curtas." },
      ...(memoria?.memoria
        ? Object.entries(memoria.memoria).map(([key, value]) => ({
            role: "assistant",
            content: `${key}: ${value}`,
          }))
        : []),
      { role: "user", content: body },
    ];

    const sanitized = messages
      .map(m => ({ role: m.role, content: String(m.content || "").trim() }))
      .filter(m => m.content);

    const reply = await askGPT(sanitized);
    await salvarMemoria(from, { ultimaResposta: reply });
    await sendMessage(from, reply.trim());

    return res.sendStatus(200);
  } catch (err) {
    console.error("🔥 Erro webhook:", err?.message || err);
    return res.sendStatus(500);
  }
});

// Função WhatsApp
async function sendMessage(to, message = "⚠️ Sem conteúdo.") {
  try {
    await axios.post(
      `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_ID}/messages`,
      { messaging_product: "whatsapp", to, text: { body: message } },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
    );
    console.log("📤 Mensagem WhatsApp enviada:", message.trim());
  } catch (err) {
    console.error("❌ Erro ao enviar WhatsApp:", err.response?.data || err?.message || err);
  }
}

// AskGPT consolidado
async function askGPT(messages) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages,
      max_completion_tokens: 300,
    });
    return completion.choices?.[0]?.message?.content || "Pensando...";
  } catch (err) {
    console.warn("⚠️ OpenAI falhou:", err?.message || err);
    return "Pensando...";
  }
}

// Iniciar servidor
app.listen(PORT, () => console.log(`✅ Servidor rodando na porta ${PORT}`));

// Exportação das funções usadas
export {
  askGPT as askGPTService,
  salvarMemoria,
  buscarMemoria,
  limparMemoria,
  funcoesExtras,
  buscarPergunta,
  treinarDonna,
  obterResposta,
  setPapeis,
  clearPapeis,
  falar,
  sendAudio,
  getWeather,
  sendMessage
};
