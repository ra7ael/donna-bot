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
import { querySemanticMemory } from "./models/semanticMemory.js";

dotenv.config();
const app = express();
app.use(bodyParser.json());

// Multer para upload de arquivos
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
  "Enfermeira Obstetra","Médica", "Nutricionista", "Personal Trainer", "Psicóloga", "Coach de Produtividade",
  "Consultora de RH", "Advogada", "Contadora", "Engenheira Civil", "Arquiteta",
  "Designer Gráfica", "Professora de Inglês", "Professora de Matemática", "Professora de História",
  "Cientista de Dados", "Desenvolvedora Full Stack", "Especialista em IA", "Marketing Manager",
  "Copywriter", "Redatora Publicitária", "Social Media", "Especialista em SEO", "Especialista em E-commerce",
  "Consultora Financeira", "Analista de Investimentos", "Corretora de Imóveis", "Jornalista", "Editora de Vídeo",
  "Fotógrafa", "Música", "Chef de Cozinha", "Sommelier", "Designer de Moda", "Estilista",
  "Terapeuta Holística", "Consultora de Carreira", "Recrutadora", "Especialista em Treinamento Corporativo",
  "Mentora de Startups", "Engenheira de Software", "Administradora de Sistemas", "Especialista em Redes",
  "Advogada Trabalhista", "Advogada Civil", "Psicopedagoga", "Fisioterapeuta", "Enfermeira",
  "Pediatra", "Oftalmologista", "Dentista", "Barista", "Coach de Inteligência Emocional"
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
    return { tipo: "saida", resposta: "Ok! 😊 Voltei a ser sua assistente pessoal." };
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
      return { tipo: "papel", resposta: `💼 Ativada: ${p}. O que vamos resolver?` };
    }
  }

  const combinarMatch = textoLower.match(/(misture|combine|junte) (.+)/i);
  if (combinarMatch) {
    const solicitados = combinarMatch[2].split(/,| e /).map(s => s.trim());
    const validos = solicitados.filter(s =>
      profissoes.map(p => p.toLowerCase()).includes(s.toLowerCase())
    );
    if (validos.length > 0) {
      papelAtual = "Multiplos";
      papeisCombinados = validos;
      setPapeis(validos);
      return { tipo: "papel", resposta: `🧠 Papéis combinados: ${validos.join(" + ")}. Pode mandar a demanda.` };
    } else {
      return { tipo: "erro", resposta: "❌ Não reconheci esses papéis. Pode ajustar os nomes?" };
    }
  }

  return null;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use('/audio', express.static(path.join(__dirname, 'public/audio')));

const app = express();
app.use(bodyParser.json());
const upload = multer({ dest: "uploads/" });

// OpenAI client (declarado apenas 1×)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Mongo globals (inicializados sem duplicação)
let db = null;
let mongoClientInstance = null;
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

// ===== WhatsApp sendMessage (declarada 1×, usada em todo o server) =====
async function sendMessage(to, message) {
  if (!message) message = "❌ Ocorreu um erro ao processar sua solicitação.";

  try {
    await axios.post(
      `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_ID}/messages`,
      { messaging_product: "whatsapp", to, text: { body: message } },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
    );
    console.log("📤 WhatsApp enviado:", message);
  } catch (err) {
    console.error("❌ WhatsApp error:", err.message);
  }
}

// ===== askGPT (agora usa openai direto, mais atual e resiliente) =====
async function askGPT(messages, timeoutMs = 10000) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: messages.filter(m => m.content?.trim()),
      max_tokens: 300,
      temperature: 0.7
    });
    return completion.choices?.[0]?.message?.content || "Hmm… sem resposta ainda.";
  } catch (err) {
    console.warn("⚠️ GPT timeout/erro:", err.message);
    return "Hmm… ainda estou pensando!";
  }
}

// ===== salvar memória semântica (sem tirar sua lógica futura de embeddings) =====
async function saveMemory(number, role, content, embedding = null, key = null) {
  if (!db || !content?.trim()) return;
  try {
    await db.collection("semanticMemory").updateOne(
      key ? { userId: number, key } : { userId: number, timestamp: { $exists: true } },
      { $set: { userId: number, role, content, embedding, key, timestamp: new Date() } },
      { upsert: true }
    );
  } catch (err) {
    console.warn("⚠️ saveMemory:", err.message);
  }
}

// ===== buscar memória semântica com timeout, sem travar =====
async function findRelevantMemory(numero, query, limit = 3, timeoutMs = 4000, maxWindowDays = 30) {
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
    console.warn("⚠️ findRelevantMemory:", err.message);
    return [];
  }
}

// ===== rota para receber PDFs pela web =====
app.post("/upload-pdf", upload.single("pdf"), async (req, res) => {
  try {
    console.log(`📥 Recebido PDF: ${req.file.originalname}`);
    const data = fs.readFileSync(req.file.path);
    const parsed = await pdfParse(data);

    if (!db) throw new Error("Mongo não disponível para salvar PDF");

    await db.collection("pdfs").insertOne({
      userId: req.body.from,
      filename: req.file.originalname,
      text: parsed.text,
      timestamp: new Date()
    });

    res.send(`✅ PDF "${req.file.originalname}" salvo e indexado!`);
  } catch (err) {
    console.error("❌ PDF upload:", err.message);
    res.status(500).send("Erro no upload PDF");
  }
});

// ===== rota de clima já estava funcionando, mantida intacta =====
app.get("/weather/:city", async (req, res) => {
  const weather = await getWeather(req.params.city);
  res.json(weather);
});

app.get("/buscar-pdf", async (req, res) => {
  const answer = await buscarPergunta(req.query.pergunta);
  res.json({ answer });
});

// ================= Mongo Connection (única) =================
async function connectMongo() {
  try {
    if (!MONGO_URI) throw new Error("MONGO_URI ausente");

    console.log("🔹 MongoDB…");
    const client = await MongoClient.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000
    });

    mongoClientInstance = client;
    db = client.db();
    console.log("✅ Donna online e Mongo ok!");

    startReminderCron(db, sendMessage);
  } catch (err) {
    console.error("❌ Mongo error:", err.message);
  }
}

connectMongo();

// ================= Webhook WhatsApp (único e consolidado) =================
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
      body = audioBuffer ? await transcribeAudio(audioBuffer) : "❌ Áudio não processado.";
    } else if (entry.type === "document") {
      const pdfBuffer = await downloadMedia(entry.document.id);
      const pdfPath = `./src/utils/pdfs/${entry.document.filename}`;
      fs.writeFileSync(pdfPath, pdfBuffer);
      await processarPdf(pdfPath);
      await sendMessage(from, `✅ PDF salvo: ${entry.document.filename}`);
      return res.sendStatus(200);
    } else {
      await sendMessage(from, "Apenas texto, áudio e PDF 😉");
      return res.sendStatus(200);
    }

    body = body.trim();
    await saveMemory(from, "user", body);

    const memories = await findRelevantMemory(from, body, 3);
    const messages = [
      { role: "system", content: "Você é a Donna, responda curto." },
      ...memories.map(m => ({ role: "assistant", content: m.content })),
      { role: "user", content: body }
    ];

    let reply = await askGPT(messages);

    if (entry.type === "audio") {
      const audioOut = await falar(reply);
      if (audioOut) await sendAudio(from, audioOut);
      else await sendMessage(from, reply);
    } else {
      await sendMessage(from, reply);
    }

    await saveMemory(from, "assistant", reply);
    return res.sendStatus(200);

  } catch (err) {
    console.error("🔥 Webhook crash:", err.message);
    return res.sendStatus(500);
  }
});

app.listen(PORT, () => console.log(`✅ Donna rodando na porta ${PORT}`));

// exportações finais
export {
  askGPT,
  getUserMemory,
  fetchSemanticMemoriesWithTimeout,
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
  getWeather
};
