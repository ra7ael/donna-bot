/// src/server.js
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
import { initRoutineFamily, handleCommand, handleReminder } from "./utils/routineFamily.js";
import { buscarEmpresa, adicionarEmpresa, atualizarCampo, formatarEmpresa } from "./utils/handleEmpresa.js";
import { enviarDocumentoWhatsApp } from "./utils/enviarDocumentoDonna.js";
import { normalizeMessage, shouldIgnoreMessage } from "./utils/messageHelper.js";

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
  const client = await MongoClient.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 60000
  });
  db = client.db("donna");

  await mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 60000
  });

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
      {
        messaging_product: "whatsapp",
        to,
        text: { body: parte }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );
  }
}

async function sendMessageIfNeeded(to, text) {
  await sendMessage(to, text);
}

async function askGPT(prompt) {
  const contextoHorario = `Agora no Brasil são ${DateTime.now()
    .setZone("America/Sao_Paulo")
    .toLocaleString(DateTime.DATETIME_MED)}`;

  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: contextoHorario },
        {
          role: "system",
          content:
            "Você é Amber, inspirada em Donna Paulsen de Suits. Responda com firmeza e clareza, no máximo 2 frases."
        },
        { role: "user", content: prompt }
      ]
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  return response.data.choices?.[0]?.message?.content || "Estou pensando nisso.";
}

/* ========================= WEBHOOK ========================= */

app.post("/webhook", async (req, res) => {
  try {
    const messageObj = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const from = messageObj?.from;

    if (!messageObj || shouldIgnoreMessage(messageObj, from)) {
      res.sendStatus(200);
      return;
    }

    const normalized = normalizeMessage(messageObj);
    if (!normalized) {
      res.sendStatus(200);
      return;
    }

    const { body, bodyLower: textoLower, type } = normalized;

    if (!["text", "document"].includes(type)) {
      res.sendStatus(200);
      return;
    }

    if (type === "text" && /^\d+$/.test(body.trim())) {
      res.sendStatus(200);
      return;
    }

    const messageId = messageObj.id;
    if (mensagensProcessadas.has(messageId)) {
      res.sendStatus(200);
      return;
    }

    mensagensProcessadas.add(messageId);
    setTimeout(() => mensagensProcessadas.delete(messageId), 300000);

    /* ===== MEMÓRIA CONSCIENTE ===== */

    if (textoLower.startsWith("lembre que")) {
      const fato = body.replace(/lembre que/i, "").trim();
      await salvarMemoria(from, {
        tipo: "fato",
        content: fato,
        createdAt: new Date()
      });
      await sendMessage(from, "📌 Guardado.");
      res.sendStatus(200);
      return;
    }

    if (textoLower.includes("o que você lembra")) {
      const fatos = await consultarFatos(from);
      await sendMessage(from, fatos.length ? fatos.join("\n") : "Nada salvo ainda.");
      res.sendStatus(200);
      return;
    }

    /* ===== COMANDOS ===== */

    if (await handleCommand(body, from) || await handleReminder(body, from)) {
      res.sendStatus(200);
      return;
    }

    /* ===== EMPRESAS ===== */

    if (textoLower.startsWith("empresa buscar")) {
      const lista = buscarEmpresa(body.replace(/empresa buscar/i, "").trim());
      await sendMessage(
        from,
        lista.length ? lista.map(formatarEmpresa).join("\n\n") : "Nenhuma empresa encontrada."
      );
      res.sendStatus(200);
      return;
    }

    if (textoLower.startsWith("empresa adicionar")) {
      const p = body.replace(/empresa adicionar/i, "").split(";");
      adicionarEmpresa({
        codigo: p[0],
        empresa: p[1],
        beneficios: p[2]
      });
      await sendMessage(from, "Empresa adicionada.");
      res.sendStatus(200);
      return;
    }

    /* ===== CLIMA ===== */

    if (textoLower.includes("clima") || textoLower.includes("tempo")) {
      await sendMessage(from, await getWeather("Curitiba", "hoje"));
      res.sendStatus(200);
      return;
    }

    /* ===== IA FINAL ===== */

    const fatos = await consultarFatos(from);
    let contexto = "";

    if (fatos.length) {
      contexto =
        "FATOS CONHECIDOS SOBRE O USUÁRIO:\n" +
        fatos.map(f => `- ${f}`).join("\n") +
        "\n\n";
    }

    const resposta = await askGPT(`${contexto}Pergunta do usuário: ${body}`);
    await sendMessage(from, resposta);

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Erro webhook:", err);
    res.sendStatus(500);
  }
});

/* ========================= START ========================= */

app.listen(PORT, () => {
  console.log(`✅ Donna rodando na porta ${PORT}`);
});
