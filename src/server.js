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
import pdfParse from "pdf-parse-fork";

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

// NOVOS MÓDULOS
import { processarAgenda } from "./utils/calendarModule.js";
import { processarFinanceiro } from "./utils/financeModule.js";
import { downloadMedia } from "./utils/downloadMedia.js"; 

/* ========================= CONFIG ========================= */
dotenv.config();
mongoose.set("strictQuery", false);

const app = express();
app.use(bodyParser.json());
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
fs.ensureDirSync(path.join(__dirname, "public/audio"));
app.use("/audio", express.static(path.join(__dirname, "public/audio")));

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
  } catch (error) {
    console.error(`Erro envio:`, error.message);
  }
}

async function askGPT(prompt, imageUrl = null) {
  const messages = [
    { role: "system", content: "Você é Amber. Inteligente, sofisticada e útil." },
    { role: "user", content: [] }
  ];

  messages[1].content.push({ type: "text", text: prompt });

  if (imageUrl) {
    messages[1].content.push({
      type: "image_url",
      image_url: { url: imageUrl }
    });
  }

  try {
    // Tenta usar gpt-4o para visão, se der erro de "Tier", o catch captura
    const model = imageUrl ? "gpt-4o" : "gpt-4o-mini";
    
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      { model, messages, temperature: 0.7 },
      { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
    );
    return response.data.choices?.[0]?.message?.content || "Certo.";
  } catch (error) {
    console.error("❌ Erro OpenAI (askGPT):", error.response?.data || error.message);
    return "Tive um problema ao processar essa informação agora.";
  }
}

async function buscarInformacaoDireito(pergunta) {
  try {
    const resultados = await consultarDataJud(pergunta);
    if (!resultados || !resultados.length) return "Não encontrei dados oficiais.";
    return resultados.map((r, i) => `${i + 1}. ${r.titulo} - ${r.link}`).join("\n");
  } catch (e) {
    console.error("Erro DataJud:", e);
    return "Erro ao consultar base jurídica.";
  }
}

app.get("/", (req, res) => res.status(200).send("Amber Ultimate Online 🟢"));
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  res.sendStatus(403);
});

const NUMEROS_PERMITIDOS = ["554195194485"];
const numeroPermitido = from => NUMEROS_PERMITIDOS.includes(from);

/* ========================= WEBHOOK POST ========================= */
app.post("/webhook", async (req, res) => {
  try {
    const messageObj = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!messageObj) return res.sendStatus(200);

    console.log(`📩 Nova mensagem recebida! Tipo: ${messageObj.type} de: ${messageObj.from}`);

    const messageId = messageObj.id;
    if (mensagensProcessadas.has(messageId)) return res.sendStatus(200);
    mensagensProcessadas.add(messageId);
    setTimeout(() => mensagensProcessadas.delete(messageId), 300000);

    const from = messageObj.from;
    const type = messageObj.type;
    
    if (!numeroPermitido(from) || shouldIgnoreMessage(messageObj, from)) return res.sendStatus(200);

    let body = "";
    let imageUrlForGPT = null;

   // --- 1. PROCESSAMENTO DE MÍDIA ---
    if (type === "text") {
      body = messageObj.text.body;
    } 
    else if (type === "audio") {
      body = await transcreverAudio(messageObj.audio.id);
    } 
    else if (type === "image") {
      console.log(`📸 Imagem detectada! ID: ${messageObj.image.id}`);
      await sendMessage(from, "👁️ Analisando imagem...");
      
      const buffer = await downloadMedia(messageObj.image.id);
      if (buffer) {
        console.log("✅ Buffer da imagem obtido com sucesso.");
        const base64Image = buffer.toString('base64');
        const mimeType = messageObj.image.mime_type || "image/jpeg";
        imageUrlForGPT = `data:${mimeType};base64,${base64Image}`;
        body = messageObj.caption || "O que você vê nesta imagem?";
      } else {
        console.error("❌ Falha ao baixar o buffer da imagem.");
        await sendMessage(from, "Não consegui baixar a foto.");
        return res.sendStatus(200);
      }
    }  
      
    else if (type === "document") {
      console.log(`📄 Documento detectado! Mime: ${messageObj.document.mime_type}`);
      if (messageObj.document.mime_type === "application/pdf") {
        await sendMessage(from, "📄 Lendo PDF...");
        const buffer = await downloadMedia(messageObj.document.id);
        if (buffer) {
          try {
            const data = await pdfParse(buffer);
            // Limpamos o texto do PDF para tirar quebras de linha excessivas
            const textoLimpo = data.text.replace(/\s+/g, ' ').trim().slice(0, 4000);
            
            // Aqui damos uma instrução direta e colamos o conteúdo
            body = `CONTEÚDO DO DOCUMENTO PDF: """${textoLimpo}"""\n\nInstrução do usuário: ${messageObj.caption || "Resuma este documento para mim."}`;
            console.log("✅ PDF extraído e anexado ao corpo da mensagem.");
          } catch (e) {
            console.error("❌ Erro no pdfParse:", e.message);
            body = "Erro ao ler o texto do PDF.";
          }
        }
      } else {
        await sendMessage(from, "No momento só consigo ler arquivos PDF.");
        return res.sendStatus(200);
      }
    }

    if (!body) return res.sendStatus(200);
    const bodyLower = body.toLowerCase();

    // Segue para a memória automática
    await extractAutoMemoryGPT(from, body, askGPT);

    /* ===== 2. ROTINAS DE COMANDO ===== */

    if (await handleCommand(body, from) || await handleReminder(body, from)) {
      return res.sendStatus(200);
    }

    if (["gastei", "compra", "paguei", "valor"].some(p => bodyLower.includes(p))) {
      const respFin = await processarFinanceiro(body);
      if (respFin) { 
        await sendMessage(from, respFin);
        return res.sendStatus(200);
      }
    }

    const gatilhosAgenda = ["agenda", "marcar", "agendar", "reunião", "compromisso"];
    if (gatilhosAgenda.some(g => bodyLower.includes(g))) {
       const respAgenda = await processarAgenda(body);
       await sendMessage(from, respAgenda);
       return res.sendStatus(200);
    }

    if (bodyLower.startsWith("amber envia mensagem") || bodyLower.startsWith("amber, envia mensagem")) {
      const regex = /para\s+([\d,\s]+)[\s:]+(.*)/i;
      const match = bodyLower.match(regex);
      if (!match) {
        await sendMessage(from, "Formato: 'Amber envia mensagem para <numeros> <mensagem>'");
        return res.sendStatus(200);
      }
      const numeros = match[1].replace(/\s/g, "").split(",").filter(Boolean);
      const mensagemParaEnviar = match[2];
      await sendMessage(from, `Iniciando envio para ${numeros.length} contatos...`);
      (async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms));
          for (const numero of numeros) {
            await sendMessage(numero, mensagemParaEnviar);
            await sleep(2000);
          }
          await sendMessage(from, "✅ Envio em massa concluído.");
      })().catch(err => console.error("Erro no broadcast:", err));
      return res.sendStatus(200);
    }

    if (bodyLower.includes("english") || bodyLower.startsWith("translate")) {
      const respEng = await amberEnglishUltimate({ userId: from, pergunta: body, level: "beginner" });
      await sendMessage(from, respEng);
      return res.sendStatus(200);
    }

    if (["lei", "artigo", "direito", "jurisprudência"].some(p => bodyLower.includes(p))) {
      const refs = await buscarInformacaoDireito(body);
      const respDir = await askGPT(`Leis BR:\n${refs}\n\nPergunta: ${body}`);
      await sendMessage(from, respDir);
      return res.sendStatus(200);
    }

    if (["clima", "tempo", "previsão"].some(p => bodyLower.includes(p))) {
      const clima = await getWeather("Curitiba", "hoje");
      await sendMessage(from, clima);
      return res.sendStatus(200);
    }

/* ===== 3. FLUXO PRINCIPAL ===== */
    
    // Em vez de findOne + save, usamos findOneAndUpdate para evitar VersionError
    const userSession = await Session.findOneAndUpdate(
      { userId: from },
      { 
        $push: { 
          messages: { $each: [`Usuário: ${body}`], $slice: -15 } 
        },
        $set: { lastUpdate: new Date() }
      },
      { upsert: true, new: true }
    );

    const fatos = (await consultarFatos(from)).map(f => typeof f === "string" ? f : f.content);
    const fatosFiltrados = selectMemoriesForPrompt(fatos);
    const memoriaSemantica = await querySemanticMemory("histórico", from, 10) || [];

    const prompt = `
      FATOS: ${fatosFiltrados.join("\n")}
      HISTÓRICO: ${memoriaSemantica.join("\n")}
      CONVERSA: ${userSession.messages.join("\n")}
      MSG ATUAL: ${body}
    `;

    let respostaIA = await askGPT(prompt, imageUrlForGPT);
    
    const decisao = await amberMind({ from, mensagem: body, respostaIA });
    const respostaFinal = decisao.override ? decisao.resposta : respostaIA;

    // Atualiza a resposta da Amber na sessão
    await Session.updateOne(
      { userId: from },
      { 
        $push: { 
          messages: { $each: [`Amber: ${respostaFinal}`], $slice: -15 } 
        } 
      }
    );
    
    await addSemanticMemory(`Pergunta: ${body} | Resposta: ${respostaFinal}`, "histórico", from, "user");

    if (type === "audio") {
      try {
          const audioPath = await falar(respostaFinal);
          await sendAudio(from, audioPath);
      } catch (audioErr) {
          await sendMessage(from, respostaFinal);
      }
    } else {
      await sendMessage(from, respostaFinal);
    }

    return res.sendStatus(200);

  } catch (err) {
    console.error("❌ Erro fatal no webhook:", err);
    return res.sendStatus(200);
  }
});

app.listen(PORT, () => console.log(`✅ Amber Ultimate rodando na porta ${PORT}`));
