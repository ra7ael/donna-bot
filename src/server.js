// src/server.js
import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { MongoClient } from "mongodb";
import { DateTime } from "luxon";
import path from "path";
import { fileURLToPath } from "url";

/* ========================= IMPORTS INTERNOS ========================= */
import { startReminderCron } from "./cron/reminders.js";
import { getWeather } from "./utils/weather.js";
import { salvarMemoria, consultarFatos } from "./utils/memory.js"; // se não usar mais, pode remover
import { addSemanticMemory, querySemanticMemory } from "./models/semanticMemory.js";
import { initRoutineFamily, handleCommand, handleReminder } from "./utils/routineFamily.js";
import { normalizeMessage, shouldIgnoreMessage } from "./utils/messageHelper.js";
import { salvarMemoriaNLP, consultarFatosNLP } from "./utils/memoryNLP.js";

/* ========================= CONFIG ========================= */
dotenv.config();
mongoose.set("bufferTimeoutMS", 90000);

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

/* ========================= PATH ========================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use("/audio", express.static(path.join(__dirname, "public/audio")));

/* ========================= ANTI-ECO ========================= */
const mensagensProcessadas = new Set();

/* ========================= DB ========================= */
let db;
let cronStarted = false;

async function connectDB() {
  const client = await MongoClient.connect(MONGO_URI, { serverSelectionTimeoutMS: 60000 });
  db = client.db("donna");

  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 60000 });

  if (!cronStarted) {
    startReminderCron(db, sendMessageIfNeeded);
    cronStarted = true;
    console.log("⏰ Cron iniciado");
  }
}

await connectDB();
await initRoutineFamily(db, sendMessage);

/* ========================= HELPERS ========================= */
function dividirMensagem(texto, limite = 300) {
  const partes = [];
  let inicio = 0;
  while (inicio < texto.length) {
    let fim = inicio + limite;
    if (fim < texto.length) {
      fim = texto.lastIndexOf(" ", fim);
      if (fim === -1) fim = inicio + limite;
    }
    partes.push(texto.slice(inicio, fim).trim());
    inicio = fim + 1;
  }
  return partes;
}

async function sendMessage(to, text) {
  if (!to || !text) return;
  const partes = dividirMensagem(text);
  for (const parte of partes) {
    await axios.post(
      `https://graph.facebook.com/v24.0/${WHATSAPP_PHONE_ID}/messages`,
      { messaging_product: "whatsapp", to, text: { body: parte } },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
    );
  }
}

async function sendMessageIfNeeded(to, text) { await sendMessage(to, text); }

async function askGPT(prompt) {
  const contextoHorario = `Agora no Brasil são ${DateTime.now().setZone("America/Sao_Paulo").toLocaleString(DateTime.DATETIME_MED)}`;
  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: contextoHorario },
        { role: "system", content: "Você é Amber, inspirada em Donna Paulsen de Suits. Responda com firmeza e clareza, no máximo 2 frases." },
        { role: "user", content: prompt }
      ]
    },
    { headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" } }
  );
  return response.data.choices?.[0]?.message?.content || "Estou pensando nisso.";
}

/* ========================= FILTRO DE MEMÓRIA AUTOMÁTICA ========================= */
function extrairFatoAutomatico(texto) {
  const t = texto.toLowerCase();
  if (t.endsWith("?") || t.startsWith("oi") || t.startsWith("bom dia") || t.startsWith("boa tarde") || t.startsWith("boa noite") || t.startsWith("obrigado")) return null;
  if (t.includes("eu tenho") || t.includes("meu nome é") || t.includes("eu sou") || t.includes("sou casado") || t.includes("tenho filhos") || t.includes("trabalho com")) return texto.trim();
  return null;
}

function responderComMemoriaNatural(pergunta, fatos) {
  const p = pergunta.toLowerCase();
  if (p.includes("meu nome") && fatos.nome) return `Seu nome é ${fatos.nome}`;
  if (p.includes("quantos filhos") && fatos.filhos !== undefined) return `Você tem ${fatos.filhos} filhos`;
  if (p.includes("quantas gatas") && fatos.gatas !== undefined) return `Você tem ${fatos.gatas} gatas`;
  return null;
}

/* ========================= WEBHOOK ========================= */
app.post("/webhook", async (req, res) => {
  try {
    const messageObj = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const from = messageObj?.from;
    if (!messageObj || shouldIgnoreMessage(messageObj, from)) return res.sendStatus(200);

    const normalized = normalizeMessage(messageObj);
    if (!normalized) return res.sendStatus(200);

    const { body, bodyLower, type } = normalized;
    if (!["text", "document"].includes(type)) return res.sendStatus(200);

    const messageId = messageObj.id;
    if (mensagensProcessadas.has(messageId)) return res.sendStatus(200);
    mensagensProcessadas.add(messageId);
    setTimeout(() => mensagensProcessadas.delete(messageId), 300000);

    /* ===== MEMÓRIA MANUAL NLP ===== */
    if (bodyLower.startsWith("lembre que")) {
      const fato = body.replace(/lembre que/i, "").trim();
      await salvarMemoriaNLP(from, fato);
      await sendMessage(from, "📌 Guardado.");
      return res.sendStatus(200);
    }

    if (bodyLower.includes("o que você lembra")) {
      const fatos = await consultarFatosNLP(from);
      if (!Object.keys(fatos).length) await sendMessage(from, "Nada salvo ainda.");
      else {
        const resposta = Object.entries(fatos).map(([chave, valor]) => `${chave}: ${valor}`).join("\n");
        await sendMessage(from, resposta);
      }
      return res.sendStatus(200);
    }

    /* ===== MEMÓRIA AUTOMÁTICA FACTUAL ===== */
    const fatoDetectado = extrairFatoAutomatico(body);
    if (fatoDetectado) await salvarMemoriaNLP(from, fatoDetectado);

    /* ===== COMANDOS ===== */
    if (await handleCommand(body, from) || await handleReminder(body, from)) return res.sendStatus(200);

    /* ===== CLIMA ===== */
    if (bodyLower.includes("clima") || bodyLower.includes("tempo")) {
      await sendMessage(from, await getWeather("Curitiba", "hoje"));
      return res.sendStatus(200);
    }

    /* ===== IA FINAL COM MEMÓRIA ===== */
    const fatos = await consultarFatosNLP(from);
    const memoriaSemantica = await querySemanticMemory(body, from, 3);

    const respostaDireta = responderComMemoriaNatural(body, fatos);
    if (respostaDireta) { await sendMessage(from, respostaDireta); return res.sendStatus(200); }

    let contexto = "";
    if (Object.keys(fatos).length) {
      contexto += "FATOS CONHECIDOS SOBRE O USUÁRIO:\n" + Object.entries(fatos).map(([k,v]) => `- ${k}: ${v}`).join("\n") + "\n\n";
    }
    if (memoriaSemantica?.length) {
      contexto += "CONTEXTO DE CONVERSAS PASSADAS:\n" + memoriaSemantica.map(m => `- ${m}`).join("\n") + "\n\n";
    }

    const resposta = await askGPT(`${contexto}Pergunta do usuário: ${body}`);
    await sendMessage(from, resposta);
    await addSemanticMemory(body, resposta, from, "assistant");

    return res.sendStatus(200);
  } catch (err) {
    console.error("❌ Erro webhook:", err);
    return res.sendStatus(500);
  }
});

/* ========================= START ========================= */
app.listen(PORT, () => {
  console.log(`✅ Donna rodando na porta ${PORT}`);
});
