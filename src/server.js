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

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const GPT_API_KEY = process.env.OPENAI_API_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

// OpenAI client
const openai = new OpenAI({ apiKey: GPT_API_KEY });

let db = null;
let mongoClientInstance = null;

// ===== Mongo Connection =====
async function connectDB() {
  try {
    if (!MONGO_URI) throw new Error("MONGO_URI não configurado");

    console.log("🔹 Tentando conectar ao MongoDB...");
    const client = await MongoClient.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000
    });

    mongoClientInstance = client;
    db = client.db();
    console.log("✅ Mongo conectado.");

    startReminderCron(db, sendMessage);

  } catch (err) {
    console.error("❌ Mongo não conectou:", err.message || err);
  }
}
connectDB();

// ===== PDF Upload Route =====
app.post("/upload-pdf", upload.single("pdf"), async (req, res) => {
  try {
    const data = fs.readFileSync(req.file.path);
    const parsed = await pdfParse(data);
    await db.collection("pdfs").insertOne({
      numero: req.body.from,
      filename: req.file.originalname,
      text: parsed.text,
      timestamp: new Date()
    });
    res.send(`✅ PDF "${req.file.originalname}" salvo.`);
  } catch (err) {
    console.error("❌ upload-pdf:", err.message);
    res.status(500).send("Erro no upload PDF.");
  }
});

// ===== Memory Save =====
async function saveMemory(number, role, content) {
  if (!db || !content?.trim()) return;
  try {
    await db.collection("semanticMemory").insertOne({
      numero: number,
      role,
      content,
      timestamp: new Date()
    });
  } catch (err) {
    console.warn("⚠️ saveMemory:", err.message);
  }
}

// ===== Semantic search FIXED (patch do seu pedido) =====
const semanticCache = new Map();

async function fetchSemanticMemoriesWithTimeout(query, numero, limit = 5, maxWindowDays = 30, timeoutMs = 4000) {
  if (!db || !query?.trim() || !numero) return [];

  const cacheKey = `${numero}::${query}`;
  if (semanticCache.has(cacheKey)) return semanticCache.get(cacheKey);

  try {
    const fromDate = new Date(Date.now() - maxWindowDays * 24 * 60 * 60 * 1000);

    // 🔧 correção do nome da função importada (agora correto)
    const search = querySemanticMemory(query, numero, limit, fromDate);

    const mems = await Promise.race([
      search,
      new Promise(resolve => setTimeout(() => resolve([]), timeoutMs))
    ]);

    const normalized = Array.isArray(mems)
      ? mems.map(m => typeof m === "string" ? m : m?.content || "").filter(Boolean).slice(0, limit)
      : [];

    semanticCache.set(cacheKey, normalized);
    setTimeout(() => semanticCache.delete(cacheKey), 5 * 60 * 1000);

    return normalized;
  } catch (err) {
    console.warn("⚠️ fetchSemanticMemories:", err.message);
    return [];
  }
}


// ===== Webhook =====
const userStates = {};

app.post("/webhook", async (req, res) => {
  try {
    const messageObj = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!messageObj) return res.sendStatus(200);

    const from = messageObj.from;
    const autorizado = numerosAutorizados.includes(from);
    if (!autorizado) {
      console.log("⛔ Número não autorizado:", from);
      return res.sendStatus(200);
    }

    let body = "";
    if (messageObj.type === "text") {
      body = messageObj.text?.body || "";
    } else if (messageObj.type === "audio") {
      const audioBuffer = await downloadMedia(messageObj.audio?.id);
      if (audioBuffer) body = await transcribeAudio(audioBuffer);
    }

    await saveMemory(from, "user", body);

    // extrair dados a salvar automaticamente
    const autoMem = await extractAutoMemoryGPT(from, body) || {};
    if (autoMem.nome) await saveMemory(from, "assistant", `Nome: ${autoMem.nome}`);
    if (autoMem.nomes_dos_filhos?.length)
      await saveMemory(from, "assistant", `Filhos: ${autoMem.nomes_dos_filhos.join(" e ")}`);
    if (autoMem.trabalho?.empresa)
      await saveMemory(from, "assistant", `Cargo: ${autoMem.trabalho.cargo} na ${autoMem.trabalho.empresa}`);

    const semMem = await fetchSemanticMemoriesWithTimeout(body, from, 5, 30, 4000);

    const papelCmd = verificarComandoProfissao(body);
    if (papelCmd) {
      await sendMessage(from, papelCmd.resposta);
      return res.sendStatus(200);
    }

    const systemMessage = { role: "system", content: "Você é a Donna, responda curto." };
    const history = await getUserMemory(from, 10);

    const messages = [
      systemMessage,
      ...semMem.map(m => ({ role: "assistant", content: m })),
      ...history.map(h => ({ role: h.role, content: h.content })),
      { role: "user", content: body }
    ];

    let reply = await askGPT(messages);

    // se recebeu áudio, tentar TTS
    if (messageObj.type === "audio") {
      const audioOut = await falar(reply);
      if (audioOut) await sendAudio(from, audioOut);
      else await sendMessage(from, reply);
    } else {
      await sendMessage(from, reply);
    }

    await saveMemory(from, "assistant", reply);
    return res.sendStatus(200);

  } catch (err) {
    console.error("❌ webhook:", err.message);
    return res.sendStatus(500);
  }
});

// ===== Ask GPT =====
async function askGPT(messages, timeoutMs = 10000) {
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: messages.filter(m => m?.content?.trim()),
        max_tokens: 300,
        temperature: 0.7
      },
      {
        headers: {
          Authorization: `Bearer ${GPT_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: timeoutMs
      }
    );

    return response.data.choices?.[0]?.message?.content || "";
  } catch (err) {
    console.warn("⚠️ askGPT:", err.message);
    return "";
  }
}

async function transcribeAudio(buffer) {
  try {
    const form = new FormData();
    form.append("file", buffer, { filename: "audio.ogg" });
    form.append("model", "whisper-1");
    const r = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      form,
      { headers: { Authorization: `Bearer ${GPT_API_KEY}`, ...form.getHeaders() }, timeout: 15000 }
    );
    return r.data?.text || "";
  } catch (e) {
    console.warn("⚠️ transcribe:", e.message);
    return "";
  }
}

// ===== Consultar memória recent =====
async function getUserMemory(number, limit = 5) {
  if (!db) return [];
  return await db.collection("semanticMemory")
    .find({ numero: number })
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();
}

// ===== Clima / extras permanecem funcionais =====
app.get("/weather/:city", async (req, res) => {
  const weather = await getWeather(req.params.city);
  res.json(weather);
});

app.get("/buscar-pdf", async (req, res) => {
  const answer = await buscarPergunta(req.query.pergunta);
  res.json({ answer });
});

// ===== Servidor sobe 1× =====
app.listen(PORT, () => console.log(`✅ Donna online na porta ${PORT}`));

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
