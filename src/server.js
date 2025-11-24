// src/server.js
import dotenv from "dotenv";
dotenv.config(); // garantir que variáveis estejam carregadas antes de usar

import express from 'express';
import OpenAI from "openai";
import { MongoClient } from 'mongodb';
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import bodyParser from "body-parser";
import axios from 'axios';
import mongoose from "mongoose";
import { DateTime } from 'luxon';
import { startReminderCron, addReminder } from "./cron/reminders.js";
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
import * as cacheService from './services/cacheService.js';
import * as datasetService from './services/datasetService.js';
import * as getDonnaResponse from './services/getDonnaResponse.js';
import * as gptService from './services/gptService.js';
import { extractAutoMemory, findRelevantMemory } from "./utils/autoMemory.js";

// Nota: import estático removido para import dinâmico no wrapper
// import { processarPdf } from "./utils/importPdfEmbeddings.js";

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error("❌ MONGO_URI não definido em .env");
  process.exit(1);
}

let db;

export async function connectDB() {
  if (db) return db;

  try {
    console.log("🔹 Tentando conectar ao MongoDB...");
    const client = await MongoClient.connect(MONGO_URI, { useUnifiedTopology: true });
    db = client.db("donna");

    // garante coleções e índices mínimos
    const collections = await db.listCollections().toArray();
    const names = collections.map(c => c.name);

    if (!names.includes("semanticMemory")) await db.createCollection("semanticMemory");
    if (!names.includes("users")) await db.createCollection("users");
    if (!names.includes("agenda")) await db.createCollection("agenda");
    if (!names.includes("empresas")) await db.createCollection("empresas");
    if (!names.includes("lembretes")) await db.createCollection("lembretes");

    // usamos "timestamp" consistentemente no código
    await db.collection("semanticMemory").createIndex({ userId: 1, timestamp: -1 });
    await db.collection("semanticMemory").createIndex({ content: "text" });
    await db.collection("users").createIndex({ userId: 1 });

    console.log("✅ Conectado ao MongoDB (histórico, usuários, agenda, lembretes)");
    // inicie cron apenas depois da conexão (sendMessage é function declaration, hoisted)
    startReminderCron(db, sendMessage);

    return db;
  } catch (error) {
    console.error("❌ Erro ao conectar ao MongoDB:", error);
    process.exit(1);
  }
}

export function getDB() {
  if (!db) throw new Error("Banco de dados não conectado!");
  return db;
}

// inicializa conexão
connectDB().catch(err => console.error("Erro na conexão DB:", err));

const app = express();
app.use(bodyParser.json());

const upload = multer({ dest: "uploads/" });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use('/audio', express.static(path.join(__dirname, 'public/audio')));

const PORT = process.env.PORT || 3000;
const GPT_API_KEY = process.env.OPENAI_API_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

const openai = new OpenAI({ apiKey: GPT_API_KEY });

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

        // ---------- Helpers ----------
async function askGPT(prompt, history = [], semanticMemory = "") {
  try {
    const safeMessages = [
      {
        role: "system",
        content: `
Você é a Donna, assistente pessoal do Rafael Neves. 
Seu papel é conversar com clareza, gentileza e eficiência, sempre usando o contexto da memória semântica, histórico recente e informações importantes armazenadas. 

Regras da Donna:
- Priorize sempre o que já sabe sobre o Rafael (nome, rotinas, preferências, projetos, dificuldades).
- Use memórias relevantes quando forem úteis para responder.
- Não repita a mesma informação várias vezes.
- Não invente fatos; só use o que o Rafael disser ou o que estiver salvo na memória.
- Seja objetiva, mas calorosa.
- Evite respostas longas demais quando o usuário pedir algo direto.
- Se o Rafael pedir para lembrar algo no futuro, só aceite se for um lembrete do sistema.
- Sempre responda mantendo consistência de personalidade.
- Jamais diga que não tem memória; você possui memória semântica e resgata informações relevantes.

Quando houver memória semântica encontrada, integre ela naturalmente à resposta.
`
      },

      ...history
        .map(m => ({
          role: m.role,
          content: typeof m.content === "string" ? m.content.trim() : ""
        }))
        .filter(m => m.content !== ""),

      ...(semanticMemory
        ? [
            {
              role: "system",
              content: `Memória relevante recuperada: ${semanticMemory}`
            }
          ]
        : []),

      { role: "user", content: prompt?.trim() || "" }
    ];

    // ---- AQUI FICAM AS REQUISIÇÕES GPT ----
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-5-mini",
        messages: safeMessages,
        temperature: 0.7,
        max_tokens: 500
      },
      {
        headers: {
          Authorization: `Bearer ${GPT_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    return (
      response.data.choices?.[0]?.message?.content ||
      "Hmm… ainda estou pensando!"
    );
  } catch (err) {
    console.error("❌ Erro GPT:", err.response?.data || err.message);
    return "❌ Ocorreu um erro ao gerar a resposta.";
  }
}  

// sendMessage é declaração de função — hoisted — pode ser usada antes da definição.
async function sendMessage(to, message) {
  if (!message) message = "❌ Ocorreu um erro ao processar sua solicitação. Tente novamente.";

  let textBody = "";
  if (typeof message === "string") {
    textBody = message;
  } else if (typeof message === "object") {
    if (message.resposta && typeof message.resposta === "string") textBody = message.resposta;
    else if (message.texto && typeof message.texto === "string") textBody = message.texto;
    else textBody = JSON.stringify(message, null, 2);
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

/**
 * saveMemory: salva conteúdo em semanticMemory e tenta gerar embedding se houver util disponível.
 * usa import dinâmico para não quebrar se o util não existir no ambiente (ex: em testes).
 */
async function saveMemory(userId, role, content) {
  if (!content?.trim()) return;
  try {
    let embedding = [];
    try {
      // import dinâmico — funciona em runtime e evita erro se arquivo estiver ausente
      const mod = await import("./utils/embeddingService.js");
      if (mod && typeof mod.getEmbedding === "function") {
        embedding = await mod.getEmbedding(content);
        console.log("🧠 Embedding gerado (salvando memória) - len:", embedding?.length || 0);
      }
    } catch (e) {
      // embeddingService não disponível ou falhou — prossegue salvando sem embedding
      // console.warn("⚠️ embeddingService não disponível:", e.message);
    }

    await db.collection("semanticMemory").insertOne({
      userId,
      role,
      content,
      embedding,
      timestamp: new Date()
    });
    console.log("💾 Memória salva:", { userId, role, content: content.slice(0, 80) + (content.length > 80 ? "..." : "") });
  } catch (err) {
    console.error("❌ Erro ao salvar memória:", err);
  }
}

async function getUserMemory(userId, limit = 20) {
  return await db.collection("semanticMemory")
    .find({ userId })
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();
}

async function recuperarContexto(userId, novaMensagem) {
  try {
    const memorias = await db.collection("semanticMemory")
      .find({ userId })
      .sort({ timestamp: -1 })
      .limit(10)
      .toArray();

    const contexto = memorias
      .map(m => `${m.role === "user" ? "Usuário" : "Donna"}: ${m.content}`)
      .join("\n");

    return `Contexto anterior:\n${contexto}\n\nNova mensagem: ${novaMensagem}`;
  } catch (err) {
    console.error("❌ Erro ao recuperar contexto:", err);
    return novaMensagem;
  }
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

// Wrapper dinâmico para processamento de PDFs.
// Evita falha no import estático: sempre que precisar processar, tenta importar o util.
async function processarPdfWrapper(caminhoPDF) {
  try {
    const mod = await import("./utils/importPdfEmbeddings.js");
    const fn = mod.processarPdf || mod.default || mod.processarPDF;
    if (typeof fn === "function") {
      await fn(caminhoPDF);
      return true;
    } else {
      console.warn("⚠️ util de importPdfEmbeddings encontrado, mas não exporta função processarPdf.");
      return false;
    }
  } catch (e) {
    console.warn("⚠️ Não foi possível importar ./utils/importPdfEmbeddings.js — pulando processamento de PDF.", e.message);
    return false;
  }
}

/**
 * Tenta interpretar uma string de data/hora em formatos comuns.
 * Retorna { date: 'YYYY-MM-DD', time: 'HH:mm' } ou null se falhar.
 */
function parseDateTime(raw) {
  if (!raw || typeof raw !== "string") return null;
  raw = raw.trim();

  // tenta ISO
  let dt = DateTime.fromISO(raw, { zone: "America/Sao_Paulo" });
  if (dt.isValid) {
    return { date: dt.toFormat("yyyy-MM-dd"), time: dt.toFormat("HH:mm") };
  }

  // tenta formatos com espaço: "yyyy-MM-dd HH:mm" ou "dd/MM/yyyy HH:mm"
  dt = DateTime.fromFormat(raw, "yyyy-MM-dd HH:mm", { zone: "America/Sao_Paulo" });
  if (dt.isValid) return { date: dt.toFormat("yyyy-MM-dd"), time: dt.toFormat("HH:mm") };

  dt = DateTime.fromFormat(raw, "dd/MM/yyyy HH:mm", { zone: "America/Sao_Paulo" });
  if (dt.isValid) return { date: dt.toFormat("yyyy-MM-dd"), time: dt.toFormat("HH:mm") };

  // tenta só data
  dt = DateTime.fromFormat(raw, "yyyy-MM-dd", { zone: "America/Sao_Paulo" });
  if (dt.isValid) return { date: dt.toFormat("yyyy-MM-dd"), time: "09:00" }; // default 09:00

  dt = DateTime.fromFormat(raw, "dd/MM/yyyy", { zone: "America/Sao_Paulo" });
  if (dt.isValid) return { date: dt.toFormat("yyyy-MM-dd"), time: "09:00" };

  // tenta "amanhã às 14:00", "hoje às 18:00"
  if (/hoje/i.test(raw)) {
    const match = raw.match(/(\d{1,2}:\d{2})/);
    const time = match ? match[1] : "09:00";
    const today = DateTime.now().setZone("America/Sao_Paulo").toFormat("yyyy-MM-dd");
    return { date: today, time };
  }
  if (/amanh/i.test(raw)) {
    const match = raw.match(/(\d{1,2}:\d{2})/);
    const time = match ? match[1] : "09:00";
    const tomorrow = DateTime.now().setZone("America/Sao_Paulo").plus({ days: 1 }).toFormat("yyyy-MM-dd");
    return { date: tomorrow, time };
  }

  return null;
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
    let isAudioResponse = false;

    // verifica autorização
    if (!numerosAutorizados.includes(from)) {
      console.log(`🚫 Número não autorizado ignorado: ${from}`);
      return res.sendStatus(200);
    }

    // captura texto/áudio/documento/imagem
    if (messageObj.type === "text") {
      body = messageObj.text?.body || "";
    } else if (messageObj.type === "audio") {
      const audioBuffer = await downloadMedia(messageObj.audio?.id);
      if (audioBuffer) {
        body = await transcribeAudio(audioBuffer);
      } else {
        body = "❌ Não consegui processar seu áudio. Envie como texto.";
      }
      isAudioResponse = true;
    } else if (messageObj.type === "document") {
      const document = messageObj.document;
      if (!document) {
        await sendMessage(from, "❌ Não consegui processar o arquivo enviado.");
        return res.sendStatus(200);
      }

      const pdfBuffer = await downloadMedia(document.id);
      if (!pdfBuffer) {
        await sendMessage(from, "❌ Não consegui baixar o arquivo PDF.");
        return res.sendStatus(200);
      }

      const pdfsDir = "./src/utils/pdfs";
      if (!fs.existsSync(pdfsDir)) fs.mkdirSync(pdfsDir, { recursive: true });
      const caminhoPDF = `${pdfsDir}/${document.filename}`;
      fs.writeFileSync(caminhoPDF, pdfBuffer);

      const processed = await processarPdfWrapper(caminhoPDF);
      if (processed) {
        await sendMessage(from, `✅ PDF "${document.filename}" processado com sucesso!`);
      } else {
        await sendMessage(from, `✅ PDF salvo em ${caminhoPDF} (processamento não disponível).`);
      }

      return res.sendStatus(200);
    } else if (messageObj.type === "image") {
      body = "📷 Imagem recebida. Analisando...";
    } else {
      await sendMessage(from, "Só consigo responder mensagens de texto, áudio ou documentos PDF por enquanto 😉");
      return res.sendStatus(200);
    }

    body = (body || "").trim();
    if (!body) return res.sendStatus(200);

    // salva histórico básico
    await db.collection("conversations").insertOne({ from, role: 'user', content: body, createdAt: new Date() });
    await saveMemory(from, 'user', body);

    // ===== Comandos rápidos =====
    if (/^minhas mem[oó]rias/i.test(body)) {
      const memorias = await db.collection("semanticMemory").find({ userId: from }).sort({ timestamp: -1 }).limit(5).toArray() || [];
      if (!memorias.length) {
        await sendMessage(from, "🧠 Você ainda não tem memórias salvas.");
      } else {
        const resumo = memorias.map(m => `• ${m.role === "user" ? "Você disse" : "Donna respondeu"}: ${m.content}`).join("\n");
        await sendMessage(from, `🗂️ Aqui estão suas últimas memórias:\n\n${resumo}`);
      }
      return res.sendStatus(200);
    }

    if (/^meu nome é\s+/i.test(body)) {
      const match = body.match(/^meu nome é\s+(.+)/i);
      if (match) {
        const nome = match[1].trim();
        await setUserName(from, nome);
        await saveMemory(from, "user", `O nome do usuário é ${nome}`);
        await sendMessage(from, `✅ Nome salvo: ${nome}`);
      } else {
        await sendMessage(from, `❌ Use: "Meu nome é [seu nome]"`);
      }
      return res.sendStatus(200);
    }

    if (/qual (é )?meu nome/i.test(body)) {
      const nome = await getUserName(from);
      await sendMessage(from, nome ? `📛 Seu nome é ${nome}` : `❌ Ainda não sei seu nome. Diga: 'Meu nome é [seu nome]'`);
      return res.sendStatus(200);
    }

    // ===== Processamento de contexto e memórias =====
    const history = (await db.collection("conversations").find({ from }).sort({ createdAt: 1 }).toArray()) || [];
    const conversationContext = (history || [])
      .filter(h => h.content)
      .map(h => `${h.role === 'user' ? 'Usuário' : 'Assistente'}: ${h.content}`)
      .join("\n");

    const relevantMemories = (await findRelevantMemory(from, body, 3)) || [];
    const memoryContext = relevantMemories.length
      ? relevantMemories.map(m => `• ${m.role}: ${m.content}`).join("\n")
      : "";

    // ===== Geração de resposta =====
    let reply = await funcoesExtras(from, body);
    if (!reply) reply = await obterResposta(body, from);
    if (!reply) {
      const pdfTrechos = await buscarPergunta(body);
      const promptFinal = pdfTrechos ? `${body}\n\nBaseado nestes trechos de PDF:\n${pdfTrechos}` : body;
      reply = await askGPT(promptFinal, [{ role: "system", content: `Você é a Donna...` }, ...history]);
      await treinarDonna(body, reply, from);
    }

    // 🧠 Memória automática
    const autoMem = await extractAutoMemory(body);
    if (autoMem) {
      console.log("💾 Memória relevante detectada:", autoMem);
      await db.collection("semanticMemory").updateOne(
        { userId: from, role: autoMem.key },
        { $set: { content: autoMem.value, embedding: autoMem.embedding, timestamp: new Date() } },
        { upsert: true }
      );
    } else {
      await saveMemory(from, "userMessage", body);
    }

    await saveMemory(from, "assistantMessage", reply);
    await db.collection("conversations").insertOne({
      from,
      role: 'assistant',
      content: reply,
      createdAt: new Date()
    });

    // envio
    if (isAudioResponse) {
      try {
        const audioBuffer = await falar(reply, "./resposta.mp3");
        await sendAudio(from, audioBuffer);
      } catch (err) {
        console.error("❌ Erro ao gerar/enviar áudio:", err);
        await sendMessage(from, "❌ Não consegui gerar o áudio no momento.");
      }
    } else {
      await sendMessage(from, reply);
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("❌ Erro no webhook:", err.response?.data || err.message || err);
    return res.sendStatus(500);
  }
});


// healthcheck
app.get("/", (req, res) => {
  res.send("✅ Donna está online!");
});

app.listen(PORT, () => console.log(`✅ Donna rodando na porta ${PORT}`));

// export helpers se necessário
export {
  askGPT,
  getTodayEvents,
  addEvent,
  saveMemory,
  getUserMemory,
  db
};
