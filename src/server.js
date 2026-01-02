// src/server.js
import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { MongoClient } from "mongodb";
import { DateTime } from "luxon";
import path from "path";
import fs from "fs-extra";
import { fileURLToPath } from "url";

/* ========================= IMPORTS INTERNOS ========================= */
import { startReminderCron } from "./cron/reminders.js";
import { getWeather } from "./utils/weather.js";
import { downloadMedia } from "./utils/downloadMedia.js";
import { salvarMemoria, consultarFatos } from "./utils/memory.js";
import { addSemanticMemory, querySemanticMemory } from "./models/semanticMemory.js";
import { initRoutineFamily, handleCommand, handleReminder } from "./utils/routineFamily.js";
import { buscarEmpresa, adicionarEmpresa, atualizarCampo, formatarEmpresa } from "./utils/handleEmpresa.js";
import { enviarDocumentoWhatsApp } from "./utils/enviarDocumentoDonna.js";
import { normalizeMessage, shouldIgnoreMessage } from "./utils/messageHelper.js";
import { amberMind } from "./core/amberMind.js";
import { falar, sendAudio } from "./utils/sendAudio.js";
import { transcreverAudio } from "./utils/transcreverAudio.js";

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

async function sendMessageIfNeeded(to, text) {
  await sendMessage(to, text);
}

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

/* ========================= NLP SIMPLES PARA EXTRAÇÃO DE FATOS ========================= */
function extrairFatoAutomatico(texto) {
  const t = texto.toLowerCase();
  if (t.endsWith("?") || ["oi","bom dia","boa tarde","boa noite","obrigado"].some(p => t.startsWith(p))) return null;
  if (["eu tenho","meu nome é","eu sou","sou casado","tenho filhos","trabalho com","trabalho na"].some(p => t.includes(p))) return texto.trim();
  return null;
}

/* ========================= INTERCEPTOR NATURAL ========================= */
async function responderComMemoriaNatural(pergunta, fatos = [], memoriaSemantica = []) {
  const p = pergunta.toLowerCase();

  /* ===== NOME DO USUÁRIO (IDENTIDADE) ===== */
  if (
    p.includes("meu nome") ||
    p.includes("qual é meu nome") ||
    p.includes("qual é o meu nome")
  ) {
    
    const perfil = await consultarPerfil(from);
    if (perfil?.nome) {
      return `Seu nome é ${perfil.nome}.`;
    }


    if (fatoNome) {
      const nome = fatoNome.replace(/meu nome é/i, "").trim();
      return `Seu nome é ${nome}.`;
    }
  }

  /* ===== FILHOS / ANIMAIS ===== */
  if (p.includes("quantos filhos") || p.includes("quantos animais")) {
    const fato = fatos.find(f =>
      f.toLowerCase().includes("filho") ||
      f.toLowerCase().includes("animal") ||
      f.toLowerCase().includes("gata")
    );

    if (fato) return fato;
  }

  return null;
}


/* ========================= NUMEROS PERMITIDOS ========================= */
const NUMEROS_PERMITIDOS = [
  "554195194485" // ex: 5591999999999
];

function numeroPermitido(from) {
  if (!from) return false;
  return NUMEROS_PERMITIDOS.includes(from);
}

export { db };

/* ========================= WEBHOOK ========================= */
app.post("/webhook", async (req, res) => {
  try {
    const messageObj = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const from = messageObj?.from;

    // 🔒 BLOQUEIO TOTAL: só números permitidos
    if (!numeroPermitido(from)) return res.sendStatus(200);

    if (!messageObj || shouldIgnoreMessage(messageObj, from)) return res.sendStatus(200);

    const normalized = normalizeMessage(messageObj);
    if (!normalized) return res.sendStatus(200);

    let { body, bodyLower, type, audioId } = normalized;
    let responderEmAudio = false;

    // 🎧 SE FOR ÁUDIO → TRANSCRIÇÃO
      if (type === "audio") {
        if (!audioId) {
          console.log("⚠️ Mensagem de áudio sem audioId");
          return res.sendStatus(200);
        }
        body = await transcreverAudio(audioId);
        bodyLower = body.toLowerCase();
        responderEmAudio = true;
      }

    if (!["text", "document", "audio"].includes(type)) return res.sendStatus(200);

    const messageId = messageObj.id;
    if (mensagensProcessadas.has(messageId)) return res.sendStatus(200);
    mensagensProcessadas.add(messageId);
    setTimeout(() => mensagensProcessadas.delete(messageId), 300000);

    /* ===== MEMÓRIA MANUAL ===== */
    if (bodyLower.startsWith("lembre que")) {
      const fato = body.replace(/lembre que/i, "").trim();
      const fatosExistentes = await consultarFatos(from);
      if (!fatosExistentes.includes(fato)) {
        await salvarMemoria(from, { tipo:"fato", content: fato, createdAt: new Date() });
      }

      if (responderEmAudio) {
        const audioPath = await falar("Guardado.");
        await sendAudio(from, audioPath);
      } else {
        await sendMessage(from, "📌 Guardado.");
      }
      return res.sendStatus(200);
    }

    if (bodyLower.includes("o que você lembra")) {
      const fatos = await consultarFatos(from);
      const resposta = fatos.length ? fatos.join("\n") : "Nada salvo ainda.";

      if (responderEmAudio) {
        const audioPath = await falar(resposta);
        await sendAudio(from, audioPath);
      } else {
        await sendMessage(from, resposta);
      }
      return res.sendStatus(200);
    }

    /* ===== MEMÓRIA AUTOMÁTICA FACTUAL ===== */
    const fatoDetectado = extrairFatoAutomatico(body);
    if (fatoDetectado) {
      const fatosExistentes = await consultarFatos(from);
      if (!fatosExistentes.includes(fatoDetectado)) {
        await salvarMemoria(from, { tipo:"fato", content: fatoDetectado, createdAt: new Date() });
        await addSemanticMemory(fatoDetectado, "salvo como fato do usuário", from, "user");
      }
    }

    /* ===== COMANDOS E CLIMA ===== */
    if (await handleCommand(body, from) || await handleReminder(body, from)) {
      return res.sendStatus(200);
    }

    const pediuClima = [
      "clima",
      "como está o clima",
      "previsão do tempo",
      "como está o tempo hoje",
      "vai chover",
      "temperatura hoje"
    ].some(p => bodyLower.includes(p));

    if (pediuClima) {
      const clima = await getWeather("Curitiba","hoje");

      if (responderEmAudio) {
        const audioPath = await falar(clima);
        await sendAudio(from, audioPath);
      } else {
        await sendMessage(from, clima);
      }
      return res.sendStatus(200);
    }

    /* ===== IA FINAL COM MEMÓRIA ===== */
    const fatosRaw = await consultarFatos(from);
    const fatos = fatosRaw.map(f =>
      typeof f === "string" ? f : f.content
    );

    const memoriaSemantica = await querySemanticMemory(body, from, 3);

    const respostaDireta = await responderComMemoriaNatural(
      body,
      fatos,
      memoriaSemantica || []
    );

    if (respostaDireta) {
      if (responderEmAudio) {
        const audioPath = await falar(respostaDireta);
        await sendAudio(from, audioPath);
      } else {
        await sendMessage(from, respostaDireta);
      }
      return res.sendStatus(200);
    }

    let contexto = "";
    if (fatos.length) {
      contexto += "FATOS CONHECIDOS SOBRE O USUÁRIO:\n" +
        fatos.map(f => `- ${f}`).join("\n") + "\n\n";
    }

    if (memoriaSemantica?.length) {
      contexto += "CONTEXTO DE CONVERSAS PASSADAS:\n" +
        memoriaSemantica.map(m => `- ${m}`).join("\n") + "\n\n";
    }

    const respostaIA = await askGPT(`${contexto}Pergunta do usuário: ${body}`);

    /* ===== AMBER MIND ===== */
    const decisaoAmber = await amberMind({
      from,
      mensagem: body,
      respostaIA
    });

    const respostaFinal = decisaoAmber.override
      ? decisaoAmber.resposta
      : respostaIA;

    if (responderEmAudio) {
      const audioPath = await falar(respostaFinal);
      await sendAudio(from, audioPath);
    } else {
      await sendMessage(from, respostaFinal);
    }

    return res.sendStatus(200);

  } catch (err) {
    console.error("❌ Erro no webhook:", err);
    return res.sendStatus(500);
  }
});

/* ========================= START ========================= */
app.listen(PORT, () => {
  console.log(`✅ Donna rodando na porta ${PORT}`);
});
    
