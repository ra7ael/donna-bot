// src/server.js
import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { MongoClient, ObjectId } from "mongodb";
import { DateTime } from "luxon";
import path from "path";
import fs from "fs-extra";
import { fileURLToPath } from "url";

/* ========================= IMPORTS INTERNOS ========================= */
import { startReminderCron } from "./cron/reminders.js";
import { getWeather } from "./utils/weather.js";
import { normalizeMessage, shouldIgnoreMessage } from "./utils/messageHelper.js";
import { salvarMemoria, consultarFatos, consultarPerfil } from "./utils/memory.js";
import { addSemanticMemory, querySemanticMemory } from "./models/semanticMemory.js";
import { initRoutineFamily, handleCommand, handleReminder } from "./utils/routineFamily.js";
import { amberMind } from "./core/amberMind.js";
import { amberEnglishUltimate } from "./utils/amberEnglishUltimate.js";
import { falar, sendAudio } from "./utils/sendAudio.js";
import { transcreverAudio } from "./utils/transcreverAudio.js";
import { consultarDataJud } from "./utils/datajudAPI.js";
import { extractAutoMemoryGPT } from "./utils/autoMemoryGPT.js";
import "./scheduler.js";
import { postarInstagram } from "./instagram.js";

const resultado = await postarInstagram({
  imageUrl: "https://meu-site.com/imagem.jpg",
  caption: "Bom dia! A Amber trouxe um insight de RH ☕"
});

console.log("Post publicado! ID:", resultado.id);

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

/* ========================= CONTROLE ========================= */
const mensagensProcessadas = new Set();
const sessionMemory = {};
let db;
let cronStarted = false;

/* ========================= DB ========================= */
async function connectDB() {
  const client = await MongoClient.connect(MONGO_URI, { serverSelectionTimeoutMS: 60000 });
  db = client.db("donna");
  await mongoose.connect(MONGO_URI);

  if (!cronStarted) {
    startReminderCron(db, sendMessage);
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
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
    );
  }
}

async function askGPT(prompt) {
  const contextoHorario = `Agora no Brasil são ${DateTime.now().setZone("America/Sao_Paulo").toLocaleString(DateTime.DATETIME_MED)}`;

  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: contextoHorario },
        { role: "user", content: prompt }
      ]
    },
    { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
  );

  return response.data.choices?.[0]?.message?.content || "Estou pensando nisso.";
}

async function buscarInformacaoDireito(pergunta) {
  const resultados = await consultarDataJud(pergunta);
  if (!resultados.length) return "Não encontrei dados oficiais.";
  return resultados.map((r, i) => `${i + 1}. ${r.titulo} - ${r.link}`).join("\n");
}

/* ========================= NUMEROS PERMITIDOS ========================= */
const NUMEROS_PERMITIDOS = ["554195194485"];
const numeroPermitido = from => NUMEROS_PERMITIDOS.includes(from);

/* ========================= WEBHOOK ========================= */
app.post("/webhook", async (req, res) => {
  try {
    const messageObj = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!messageObj) return res.sendStatus(200);

    const messageId = messageObj.id;
    if (mensagensProcessadas.has(messageId)) return res.sendStatus(200);
    mensagensProcessadas.add(messageId);
    setTimeout(() => mensagensProcessadas.delete(messageId), 300000);

    const from = messageObj.from;
    if (!numeroPermitido(from) || shouldIgnoreMessage(messageObj, from)) return res.sendStatus(200);

    const normalized = normalizeMessage(messageObj);
    if (!normalized) return res.sendStatus(200);

    let { body, bodyLower, type, audioId } = normalized;
    let responderEmAudio = false;
    let mensagemTexto = body;

    if (type === "audio") {
      mensagemTexto = await transcreverAudio(audioId);
      bodyLower = mensagemTexto.toLowerCase();
      responderEmAudio = true;
    }

    /* ===== MEMÓRIA AUTOMÁTICA ===== */
    await extractAutoMemoryGPT(from, mensagemTexto, askGPT);

    /* ===== COMANDOS ===== */
    if (await handleCommand(body, from) || await handleReminder(body, from)) {
      return res.sendStatus(200);
    }

    /* ===== COMANDO POST AUTOMÁTICO ===== */
if (bodyLower.startsWith("postar imagem")) {
  // Formato esperado:
  // postar imagem; contexto: RH, motivação ou outro assunto
  const partes = body.split(";").map(p => p.trim());
  let contexto = partes.find(p => p.toLowerCase().startsWith("contexto:"))?.slice(9).trim();

  if (!contexto) contexto = "RH e gestão de pessoas";

  // Verifica se mensagem tem imagem (WhatsApp envia 'image' type)
  const mensagemImagem = messageObj?.image; 
  let filename;

  if (mensagemImagem) {
    filename = `${Date.now()}.jpg`;
    const imageBuffer = Buffer.from(mensagemImagem?.id, "base64"); // ajuste se usar download via API do WhatsApp
    fs.ensureDirSync("imagens");
    fs.writeFileSync(path.join("imagens", filename), imageBuffer);
  } else {
    return res.send("❌ Envie uma imagem junto com o comando!");
  }

  // GPT cria caption
  const prompt = `
Crie uma legenda bonita, organizada e envolvente para Instagram
com base neste contexto: ${contexto}.
O texto deve ser curto, inspirador e pronto para postagem.
`;

  const caption = await askGPT(prompt);

  const resultado = await postarInstagram({ filename, caption });
  if (resultado?.id) {
    await sendMessage(from, `✅ Post publicado automaticamente no Instagram!\nID: ${resultado.id}\nLegenda:\n${caption}`);
  } else {
    await sendMessage(from, "❌ Ocorreu um erro ao postar a imagem.");
  }
  return res.sendStatus(200);
}

    // ===== MODO INGLÊS =====
if (bodyLower.startsWith("ingles")) {
  const perguntaIngles = body.replace(/^ingles/i, "").trim();

  const respostaIngles = await amberEnglishUltimate({
    userId: from,
    pergunta: perguntaIngles || "Let's start learning English!",
    level: "beginner"
  });

  if (responderEmAudio) {
    const audioPath = await falar(respostaIngles);
    await sendAudio(from, audioPath);
  } else {
    await sendMessage(from, respostaIngles);
  }

  return res.sendStatus(200);
}

    /* ===== INGLÊS ===== */
    if (bodyLower.includes("english") || bodyLower.startsWith("translate")) {
      const respostaEnglish = await amberEnglishUltimate({
        userId: from,
        pergunta: mensagemTexto,
        level: "beginner"
      });

      await sendMessage(from, respostaEnglish);
      return res.sendStatus(200);
    }

    /* ===== DIREITO ===== */
    if (["lei", "artigo", "direito", "jurisprudência"].some(p => bodyLower.includes(p))) {
      const refs = await buscarInformacaoDireito(mensagemTexto);
      const resposta = await askGPT(
        `Responda com base em leis brasileiras oficiais.\nReferências:\n${refs}\n\nPergunta: ${mensagemTexto}`
      );
      await sendMessage(from, resposta);
      return res.sendStatus(200);
    }

    /* ===== CLIMA ===== */
    if (["clima", "tempo", "previsão"].some(p => bodyLower.includes(p))) {
      const clima = await getWeather("Curitiba", "hoje");
      await sendMessage(from, clima);
      return res.sendStatus(200);
    }

    /* ===== CONTEXTO + IA ===== */
    const fatos = (await consultarFatos(from)).map(f => typeof f === "string" ? f : f.content);
    const memoriaSemantica = await querySemanticMemory("histórico", from, 10) || [];

    sessionMemory[from] = sessionMemory[from] || [];
    sessionMemory[from].push(`Usuário: ${mensagemTexto}`);
    sessionMemory[from] = sessionMemory[from].slice(-20);

    const prompt = `
FATOS:
${fatos.join("\n")}

MEMÓRIA:
${memoriaSemantica.join("\n")}

${sessionMemory[from].join("\n")}
Pergunta: ${mensagemTexto}
`;

    let respostaIA = await askGPT(prompt);
    const decisao = await amberMind({ from, mensagem: mensagemTexto, respostaIA });
    const respostaFinal = decisao.override ? decisao.resposta : respostaIA;

    await addSemanticMemory(
      `Pergunta: ${mensagemTexto} | Resposta: ${respostaFinal}`,
      "histórico",
      from,
      "user"
    );

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
