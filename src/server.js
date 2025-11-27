// src/server.js
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import OpenAI from "openai";
import { MongoClient } from "mongodb";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import bodyParser from "body-parser";
import axios from "axios";
import mongoose from "mongoose";
import { DateTime } from "luxon";
import { startReminderCron } from "./cron/reminders.js";
import { getWeather } from "./utils/weather.js";
import { downloadMedia } from "./utils/downloadMedia.js";
import cron from "node-cron";
import { numerosAutorizados } from "./config/autorizados.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import FormData from "form-data";
import { falar, sendAudio } from "./utils/speak.js";
import { treinarDonna, obterResposta, setPapeis, clearPapeis } from "./utils/treinoDonna.js";
import { buscarPergunta } from "./utils/buscarPdf.js";
import multer from "multer";
import { funcoesExtras } from "./utils/funcoesExtras.js";
import { extractAutoMemoryGPT } from "./utils/autoMemoryGPT.js";
import Memoria from "./models/memory.js"; // ✅ model correto do Mongoose
import { limparMemoria, salvarMemoria, buscarMemoria } from "./utils/memory.js"; // ✅ utils intacta e agora funcionando

// Express app
const app = express();
app.use(bodyParser.json());
const upload = multer({ dest: "uploads/" });
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use("/audio", express.static(path.join(__dirname, "public/audio")));

// Global handlers
process.on("uncaughtException", err => console.error("🔥 Uncaught Exception:", err));
process.on("unhandledRejection", reason => console.error("🔥 Unhandled Rejection:", reason));

// Papéis profissionais
const profissoes = ["Enfermeira Obstetra","Médica","Nutricionista","Personal Trainer","Psicóloga","Coach de Produtividade","Consultora de RH","Advogada","Contadora","Engenheira Civil","Arquiteta","Designer Gráfica","Professora de Inglês","Professora de Matemática","Professora de História","Cientista de Dados","Desenvolvedora Full Stack","Especialista em IA","Social Media","Especialista em SEO","E-commerce","Recrutadora","Mentora de Startups","Administradora de Sistemas","Especialista em Redes","Chef de Cozinha"];

let papelAtual = null;
let papeisCombinados = [];

function verificarComandoProfissao(texto) {
  const lower = texto.toLowerCase();
  if (lower.includes("sair do papel") || lower.includes("volte a ser assistente") || lower.includes("saia do papel")) {
    papelAtual = null;
    papeisCombinados = [];
    clearPapeis();
    return { tipo: "saida", resposta: "Ok! 😊 Assistente reativado." };
  }
  for (const p of profissoes) {
    if (lower.includes(`você é ${p.toLowerCase()}`) || lower.includes(`seja meu ${p.toLowerCase()}`) || lower === p.toLowerCase()) {
      papelAtual = p;
      papeisCombinados = [p];
      setPapeis([p]);
      return { tipo: "papel", resposta: `💼 Papel ativo: ${p}. Pode seguir.` };
    }
  }
  const match = lower.match(/(misture|combine|junte) (.+)/i);
  if (match) {
    const solicitados = match[2].split(/,| e /).map(s => s.trim());
    const validos = solicitados.filter(s => profissoes.map(x => x.toLowerCase()).includes(s.toLowerCase()));
    if (validos.length) {
      papelAtual = "Múltiplos";
      papeisCombinados = validos;
      setPapeis(validos);
      return { tipo: "papel", resposta: `🧠 Perfis combinados: ${validos.join(" + ")}` };
    }
    return { tipo: "erro", resposta: "❌ Papéis não encontrados." };
  }
  return null;
}

// OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Mongo conexão oficial (1×)
let db = null;
let mongoClient = null;
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;

async function connectMongo() {
  if (db) return db;
  try {
    console.log("🔹 Conectando ao MongoClient...");
    mongoClient = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 5000, socketTimeoutMS: 10000 });
    await mongoClient.connect();
    db = mongoClient.db("donna");
    console.log("✅ MongoClient pronto.");
    startReminderCron(db);
    return db;
  } catch (err) {
    console.error("❌ MongoClient falhou:", err.message);
    throw err;
  }
}

// Conexão do Mongoose (separada, inicializada antes do webhook)
async function connectMongoose() {
  try {
    console.log("🔹 Conectando ao Mongoose...");
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000, socketTimeoutMS: 10000 });
    console.log("✅ Mongoose pronto.");
  } catch (err) {
    console.error("❌ Mongoose falhou:", err.message);
  }
}

// Inicializa as duas conexões antes do servidor subir
await connectMongo();
await connectMongoose();

// WhatsApp API consolidada
async function sendMessage(numero, message) {
  if (!message?.trim()) message = "⚠️ Sem conteúdo.";
  try {
    await axios.post(
      `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_ID}/messages`,
      { messaging_product: "whatsapp", to: numero, text: { body: message } },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
    );
    console.log("📤 Enviado:", message);
  } catch (err) {
    console.error("❌ WhatsApp falhou:", err.message);
  }
}

// GPT ask sem alteração lógica
async function askGPT(messages) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: messages.filter(m => m.content?.trim()),
      max_completion_tokens: 300,
    });
    return String(completion.choices?.[0]?.message?.content || "");
  } catch (err) {
    console.warn("⚠️ GPT falhou:", err.message);
    return "Pensando...";
  }
}

// Buscar mems sem alterar schema
async function findRelevantMemory(numero, limit = 3, timeoutMs = 4000, maxWindowDays = 30) {
  if (!db) return [];
  const fromDate = new Date(Date.now() - maxWindowDays * 24 * 60 * 60 * 1000);
  try {
    const search = db.collection("semanticMemory")
      .find({ userId: numero, timestamp: { $gte: fromDate } })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();

    const mems = await Promise.race([
      search,
      new Promise(resolve => setTimeout(() => resolve([]), timeoutMs))
    ]);

    return Array.isArray(mems) ? mems.slice(0, limit) : [];
  } catch (err) {
    console.warn("⚠️ Falha ao buscar mems:", err.message);
    return [];
  }
}

// Webhook intacto, agora com Mongoose sem timeout
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!entry) return res.sendStatus(200);

    const from = entry.from;
    if (!numerosAutorizados.includes(from)) return res.sendStatus(200);

    let body = "";
    if (entry.type === "text") body = entry.text.body;
    else if (entry.type === "audio") body = (await obterResposta(await downloadMedia(entry.audio.id))) || "❌ Falha áudio.";
    else if (entry.type === "document") {
      const pdfBuffer = await downloadMedia(entry.document.id);
      const pdfPath = path.join(__dirname, "uploads", entry.document.filename);
      fs.writeFileSync(pdfPath, pdfBuffer);
      await sendMessage(from, `✅ PDF salvo: ${entry.document.filename}`);
      return res.sendStatus(200);
    }

    body = body.trim();
    await salvarMemoria(from, { ultimaMensagem: body }); // ✅ grava no model sem falhar
    const memories = await findRelevantMemory(from);

    const messages = [
      { role: "system", content: "Responda curto." },
      ...memories.map(m => ({ role: "assistant", content: m.content })),
      { role: "user", content: body }
    ];

    const reply = await askGPT(messages);
    await sendMessage(from, reply);
    await saveMemory(from, "assistant", reply);
    return res.sendStatus(200);

  } catch (err) {
    console.error("🔥 Webhook crash:", err.message);
    return res.sendStatus(500);
  }
});

// Servidor sobe normalmente
app.listen(PORT, () => console.log(`✅ Rodando na porta ${PORT}`));

// Export intacto
export {
  askGPT,
  db,
  funcoesExtras,
  buscarPergunta,
  treinarDonna,
  obterResposta,
  setPapeis,
  clearPapeis,
  falar,
  sendAudio,
  getWeather,
  sendMessage,
  salvarMemoria,
  buscarMemoria,
  limparMemoria
};
