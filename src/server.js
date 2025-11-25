// src/server.js
import express from 'express';
import OpenAI from "openai";
import { MongoClient } from 'mongodb';
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import bodyParser from "body-parser";
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
import { querySemanticMemory } from "./models/semanticMemory.js"; // ajuste o caminho se necessário

dotenv.config();
const app = express();
app.use(bodyParser.json());
const upload = multer({ dest: "uploads/" });

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

let papelAtual = null; // Papel profissional atual
let papeisCombinados = [];

// ===== Função para checar comandos de papéis =====
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
      return { tipo: "papel", resposta: `Perfeito! Agora estou no papel de ${p}. O que deseja?` };
    }
  }

  const combinarMatch = textoLower.match(/(misture|combine|junte) (.+)/i);
  if (combinarMatch) {
    const solicitados = combinarMatch[2].split(/,| e /).map(s => s.trim());
    const validos = solicitados.filter(s =>
      profissoes.map(p => p.toLowerCase()).includes(s.toLowerCase())
    );
    if (validos.length > 0) {
      papeisCombinados = validos;
      papelAtual = "Multiplos";
      setPapeis(validos);
      return { tipo: "papel", resposta: `Beleza! Vou atuar como ${validos.join(" + ")}. Qual sua dúvida?` };
    } else {
      return { tipo: "erro", resposta: "Não reconheci esses papéis — verifique a grafia ou escolha outros." };
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

const openai = new OpenAI({ apiKey: GPT_API_KEY });
let db;

async function connectDB() {
  try {
    console.log("🔹 Tentando conectar ao MongoDB...");
    const client = await MongoClient.connect(MONGO_URI, { useUnifiedTopology: true });
    db = client.db();
    console.log('✅ Conectado ao MongoDB (histórico, usuários, agenda)');
    startReminderCron(db, sendMessage);
  } catch (err) {
    console.error('❌ Erro ao conectar ao MongoDB:', err.message);
  }
}
connectDB();

const empresasPath = path.resolve("./src/data/empresa.json");
const empresas = JSON.parse(fs.readFileSync(empresasPath, "utf8"));
const userStates = {};


// ===== ROTA PARA RECEBER PDFs =====
app.post("/upload-pdf", upload.single("pdf"), async (req, res) => {
  try {
    console.log(`📥 Recebido PDF: ${req.file.originalname}`);
    await processarPdf(req.file.path);
    res.send(`✅ PDF ${req.file.originalname} processado e salvo no MongoDB!`);
  } catch (err) {
    console.error("❌ Erro ao processar PDF:", err);
    res.status(500).send("Erro ao processar PDF");
  }
});

// ===== Funções de GPT, WhatsApp, Memória, etc =====
async function askGPT(prompt, history = []) {
  try {
    const safeMessages = history
      .map(m => ({ role: m.role, content: typeof m.content === "string" ? m.content : "" }))
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

async function sendMessage(to, message) {
  if (!message) message = "❌ Ocorreu um erro ao processar sua solicitação. Tente novamente.";

  let textBody = "";
  if (typeof message === "string") {
    textBody = message;
  } else if (typeof message === "object") {
    if (message.resposta && typeof message.resposta === "string") {
      textBody = message.resposta;
    } else if (message.texto && typeof message.texto === "string") {
      textBody = message.texto;
    } else {
      textBody = JSON.stringify(message, null, 2);
    }
  } else {
    textBody = String(message);
  }

  try {
    await axios.post(
      `https://graph.facebook.com/v17.0/${WHATSAPP_PHONE_ID}/messages`,
      { messaging_product: "whatsapp", to, text: { body: textBody } },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
    );
    console.log("📤 Mensagem enviada:", textBody);
  } catch (err) {
    console.error("❌ Erro ao enviar WhatsApp:", err.response?.data || err);
  }
}

// ===== Outras funções auxiliares =====
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
  if (!content || !content.trim()) return;
  // Mantendo o esquema já utilizado no seu projeto: campo 'numero' e 'timestamp'
  await db.collection("semanticMemory").insertOne({ numero: number, role, content, timestamp: new Date() });
}

// transcrição (mantive sua implementação)
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

// ===== Funções de Agenda =====
async function addEvent(number, title, description, date, time) {
  await db.collection("agenda").insertOne({
    numero: number,
    titulo: title,
    descricao: description || title,
    data: date,
    hora: time,
    sent: false,
    timestamp: new Date()
  });
}

async function getTodayEvents(number) {
  const today = DateTime.now().toFormat("yyyy-MM-dd");
  return await db.collection("agenda").find({ numero: number, data: today }).sort({ hora: 1 }).toArray();
}


// ===== WEBHOOK OTIMIZADO =====
// cache curto para reduzir chamadas pesadas
const semanticCache = new Map();

// utilitário: busca memórias semânticas com timeout + cache
async function fetchSemanticMemoriesWithTimeout(query, numero, limit = 5, maxWindowDays = 30, timeoutMs = 4000) {
  try {
    const cacheKey = `${numero}:${query}:${limit}:${maxWindowDays}`;
    if (semanticCache.has(cacheKey)) return semanticCache.get(cacheKey);

    const fromDate = new Date(Date.now() - maxWindowDays * 24 * 60 * 60 * 1000);

    const mems = await Promise.race([
      // querySemanticMemory(existing) espera (query, userId, limit) e retorna array de respostas (strings)
      querySemanticMemory(query, numero, limit, fromDate),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout memória semântica")), timeoutMs))
    ]).catch(err => {
      console.warn("⚠️ fetchSemanticMemoriesWithTimeout:", err.message);
      return [];
    });

    // garantir array e limitar novamente
    const results = Array.isArray(mems) ? mems.slice(0, limit) : [];
    semanticCache.set(cacheKey, results);
    setTimeout(() => semanticCache.delete(cacheKey), 5 * 60 * 1000); // 5 min
    return results;
  } catch (err) {
    console.warn("⚠️ Erro fetchSemanticMemoriesWithTimeout:", err.message);
    return [];
  }
}

app.post("/webhook", async (req, res) => {
  try {
    const messageObj = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!messageObj) return res.sendStatus(200);

    const from = messageObj.from;
    let body = "";

    // Captura texto ou transcreve áudio
    if (messageObj.type === "text") {
      body = messageObj.text?.body || "";
    } else if (messageObj.type === "audio") {
      const audioBuffer = await downloadMedia(messageObj.audio?.id);
      if (audioBuffer) body = await transcribeAudio(audioBuffer);
    }

    // Proteção anti-spam correta: verifica se o usuário já enviou a mesma mensagem nos últimos 60s
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
    const lastUserMessage = await db.collection("semanticMemory").findOne({
      numero: from,
      role: "user",
      timestamp: { $gt: oneMinuteAgo }
    });

    if (lastUserMessage && typeof lastUserMessage.content === "string" && lastUserMessage.content.trim() === (body || "").trim()) {
      // Já processamos essa mensagem recentemente — evitar duplicate processing
      return res.sendStatus(200);
    }

    // Salva a mensagem do usuário imediatamente (histórico)
    await saveMemory(from, "user", body);

    // Extrair automaticamente possíveis dados a salvar (nomes, trabalho, etc)
    const dadosMemorizados = await extractAutoMemoryGPT(from, body);

    // Salvar memórias importantes sem enviar confirmações extras
    const memToSave = [];
    if (dadosMemorizados.nomes_dos_filhos?.length) memToSave.push(`Filhos: ${dadosMemorizados.nomes_dos_filhos.join(" e ")}`);
    if (dadosMemorizados.trabalho?.empresa) memToSave.push(`Cargo: ${dadosMemorizados.trabalho.cargo} na ${dadosMemorizados.trabalho.empresa} desde ${dadosMemorizados.trabalho.admissao}`);
    if (dadosMemorizados.nome) memToSave.push(`Nome: ${dadosMemorizados.nome}`);
    for (const mem of memToSave) {
      await saveMemory(from, "assistant", mem);
    }

    // Buscar memórias semânticas (apenas UMA chamada global por mensagem, com timeout e cache)
    // Retorna array de strings (ou array vazio)
    const memoriaRelevanteArr = await fetchSemanticMemoriesWithTimeout(body, from, 5, 30, 4000); // top 5 dentro de 30 dias
    const memoriaTexto = Array.isArray(memoriaRelevanteArr) && memoriaRelevanteArr.length ? memoriaRelevanteArr.join("\n") : "";

    // Consultar histórico recente para contexto (mantendo esquema 'numero' e 'timestamp')
    const memories = await db.collection("semanticMemory")
      .find({ numero: from })
      .sort({ timestamp: -1 })
      .limit(10)
      .toArray();

    const chatHistory = memories
      .map(m => ({ role: m.role, content: typeof m.content === "string" ? m.content : "" }))
      .filter(m => m.content && m.content.trim() !== "");

    const systemMessage = {
      role: "system",
      content: "Você é a Donna, assistente pessoal do usuário. Responda de forma curta, clara e direta."
    };

    // Monta as mensagens pro GPT: sistema, memórias relevantes (se existirem) e histórico
    const messagesToGPT = [
      systemMessage,
      memoriaTexto ? { role: "assistant", content: `Memórias relevantes:\n${memoriaTexto}` } : null,
      ...chatHistory
    ].filter(Boolean);

    // Chama o GPT
    const reply = await askGPT(body, messagesToGPT);

    // Salva resposta da assistente
    await saveMemory(from, "assistant", reply);

    // Envia resposta: se o usuário enviou áudio, tentar enviar áudio (TTS) com fallback pra texto
    if (messageObj.type === "audio") {
      try {
        // 'falar' deve retornar buffer/stream compatível com sendAudio
        const audioOut = await falar(reply);
        if (audioOut) {
          await sendAudio(from, audioOut);
        } else {
          // fallback
          await sendMessage(from, reply);
        }
      } catch (err) {
        console.warn("⚠️ Erro ao gerar/enviar áudio, enviando texto:", err.message);
        await sendMessage(from, reply);
      }
    } else {
      await sendMessage(from, reply);
    }

    return res.sendStatus(200);

  } catch (err) {
    console.error("❌ Erro no webhook:", err);
    return res.sendStatus(500);
  }
});

app.listen(PORT, () => console.log(`✅ Donna rodando na porta ${PORT}`));

export { 
  askGPT,
  getTodayEvents, 
  addEvent, 
  saveMemory, 
  db 
};
