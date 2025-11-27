// src/server.js
import express from 'express';
import OpenAI from "openai";
import { MongoClient } from 'mongodb';
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import bodyParser from 'body-parser';
import axios from 'axios';
import dotenv from 'dotenv';
import mongoose from "mongoose";
import { DateTime } from 'luxon';
import { startReminderCron } from "./cron/reminders.js";
import { getWeather } from "./utils/weather.js";
import { downloadMedia } from './utils/downloadMedia.js';
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
import { querySemanticMemory } from "./utils/memory.js";

dotenv.config();

// ✅ único app express consolidado
const app = express();
app.use(bodyParser.json());
const upload = multer({ dest: "uploads/" });

// ================= Global error handlers =================
process.on('uncaughtException', (err) => {
  console.error('🔥 Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('🔥 Unhandled Rejection:', reason);
});

// ===== Papéis Profissionais =====
const profissoes = [
  "Enfermeira Obstetra","Médica","Nutricionista","Personal Trainer","Psicóloga","Coach de Produtividade",
  "Consultora de RH","Advogada","Contadora","Engenheira Civil","Arquiteta","Designer Gráfica",
  "Professora de Inglês","Professora de Matemática","Professora de História","Cientista de Dados",
  "Desenvolvedora Full Stack","Especialista em IA","Social Media","Especialista em SEO","E-commerce",
  "Recrutadora","Mentora de Startups","Administradora de Sistemas","Especialista em Redes","Chef de Cozinha"
];

let papelAtual = null;
let papeisCombinados = [];

// Função para verificar troca/composição de papéis profissionais
function verificarComandoProfissao(texto) {
  const textoLower = texto.toLowerCase();

  if (
    textoLower.includes("sair do papel") ||
    textoLower.includes("volte a ser assistente") ||
    textoLower.includes("saia do papel")
  ) {
    papelAtual = null;
    papeisCombinados = [];
    clearPapeis();
    return { tipo: "saida", resposta: "Ok! 😊 Assistente pessoal reativado." };
  }

  for (const p of profissoes) {
    const pLower = p.toLowerCase();
    if (
      textoLower.includes(`você é ${pLower}`) ||
      textoLower.includes(`seja meu ${pLower}`) ||
      textoLower.includes(`ajude-me como ${pLower}`) ||
      textoLower === pLower
    ) {
      papelAtual = p;
      papeisCombinados = [p];
      setPapeis([p]);
      return { tipo: "papel", resposta: `💼 Papel definido: ${p}. Pode enviar a demanda!` };
    }
  }

  const combinarMatch = textoLower.match(/(misture|combine|junte) (.+)/i);
  if (combinarMatch) {
    const solicitados = combinarMatch[2].split(/,| e /).map(s => s.trim());
    const validos = solicitados.filter(s =>
      profissoes.map(p => p.toLowerCase()).includes(s.toLowerCase())
    );
    if (validos.length > 0) {
      papelAtual = "Múltiplos";
      papeisCombinados = validos;
      setPapeis(validos);
      return { tipo: "papel", resposta: `🧠 Papéis combinados: ${validos.join(" + ")}. Pode mandar!` };
    } else {
      return { tipo: "erro", resposta: "❌ Perfis não reconhecidos. Confirme os nomes?" };
    }
  }

  return null;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use('/audio', express.static(path.join(__dirname, 'public/audio')));

// OpenAI client (1× e intacto)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Mongo globals
let db = null;
let mongoClientInstance = null;
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

// ===== Função WhatsApp consolidada =====
async function sendMessage(to, message) {
  if (!message) message = "⚠️ Sem conteúdo de retorno.";

  try {
    await axios.post(
      `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_ID}/messages`,
      { messaging_product: "whatsapp", to, text: { body: message } },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
    );
    console.log("📤 Enviado WhatsApp:", message);
  } catch (err) {
    console.error("❌ WhatsApp falhou:", err.message);
  }
}

// ===== askGPT intacta e protegida =====
async function askGPT(messages) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: messages.filter(m => typeof m.content === "string" && m.content.trim()),
      max_completion_tokens: 300,

    });
    return String(completion.choices?.[0]?.message?.content || "");
  } catch (err) {
    console.warn("⚠️ OpenAI falhou:", err.message);
    return "Pensando…";
  }
}

// ===== salvar memória semântica =====
async function saveMemory(number, role, content, embedding = null, key = null) {
  if (!db || !content?.trim()) return;
  try {
    await db.collection("semanticMemory").updateOne(
      key ? { userId: number, key } : { userId: number, timestamp: { $exists: true } },
      { $set: { userId: number, role, content, embedding, key, timestamp: new Date() } },
      { upsert: true }
    );
  } catch (err) {
    console.warn("⚠️ Memória não gravada:", err.message);
  }
}

// ===== buscar memória semântica =====
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

async function connectMongo() {
  try {
    if (!MONGO_URI) throw new Error("MONGO_URI ausente");

    console.log("🔹 Conectando…");
    const client = await MongoClient.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000
    });

    mongoClientInstance = client;
    db = client.db();
    console.log("✅ Banco conectado e normal.");

    startReminderCron(db, sendMessage);
  } catch (err) {
    console.error("❌ Mongo não conectou:", err.message);
  }
}

connectMongo();

// ===== Webhook consolidado =====
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!entry) return res.sendStatus(200);

    const from = entry.from;
    let body = "";

    if (!numerosAutorizados.includes(from)) {
      console.log("⛔ Não autorizado:", from);
      return res.sendStatus(200);
    }

    if (entry.type === "text") {
      body = entry.text.body;
    } else if (entry.type === "audio") {
      const audioBuffer = await downloadMedia(entry.audio.id);
      body = audioBuffer ? await transcribeAudio(audioBuffer) : "❌ Falha transcrição.";
    } else if (entry.type === "document") {
      const pdfBuffer = await downloadMedia(entry.document.id);
      const pdfPath = `./src/utils/pdfs/${entry.document.filename}`;
      fs.writeFileSync(pdfPath, pdfBuffer);
      await sendMessage(from, `✅ PDF salvo: ${entry.document.filename}`);
      return res.sendStatus(200);
    } else {
      await sendMessage(from, "Formato não suportado.");
      return res.sendStatus(200);
    }

    body = body.trim();
    await saveMemory(from, "user", body);

    const memories = await findRelevantMemory(from, 3);
    const messages = [
      { role: "system", content: "Você é a Donna, asistente pessoal do Rafael, responda com frases curtas sem inventar informações." },
      ...memories.map(m => ({
          role: "assistant",
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content)
      })),
      { role: "user", content: body }
    ];
    
    const sanitizedMessages = messages.map(m => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content.trim() : ""
    }));
    
    const reply = await askGPT(sanitizedMessages);
    await sendMessage(from, reply);
    await saveMemory(from, "assistant", reply);

    return res.sendStatus(200);

  } catch (err) {
    console.error("🔥 Crash:", err.message);
    return res.sendStatus(500);
  }
});

app.listen(PORT, () => console.log(`✅ Rodando na porta ${PORT}`));

// ✅ exportando apenas o que existe aqui
export {
  askGPT,
  saveMemory,
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
  sendMessage
};
