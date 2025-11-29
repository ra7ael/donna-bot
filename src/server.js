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
import { querySemanticMemory } from "./models/semanticMemory.js";
import MemoriaEstruturada from "./models/memory.js";

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

let papelAtual = null;
let papeisCombinados = [];

// ===== Verificação de papel =====
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
      papelAtual = "Multiplos";
      setPapeis(validos);
      return { tipo: "papel", resposta: `Beleza! Vou atuar como ${validos.join(" + ")}. Qual sua dúvida?` };
    }
    return { tipo: "erro", resposta: "Não reconheci esses papéis — verifique a grafia ou escolha outros." };
  }

  return null;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use('/audio', express.static(path.join(__dirname, 'public/audio')));

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.OPENAI_API_KEY;

// ===== Conexão com MongoDB =====
const openai = new OpenAI({ apiKey: GPT_API_KEY });
let db;

async function connectDB() {
  try {
    console.log("🔹 Tentando conectar ao MongoDB...");
    const client = await MongoClient.connect(MONGO_URI, { useUnifiedTopology: true });
    db = client.db("donna");
    console.log("✅ Conectado ao MongoDB");
    startReminderCron(db, sendMessage);
  } catch (err) {
    console.error("❌ Erro ao conectar MongoDB:", err.message);
    process.exit(1);
  }
}
await connectDB();
export { db };

// ===== Salvar memória do chat =====
async function saveChatMemory(userId, role, content) {
  if (!content || !content.toString().trim()) return;
  try {
    await db.collection("chatMemory").insertOne({
      userId,
      role,
      content: content.toString(),
      createdAt: new Date()
    });
    console.log("💾 Chat salvo na chatMemory.");
  } catch (err) {
    console.error("❌ Erro salvar chat:", err.message);
  }
}

// ===== Recuperar últimas mensagens do chat =====
async function getChatMemory(userId, limit = 10) {
  try {
    return await db.collection("chatMemory")
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
  } catch {
    return [];
  }
}

// ===== Função askGPT (sem alterar lógica existente) =====
async function askGPT(prompt, history = []) {
  try {
    const safeMessages = history
      .map(m => ({ role: m.role, content: typeof m.content === "string" ? m.content : "" }))
      .filter(m => m.content.trim() !== "");

    const sanitizedMessages = safeMessages
      .filter(m => typeof m.content === "string" || typeof m.content === "number")
      .map(m => ({
        role: m.role,
        content: m.content.toString().trim()
      }));

    sanitizedMessages.push({ role: "user", content: prompt || "" });

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      { model: "gpt-5-mini", messages: sanitizedMessages },
      { headers: { Authorization: `Bearer ${GPT_API_KEY}`, "Content-Type": "application/json" } }
    );

    return response.data.choices?.[0]?.message?.content || "Hmm… ainda estou pensando!";
  } catch (err) {
    console.error("❌ Erro GPT:", err.response?.data || err);
    return "Hmm… ainda estou pensando!";
  }
}

// ===== Webhook principal =====
app.post("/webhook", async (req, res) => {
  try {
    const messageObj = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!messageObj) return res.sendStatus(200);

    const from = messageObj.from;
    let body = "";

    if (messageObj.type === "text") {
      body = messageObj.text?.body || "";
    } else if (messageObj.type === "audio") {
      const audioBuffer = await downloadMedia(messageObj.audio?.id);
      if (audioBuffer) body = await transcribeAudio(audioBuffer);
    }

    // 💾 salva a mensagem do usuário no chatMemory
    await saveChatMemory(from, "user", body);

    // 🔍 busca últimas mensagens para enviar como contexto
    const memories = await getChatMemory(from, 10);
    const historyMessages = memories
      .reverse()
      .map(m => ({ role: m.role, content: m.content }))
      .filter(m => m.content.trim() !== "");

    const systemMessage = {
      role: "system",
      content: "Você é a Donna, assistente pessoal do usuário. Responda curto."
    };

    // 🤖 obtém a resposta da IA mantendo seu fluxo normal
    let reply = await askGPT(body, [systemMessage, ...historyMessages]);

    // 💾 salva a resposta dela no mesmo chatMemory
    await saveChatMemory(from, "assistant", reply);

    // 📤 envia a resposta para o WhatsApp (lógica não alterada)
    await sendMessage(from, reply);

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Webhook erro:", err.message);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => console.log(`✅ Donna rodando na porta ${PORT}`));

export { 
  askGPT,
  getTodayEvents, 
  addEvent, 
  saveChatMemory, 
  db 
};
