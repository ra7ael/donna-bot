// src/server.js
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
import cron from "node-cron";
import { verificarContextoProativo } from "./utils/proactiveModule.js";
import { gerarImagemGoogle } from "./utils/imageGenGoogle.js";
import { criarVideoAmber } from "./utils/videoMaker.js";

// AQUI: REMOVI O IMPORT QUE DAVA ERRO (userProfile.js)

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ========================= CONFIG ========================= */
dotenv.config();
mongoose.set("strictQuery", false);

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 8080;
const MONGO_URI = process.env.MONGO_URI; 
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

app.use("/audio", express.static(path.resolve('/tmp')));
app.use("/images", express.static(path.resolve('/tmp')));

/* ========================= CONTROLE ========================= */
const mensagensProcessadas = new Set();
let db;
let cronStarted = false;

/* ========================= DB ========================= */
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

/* ========================= HELPERS ========================= */
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
  const messages = [{ role: "system", content: "Você é Amber. Inteligente, sofisticada e útil." }, { role: "user", content: [] }];
  messages[1].content.push({ type: "text", text: prompt });
  if (imageUrl) {
    messages[1].content.push({ type: "image_url", image_url: { url: imageUrl } });
  }
  try {
    const model = "gpt-4o-mini"; 
    const response = await axios.post("https://api.openai.com/v1/chat/completions", { model, messages, temperature: 0.7 }, { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });
    return response.data.choices?.[0]?.message?.content || "Certo.";
  } catch (error) { return "Tive um soluço mental, pode repetir?"; }
}

async function buscarInformacaoDireito(pergunta) {
  try {
    const resultados = await consultarDataJud(pergunta);
    if (!resultados || !resultados.length) return "Não encontrei dados oficiais.";
    return resultados.map((r, i) => `${i + 1}. ${r.titulo} - ${r.link}`).join("\n");
  } catch (e) { return "Erro ao consultar base jurídica."; }
}

app.get("/", (req, res) => res.status(200).send("Amber Ultimate Online 🟢"));
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOKEN) return res.status(200).send(req.query["hub.challenge"]);
  res.sendStatus(403);
});

const NUMEROS_PERMITIDOS = ["554195194485"];
const numeroPermitido = from => NUMEROS_PERMITIDOS.includes(from);

/* ========================= WEBHOOK POST ========================= */
app.post("/webhook", async (req, res) => {
  // 1. FUNÇÕES DE APOIO (LOCAIS)
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
      await db.collection("users").updateOne(
        { numero: number },
        { $set: { nome: name } },
        { upsert: true }
      );
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
    
    if (!numeroPermitido(from) || shouldIgnoreMessage(messageObj, from)) return res.sendStatus(200);

    /* --- RECONHECIMENTO DE IDENTIDADE --- */
    let nomeUsuario = await getUserNameLocal(from);
    if (!nomeUsuario && from === "554195194485") {
        await setUserNameLocal(from, "Rafael");
        nomeUsuario = "Rafael";
    }
    const tratamento = nomeUsuario || "usuário";

    /* --- EXTRAÇÃO DE CONTEÚDO --- */
    let body = "";
    let imageUrlForGPT = null;

    if (type === "text") {
      body = messageObj.text.body;
    } 
    else if (type === "audio") {
      body = await transcreverAudio(messageObj.audio.id);
    } 
    else if (type === "image") {
      await sendMessage(from, "👁️ Analisando imagem...");
      const buffer = await downloadMedia(messageObj.image.id);
      if (buffer) {
        const base64Image = buffer.toString('base64');
        imageUrlForGPT = `data:${messageObj.image.mime_type || "image/jpeg"};base64,${base64Image}`;
        body = messageObj.caption || "O que você vê nesta imagem?";
      }
    }
    else if (type === "document" && messageObj.document.mime_type === "application/pdf") {
      await sendMessage(from, "📄 Lendo PDF...");
      const buffer = await downloadMedia(messageObj.document.id);
      if (buffer) {
        try {
          const data = await pdfParse(buffer);
          const textoExtraido = data.text ? data.text.replace(/\s+/g, ' ').trim() : "";
          body = `CONTEÚDO DO PDF: """${textoExtraido.slice(0, 5000)}"""\n\nInstrução: ${messageObj.caption || "Resuma."}`;
        } catch (e) { body = "Erro no PDF."; }
      }
    }

    if (!body) return res.sendStatus(200);

    const bodyLower = body.toLowerCase();
    const corpoLimpo = bodyLower.replace(/amber, |amber /gi, "").trim();

    /* 2. BLOCO DE INTERNET (Tavily) */
    const palavrasChaveInternet = ["notícias", "quem é", "placar", "resultado", "preço", "como está", "hoje", "pesquise"];
    if (palavrasChaveInternet.some(p => bodyLower.includes(p))) {
        const infoFrequinhas = await pesquisarWeb(corpoLimpo);
        if (infoFrequinhas) {
            body = `DADOS REAIS DA INTERNET:\n${infoFrequinhas.resumo}\n\nDETALHES:\n${infoFrequinhas.contexto}\n\nPERGUNTA: ${body}`;
        }
    }

    /* 3. GATILHOS DE COMANDO */

    // Instagram
    if (corpoLimpo.startsWith("poste isso no instagram")) {
      await sendMessage(from, "📸 Preparando postagem...");
      const session = await Session.findOne({ userId: from });
      if (session?.ultimaImagemGerada) {
        const resultado = await postarInstagram({ filename: session.ultimaImagemGerada, caption: corpoLimpo.replace("poste isso no instagram", "").trim() });
        if (resultado && !resultado.error) await sendMessage(from, `✅ Postado com sucesso.`);
      }
      return res.sendStatus(200);
    }

    // Gerar Imagem
    if (corpoLimpo.startsWith("desenha") || corpoLimpo.startsWith("imagem de")) {
      await sendMessage(from, "🎨 Criando sua imagem...");
      const promptImg = corpoLimpo.replace(/desenha|imagem de/gi, "").trim();
      const base64Result = await gerarImagemGoogle(promptImg);
      if (base64Result) {
        const publicUrl = await salvarImagemBase64(base64Result, from);
        if (publicUrl) await sendImage(from, publicUrl, `🖌️ "${promptImg}"`);
      }
      return res.sendStatus(200);
    }

    await extractAutoMemoryGPT(from, body, askGPT);

    // Gerar Vídeo
    if (bodyLower.startsWith("amber, faz um vídeo sobre")) {
        const tema = bodyLower.replace("amber, faz um vídeo sobre", "").trim();
        await sendMessage(from, `🎬 Produzindo vídeo sobre "${tema}"...`);
        try {
            const caminhosImagens = [];
            for (let i = 1; i <= 6; i++) {
                const base64Result = await gerarImagemGoogle(`${tema}, scene ${i}`);
                if (base64Result) {
                    const filePath = path.join('/tmp', `v_${uuidv4()}.png`);
                    fs.writeFileSync(filePath, base64Result.replace(/^data:image\/\w+;base64,/, ""), 'base64');
                    caminhosImagens.push(filePath);
                }
            }
            if (caminhosImagens.length > 0) {
                const videoUrl = await criarVideoAmber(caminhosImagens, `v_${Date.now()}`);
                await sendMessage(from, `✅ Vídeo pronto: ${(process.env.SERVER_URL || "").replace(/\/$/, "")}${videoUrl}`);
            }
            caminhosImagens.forEach(p => fs.remove(p).catch(() => {}));
        } catch (e) { console.error(e); }
        return res.sendStatus(200);
    }

    if (await handleCommand(body, from) || await handleReminder(body, from)) return res.sendStatus(200);

    if (["gastei", "compra", "paguei", "valor"].some(p => bodyLower.includes(p))) {
      const respFin = await processarFinanceiro(body);
      if (respFin) { await sendMessage(from, respFin); return res.sendStatus(200); }
    }

    const respTask = await processarTasks(from, body);
    if (respTask) { await sendMessage(from, respTask); return res.sendStatus(200); }

    const gatilhosAgenda = ["agenda", "marcar", "agendar", "reunião", "compromisso"];
    if (gatilhosAgenda.some(g => bodyLower.includes(g))) {
       const respAgenda = await processarAgenda(body);
       await sendMessage(from, respAgenda);
       return res.sendStatus(200);
    }

    if (bodyLower.startsWith("amber envia mensagem")) {
      const regex = /para\s+([\d,\s]+)[\s:]+(.*)/i;
      const match = bodyLower.match(regex);
      if (match) {
        const numeros = match[1].replace(/\s/g, "").split(",").filter(Boolean);
        const msgParaEnviar = match[2];
        (async () => {
            for (const numero of numeros) {
              await sendMessage(numero, msgParaEnviar);
              await new Promise(r => setTimeout(r, 2000));
            }
            await sendMessage(from, "✅ Envio concluído.");
        })();
        return res.sendStatus(200);
      }
    }

    if (bodyLower.includes("traduza para")) {
        const textoTraduzido = await askGPT(`Traduza: ${body}`);
        const audioFile = await traduzirEGerarAudio(textoTraduzido);
        if (audioFile) await sendAudio(from, `${process.env.SERVER_URL}/audio/${audioFile}`);
        else await sendMessage(from, textoTraduzido);
        return res.sendStatus(200);
    }

    if (bodyLower.includes("clima") || bodyLower.includes("previsão")) {
      const clima = await getWeather("Curitiba", "hoje");
      await sendMessage(from, clima);
      return res.sendStatus(200);
    }

    /* 4. FLUXO PRINCIPAL GPT */
    const userSession = await Session.findOneAndUpdate(
      { userId: from },
      { $push: { messages: { $each: [`Usuário: ${body}`], $slice: -15 } }, $set: { lastUpdate: new Date() } },
      { upsert: true, new: true }
    );

    const fatos = (await consultarFatos(from)).map(f => typeof f === "string" ? f : f.content);
    const memoriaSemantica = await querySemanticMemory("histórico", from, 10) || [];

    const promptFinal = `
      SISTEMA: Você é Amber. Você fala com ${tratamento}. 
      ${tratamento === 'Rafael' ? 'Ele é seu criador.' : ''}
      
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
    console.error("❌ Erro fatal:", err);
    return res.sendStatus(200);
  }
});

/* ========================= CRONS ========================= */
cron.schedule("0 * * * *", async () => {
  const userId = "554195194485";
  const sugestao = await verificarContextoProativo(userId);
  if (sugestao) await sendMessage(userId, sugestao);
}, { timezone: "America/Sao_Paulo" });

app.listen(PORT, () => console.log(`✅ Amber Ultimate rodando na porta ${PORT}`));
