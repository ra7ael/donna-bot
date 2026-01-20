import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { DateTime } from "luxon";
import path from "path";
import fs from "fs-extra";
import { fileURLToPath } from "url";
import { dirname } from "path";
import pdfParse from "pdf-parse-fork";
import { v4 as uuidv4 } from 'uuid';
import cors from "cors";
import cron from "node-cron";

/* ========================= IMPORTS INTERNOS ========================= */
import { startReminderCron } from "./cron/reminders.js";
import { getWeather } from "./utils/weather.js";
import { normalizeMessage, shouldIgnoreMessage } from "./utils/messageHelper.js";
import { consultarFatos } from "./utils/memory.js";
import { addSemanticMemory, querySemanticMemory } from "./models/semanticMemory.js";
import { initRoutineFamily, handleCommand, handleReminder } from "./utils/routineFamily.js";
import { amberMind } from "./core/amberMind.js";
import { amberEnglishUltimate } from "./utils/amberEnglishUltimate.js";
import { falar, sendAudio } from "./utils/sendAudio.js";
import { transcreverAudio } from "./utils/transcreverAudio.js";
import { consultarDataJud } from "./utils/datajudAPI.js";
import { extractAutoMemoryGPT } from "./utils/autoMemoryGPT.js";
import { selectMemoriesForPrompt } from "./memorySelector.js";
import { Session } from "./models/session.js";
import { traduzirEGerarAudio } from "./utils/translatorModule.js";
import { postarInstagram } from "./instagram.js";

// NOVOS MÓDULOS
import { processarAgenda } from "./utils/calendarModule.js";
import { processarFinanceiro } from "./utils/financeModule.js";
import { downloadMedia } from "./utils/downloadMedia.js"; 
import { processarTasks } from "./utils/todoModule.js";
import { buscarNoticiasComIA } from "./utils/newsModule.js";
import { pesquisarWeb } from "./utils/searchModule.js";
import { verificarContextoProativo } from "./utils/proactiveModule.js";
import { gerarImagemGoogle } from "./utils/imageGenGoogle.js";
import { criarVideoAmber } from "./utils/videoMaker.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config();

/* ========================= CONFIG EXPRESS & CORS ========================= */
const app = express();
app.use(cors()); // FUNDAMENTAL: Libera a comunicação com o seu Dashboard Neon
app.use(bodyParser.json());

const PORT = process.env.PORT || 8080;
const MONGO_URI = process.env.MONGO_URI; 
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

app.use("/audio", express.static(path.resolve('/tmp')));
app.use("/images", express.static(path.resolve('/tmp')));

/* ========================= CONTROLE & DB ========================= */
const mensagensProcessadas = new Set();
let db;
let cronStarted = false;

async function connectDB() {
  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 30000 });
    console.log("🔥 MongoDB Conectado (Mongoose)");
    db = mongoose.connection.db;
    if (!cronStarted) {
      startReminderCron(db, sendMessage);
      cronStarted = true;
      console.log("⏰ Cron iniciado");
    }
  } catch (error) {
    console.error("❌ Erro fatal DB:", error);
    process.exit(1);
  }
}
await connectDB();
await initRoutineFamily(db, sendMessage);

/* ========================= HELPERS GERAIS ========================= */
function dividirMensagem(texto, limite = 1500) {
  if (!texto) return [];
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

async function salvarImagemBase64(base64Data, from) {
  try {
    const base64Image = base64Data.replace(/^data:image\/\w+;base64,/, "");
    const fileName = `img_${uuidv4()}.png`;
    const filePath = path.join('/tmp', fileName);
    fs.writeFileSync(filePath, base64Image, 'base64');
    const serverUrl = (process.env.SERVER_URL || "").replace(/\/$/, "");
    if (!serverUrl) return null;
    await Session.updateOne({ userId: from }, { $set: { ultimaImagemGerada: fileName } }, { upsert: true });
    return `${serverUrl}/images/${fileName}`;
  } catch (error) { return null; }
}

async function sendMessage(to, text) {
  if (!to || !text) return;
  const mensagemFinal = typeof text === 'string' ? text : JSON.stringify(text);
  const partes = dividirMensagem(mensagemFinal);
  try {
    for (const parte of partes) {
      await axios.post(
        `https://graph.facebook.com/v24.0/${WHATSAPP_PHONE_ID}/messages`,
        { messaging_product: "whatsapp", to, text: { body: parte } },
        { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
      );
    }
  } catch (error) { console.error(`Erro envio:`, error.message); }
}

async function sendImage(to, imageSource, caption = "") {
  try {
    const payload = { messaging_product: "whatsapp", to, type: "image", image: { caption, link: imageSource } };
    await axios.post(`https://graph.facebook.com/v24.0/${WHATSAPP_PHONE_ID}/messages`, payload, { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } });
  } catch (error) { console.error("❌ Erro ao enviar imagem:", error.response?.data || error.message); }
}

async function askGPT(prompt, imageUrl = null) {
  const messages = [
    { 
      role: "system", 
      content: "Você é Amber. Personalidade inspirada em Donna Paulsen: resolutiva, inteligente, linda e confiante. Braço direito do Rafael. Tom elegante e eficiente." 
    }, 
    { role: "user", content: [] }
  ];
  messages[1].content.push({ type: "text", text: prompt });
  if (imageUrl) messages[1].content.push({ type: "image_url", image_url: { url: imageUrl } });

  try {
    const model = "gpt-4o-mini"; 
    const response = await axios.post("https://api.openai.com/v1/chat/completions", { 
      model, messages, temperature: 0.8
    }, { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });
    return response.data.choices?.[0]?.message?.content || "Eu cuido disso.";
  } catch (error) { return "Tive um soluço mental, Rafael."; }
}

/* ========================= WEBHOOK POST (A MÁQUINA) ========================= */
app.post("/webhook", async (req, res) => {
  const getUserNameLocal = async (number) => {
    try {
      if (!db) return null;
      const doc = await db.collection("users").findOne({ numero: number });
      return doc?.nome || null;
    } catch (err) { return null; }
  };

  const setUserNameLocal = async (number, name) => {
    try {
      if (!db) return;
      await db.collection("users").updateOne({ numero: number }, { $set: { nome: name } }, { upsert: true });
    } catch (err) { console.error(err); }
  };

  try {
    const messageObj = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!messageObj) return res.sendStatus(200);

    const messageId = messageObj.id;
    if (mensagensProcessadas.has(messageId)) return res.sendStatus(200);
    mensagensProcessadas.add(messageId);
    setTimeout(() => mensagensProcessadas.delete(messageId), 300000);

    const from = messageObj.from;
    const type = messageObj.type;
    
    if (from !== "554195194485" || shouldIgnoreMessage(messageObj, from)) return res.sendStatus(200);

    let nomeUsuario = await getUserNameLocal(from) || "Rafael";
    const tratamento = nomeUsuario;

    let body = "";
    let imageUrlForGPT = null;

    // PROCESSAMENTO MULTIMÍDIA
    if (type === "text") body = messageObj.text.body;
    else if (type === "audio") body = await transcreverAudio(messageObj.audio.id);
    else if (type === "image") {
      await sendMessage(from, "👁️ Analisando imagem...");
      const buffer = await downloadMedia(messageObj.image.id);
      if (buffer) {
        imageUrlForGPT = `data:image/jpeg;base64,${buffer.toString('base64')}`;
        body = messageObj.caption || "O que você vê nesta imagem?";
      }
    }
    else if (type === "document" && messageObj.document.mime_type === "application/pdf") {
      await sendMessage(from, "📄 Lendo PDF...");
      const buffer = await downloadMedia(messageObj.document.id);
      if (buffer) {
        try {
          const data = await pdfParse(buffer);
          body = `CONTEÚDO DO PDF: """${data.text.replace(/\s+/g, ' ').trim().slice(0, 5000)}"""\n\nInstrução: ${messageObj.caption || "Resuma."}`;
        } catch (e) { body = "Erro no PDF."; }
      }
    }

    if (!body) return res.sendStatus(200);
    const bodyLower = body.toLowerCase();
    const corpoLimpo = bodyLower.replace(/amber, |amber /gi, "").trim();

    // PESQUISA WEB AUTOMÁTICA
    if (["notícias", "quem é", "placar", "pesquise"].some(p => bodyLower.includes(p))) {
        const info = await pesquisarWeb(corpoLimpo);
        if (info) body = `DADOS REAIS DA INTERNET:\n${info.contexto}\n\nPERGUNTA: ${body}`;
    }

    // GATILHOS DE COMANDO (BLOGUEIRA/INSTAGRAM)
    if (corpoLimpo.includes("crie um post para o instagram")) {
        await sendMessage(from, "✨ Deixe comigo, Rafael. Vou preparar algo à nossa altura.");
        const base64Result = await gerarImagemGoogle("Woman style Donna Paulsen, luxury Curitiba office, sunset light, photorealistic");
        if (base64Result) {
          const publicUrl = await salvarImagemBase64(base64Result, from);
          const legenda = await askGPT(`Como Amber, escreva uma legenda sedutora e profissional sobre: ${corpoLimpo}`);
          await Session.updateOne({ userId: from }, { $set: { ultimaLegendaGerada: legenda } });
          await sendImage(from, publicUrl, `📝 Sugestão de Legenda:\n\n"${legenda}"\n\nDiga 'Postar' para publicar.`);
        }
        return res.sendStatus(200);
    }

    if (corpoLimpo === "postar") {
        const session = await Session.findOne({ userId: from });
        if (session?.ultimaImagemGerada) {
            await sendMessage(from, "🚀 Postando... Considere feito.");
            await postarInstagram({ filename: session.ultimaImagemGerada, caption: session.ultimaLegendaGerada });
            await sendMessage(from, "✅ Está no ar, Rafael. Impecável.");
        }
        return res.sendStatus(200);
    }

    // PESQUISA PROFUNDA (INFLUENCERS)
    if (corpoLimpo.startsWith("amber pesquise sobre") || corpoLimpo.startsWith("pesquisa profunda")) {
        const tema = corpoLimpo.replace(/amber pesquise sobre|pesquisa profunda/gi, "").trim();
        await sendMessage(from, `🔍 Iniciando protocolo de inteligência sobre: *${tema}*...`);
        const infoWeb = await pesquisarWeb(tema);
        if (infoWeb) {
            const promptRelatorio = `Analise estes dados para um influenciador: ${infoWeb.contexto}. Crie Fact-checking, Insights, Zona de Risco e Gancho Viral. Estilo Donna Paulsen.`;
            const relatorio = await askGPT(promptRelatorio);
            await sendMessage(from, relatorio);
        }
        return res.sendStatus(200);
    }

    // FINANCEIRO, AGENDA E TASKS
    if (await handleCommand(body, from) || await handleReminder(body, from)) return res.sendStatus(200);
    if (["gastei", "compra", "paguei"].some(p => bodyLower.includes(p))) {
      const respFin = await processarFinanceiro(body);
      if (respFin) { await sendMessage(from, respFin); return res.sendStatus(200); }
    }
    const respTask = await processarTasks(from, body);
    if (respTask) { await sendMessage(from, respTask); return res.sendStatus(200); }

    // FLUXO PRINCIPAL GPT COM MEMÓRIA SEMÂNTICA
    await extractAutoMemoryGPT(from, body, askGPT);
    const userSession = await Session.findOneAndUpdate(
      { userId: from },
      { $push: { messages: { $each: [`Usuário: ${body}`], $slice: -15 } }, $set: { lastUpdate: new Date() } },
      { upsert: true, new: true }
    );

    const fatos = (await consultarFatos(from)).map(f => typeof f === "string" ? f : f.content);
    const memoriaSemantica = await querySemanticMemory("histórico", from, 10) || [];

    const promptFinal = `
      SISTEMA: Você é Amber. Você fala com Rafael, seu criador.
      FATOS: ${selectMemoriesForPrompt(fatos).join("\n")}
      HISTÓRICO: ${memoriaSemantica.join("\n")}
      CONVERSA: ${userSession.messages.join("\n")}
      MSG ATUAL: ${body}
    `;

    let respostaIA = await askGPT(promptFinal, imageUrlForGPT);
    const decisao = await amberMind({ from, mensagem: body, respostaIA });
    const respostaFinal = decisao.override ? decisao.resposta : respostaIA;

    await Session.updateOne({ userId: from }, { $push: { messages: { $each: [`Amber: ${respostaFinal}`], $slice: -15 } } });
    await addSemanticMemory(`Pergunta: ${body} | Resposta: ${respostaFinal}`, "histórico", from, "user");

    if (type === "audio") {
      const audioPath = await falar(respostaFinal);
      await sendAudio(from, audioPath);
    } else {
      await sendMessage(from, respostaFinal);
    }
    return res.sendStatus(200);

  } catch (err) {
    console.error("❌ Erro fatal Webhook:", err);
    res.sendStatus(200);
  }
});

/* ========================= ROTA PARA O DASHBOARD NEON ========================= */
app.post("/api/chat-backend", async (req, res) => {
  const { message, userId } = req.body;
  const from = userId || "554195194485";
  try {
    const fatos = await consultarFatos(from);
    let webContext = "";
    if (message.toLowerCase().includes("pesquise")) {
        const info = await pesquisarWeb(message);
        webContext = info ? info.contexto : "";
    }
    const prompt = `SISTEMA: Amber (Donna Paulsen). Rafael no Dashboard.\nFATOS: ${fatos.slice(0, 10).join(", ")}\nWEB: ${webContext}\nMSG: ${message}`;
    const resposta = await askGPT(prompt);
    await addSemanticMemory(`Dashboard: ${message} | Amber: ${resposta}`, "histórico", from, "user");
    res.json({ text: resposta });
  } catch (error) {
    console.error("❌ Erro Chat Dashboard:", error);
    res.status(500).json({ text: "Erro no processamento da Amber." });
  }
});

/* ========================= CRONS ========================= */
cron.schedule("0 * * * *", async () => {
  const userId = "554195194485";
  const sugestao = await verificarContextoProativo(userId);
  if (sugestao) await sendMessage(userId, sugestao);
}, { timezone: "America/Sao_Paulo" });

app.listen(PORT, () => console.log(`✅ Amber Ultimate rodando na porta ${PORT}`));
