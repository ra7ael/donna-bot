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
  await db.collection("semanticMemory").insertOne({ numero: number, role, content, timestamp: new Date() });
}

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

    // Extrair informações automaticamente
    const dadosMemorizados = await extractAutoMemoryGPT(from, body);

    // Salva memórias detalhadas
    if (dadosMemorizados.nomes_dos_filhos?.length) {
      await saveMemory(from, "assistant", `Filhos: ${dadosMemorizados.nomes_dos_filhos.join(" e ")}`);
      await sendMessage(from, `Entendido! Vou lembrar que seus filhos são: ${dadosMemorizados.nomes_dos_filhos.join(" e ")}`);
    }
    if (dadosMemorizados.trabalho?.empresa) {
      await saveMemory(from, "assistant", `Cargo: ${dadosMemorizados.trabalho.cargo} na ${dadosMemorizados.trabalho.empresa} desde ${dadosMemorizados.trabalho.admissao}`);
      await sendMessage(from, `Salvei seu cargo: ${dadosMemorizados.trabalho.cargo} na ${dadosMemorizados.trabalho.empresa}`);
    }
    if (dadosMemorizados.nome) {
      await saveMemory(from, "assistant", `Nome: ${dadosMemorizados.nome}`);
    }

    // Recupera memórias semânticas relevantes via embeddings
    const memoriaRelevante = await querySemanticMemory(body, from, 3); // 3 memórias mais relevantes
    const memoriaTexto = memoriaRelevante ? memoriaRelevante.join("\n") : "";

    // Consultar memórias recentes (lógica antiga)
    const memories = await db.collection("semanticMemory")
      .find({ numero: from })
      .sort({ timestamp: -1 })
      .limit(6)
      .toArray();

    const yesterday = DateTime.now().minus({ days: 1 }).toJSDate();
    const olderMemories = await db.collection("semanticMemory")
      .find({ numero: from, timestamp: { $lt: yesterday } })
      .sort({ timestamp: -1 })
      .limit(5)
      .toArray();

    const allMemories = [...memories.reverse(), ...olderMemories.reverse()];

    // Histórico de chat
    const chatHistory = allMemories
      .map(m => ({ role: m.role, content: m.content || "" }))
      .filter(m => m.content.trim() !== "");

    const systemMessage = {
      role: "system",
      content: "Você é a Donna, assistente pessoal do usuário. Responda de forma curta, clara e direta."
    };

    // Consulta ao GPT incluindo memórias relevantes antes do histórico
    const reply = await askGPT(body, [
      systemMessage,
      { role: "assistant", content: `Memórias relevantes: ${memoriaTexto}` },
      ...chatHistory
    ]);

    // Salva as mensagens do usuário e da assistente
    await saveMemory(from, "user", body);
    await saveMemory(from, "assistant", reply);

    // Envia a resposta
    await sendMessage(from, reply);
    res.sendStatus(200);

  } catch (err) {
    console.error("❌ Erro no webhook:", err);
    res.sendStatus(500);
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
