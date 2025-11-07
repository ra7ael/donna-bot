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
import * as cacheService from './services/cacheService.js';
import * as datasetService from './services/datasetService.js';
import * as getDonnaResponse from './services/getDonnaResponse.js';
import * as gptService from './services/gptService.js';

const uri = process.env.MONGO_URI || "mongodb+srv://<teu_usuario>:<tua_senha>@cluster0.mongodb.net/";
let db;

export async function connectDB() {
  if (db) return db;

  try {
    console.log("🔹 Tentando conectar ao MongoDB...");
    const client = new MongoClient(uri);
    await client.connect();

    db = client.db("donna");

    const collections = await db.listCollections().toArray();
    const names = collections.map(c => c.name);

    if (!names.includes("semanticMemory")) await db.createCollection("semanticMemory");
    if (!names.includes("users")) await db.createCollection("users");
    if (!names.includes("agenda")) await db.createCollection("agenda");

    await db.collection("semanticMemory").createIndex({ userId: 1, timestamp: -1 });
    await db.collection("semanticMemory").createIndex({ content: "text" });
    await db.collection("users").createIndex({ userId: 1 });

    console.log("✅ Conectado ao MongoDB (histórico, usuários, agenda)");
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

async function connectDB() {
  try {
    console.log("🔹 Tentando conectar ao MongoDB...");
    const client = await MongoClient.connect(MONGO_URI, { useUnifiedTopology: true });
    db = client.db("donna");

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
    // 🧠 Garante que o histórico esteja limpo e formatado
    const safeMessages = [
      {
        role: "system",
        content: "Você é a Donna, assistente pessoal do Rafael. Seja gentil, proativa e sempre contextualize as conversas anteriores sem perder objetividade."
      },
      ...history
        .map(m => ({
          role: m.role,
          content: typeof m.content === "string" ? m.content.trim() : ""
        }))
        .filter(m => m.content !== ""),
      { role: "user", content: prompt?.trim() || "" }
    ];

    // 🗣️ Envio para a API da OpenAI
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
          Authorization: `Bearer ${GPT_API_KEY}`, // ✅ corrigido aqui (faltavam crases)
          "Content-Type": "application/json"
        }
      }
    );

    // ✅ Retorna a resposta principal
    return response.data.choices?.[0]?.message?.content || "Hmm… ainda estou pensando!";
  } catch (err) {
    console.error("❌ Erro GPT:", err.response?.data || err.message);
    return "❌ Ocorreu um erro ao gerar a resposta.";
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

async function getUserMemory(userId, limit = 20) {
  return await db.collection("semanticMemory")
    .find({ userId })
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();
}

async function saveMemory(userId, role, content) {
  if (!content?.trim()) return;
  try {
    await db.collection("semanticMemory").insertOne({
      userId,
      role,
      content,
      timestamp: new Date()
    });
    console.log("💾 Memória salva:", { userId, role, content });
  } catch (err) {
    console.error("❌ Erro ao salvar memória:", err);
  }
}

// ===== Recupera memória contextual antes de responder =====
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

// ===== Webhook WhatsApp (interação direta) =====
app.post("/webhook", async (req, res) => {
  try {
    const messageObj = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!messageObj) return res.sendStatus(200);

    const from = messageObj.from;
    let body = "";
    let isAudioResponse = false;

    if (messageObj.type === "text") {
      body = messageObj.text.body;
    }

    // 🧠 Busca histórico recente
    const memories = await getUserMemory(from, 20);
    const chatHistory = memories.reverse()
      .map(m => ({
        role: m.role,
        content: m.content || ""
      }))
      .filter(m => m.content.trim() !== "");

    // 🔹 Gera resposta com contexto
    const resposta = await askGPT(body, chatHistory);

    // 💾 Salva nova interação
    await saveMemory(from, "user", body);
    await saveMemory(from, "assistant", resposta);

    // 📤 Responde no WhatsApp
    await sendMessage(from, resposta);

    res.sendStatus(200);
  } catch (err) {
    console.error("Erro no webhook:", err);
    res.sendStatus(500);
  }
});


    // 🧩 Captura com segurança o texto da mensagem
    if (messageObj.text?.body) {
      body = messageObj.text.body.trim();
    } else if (messageObj?.type === "audio") {
      isAudioResponse = true;
    } else {
      console.warn("⚠️ Mensagem recebida sem texto (pode ser mídia ou botão):", messageObj);
      return res.sendStatus(200);
    }

    if (!body) {
      console.warn("⚠️ Mensagem sem conteúdo textual.");
      return res.sendStatus(200);
    }


    // Somente números autorizados
    if (!numerosAutorizados.includes(from)) {
      console.log(`🚫 Número não autorizado ignorado: ${from}`);
      return res.sendStatus(200);
    }

    // ===== Tipos de mensagem =====
    if (messageObj.type === "text") {
      body = messageObj.text?.body || "";

      // 👇 COMANDO PERSONALIZADO: "minhas memórias"
      if (body.toLowerCase().startsWith("minhas memórias")) {
        const memorias = await db.collection("semanticMemory")
          .find({ userId: from })
          .sort({ timestamp: -1 })
          .limit(5)
          .toArray();

        if (memorias.length === 0) {
          await sendMessage(from, "🧠 Você ainda não tem memórias salvas.");
        } else {
          const resumo = memorias.map((m, i) => `• ${m.role === "user" ? "Você disse" : "Donna respondeu"}: ${m.content}`).join("\n");
          await sendMessage(from, `🗂️ Aqui estão suas últimas memórias:\n\n${resumo}`);
        }

        return res.sendStatus(200);
      }

      // 👇 COMANDO PERSONALIZADO: salvar nome
      if (body.toLowerCase().startsWith("meu nome é")) {
        const nome = body.split("meu nome é")[1].trim();
        await setUserName(from, nome);
        await sendMessage(from, `✅ Nome salvo: ${nome}`);
        return res.sendStatus(200);
      }

      // 👇 COMANDO PERSONALIZADO: consultar nome
      if (body.toLowerCase().includes("qual é meu nome")) {
        const nome = await getUserName(from);
        await sendMessage(from, nome ? `📛 Seu nome é ${nome}` : `❌ Ainda não sei seu nome. Quer me dizer?`);
        return res.sendStatus(200);
      }

      if (body.toLowerCase().startsWith("fala ")) {
        body = body.slice(5).trim();
        isAudioResponse = true;
      }
    } else if (messageObj.type === "audio") {
      const audioBuffer = await downloadMedia(messageObj.audio?.id);
      if (audioBuffer) body = await transcribeAudio(audioBuffer);
      isAudioResponse = true;
    } else if (messageObj.type === "document") {
      const document = messageObj.document;
      if (!document) {
        await sendMessage(from, "❌ Não consegui processar o arquivo enviado.");
        return res.sendStatus(200);
      }

      try {
        const pdfBuffer = await downloadMedia(document.id);
        if (!pdfBuffer) {
          await sendMessage(from, "❌ Não consegui baixar o arquivo PDF.");
          return res.sendStatus(200);
        }

        const pdfsDir = "./src/utils/pdfs";
        if (!fs.existsSync(pdfsDir)) fs.mkdirSync(pdfsDir, { recursive: true });
        const caminhoPDF = `${pdfsDir}/${document.filename}`;
        fs.writeFileSync(caminhoPDF, pdfBuffer);

        await processarPdf(caminhoPDF);
        await sendMessage(from, `✅ PDF "${document.filename}" processado com sucesso!`);
      } catch (err) {
        console.error("❌ Erro ao processar PDF do WhatsApp:", err);
        await sendMessage(from, "❌ Ocorreu um erro ao processar seu PDF.");
      }

      return res.sendStatus(200);
    } else {
      await sendMessage(from, "Só consigo responder mensagens de texto ou áudio 😉");
      return res.sendStatus(200);
    }

    // 🔹 Pega o conteúdo da mensagem recebida
    const promptBody = (messageObj?.text?.body || body || "").trim();

    // 🔹 Verifica se a mensagem é válida
    if (!promptBody || promptBody.length < 2) {
      await sendMessage(from, "❌ Por favor, digite uma mensagem completa.");
      return res.sendStatus(200);
    }

    // ===== Verifica comando de papéis =====
    const comandoPapel = verificarComandoProfissao(promptBody);
    if (comandoPapel) {
      await sendMessage(from, comandoPapel.resposta);
      return res.sendStatus(200);
    }

    // 👇 COMANDO PERSONALIZADO: buscar memória por palavra
    if (body.toLowerCase().startsWith("buscar memória")) {
      const termo = body.split("buscar memória")[1].trim();

      if (!termo) {
        await sendMessage(from, "⚠️ Diga o que quer buscar. Exemplo: 'buscar memória benefícios'");
        return res.sendStatus(200);
      }

      const resultados = await db.collection("semanticMemory").find({
        userId: from,
        content: { $regex: new RegExp(termo, "i") }
      })
        .sort({ timestamp: -1 })
        .limit(5)
        .toArray();

      if (resultados.length === 0) {
        await sendMessage(from, `❌ Nenhuma memória encontrada com o termo: ${termo}`);
      } else {
        const resumo = resultados.map(m => `• ${m.role === "user" ? "Você disse" : "Donna respondeu"}: ${m.content}`).join("\n\n");
        await sendMessage(from, `🧠 Memórias que encontrei sobre *${termo}*:\n\n${resumo}`);
      }

      return res.sendStatus(200);
    }

    // 👇 COMANDO PERSONALIZADO: salvar informações de empresa
    if (body.toLowerCase().startsWith("empresa")) {
      try {
        const partes = body.split("empresa")[1].trim();
        const nomeEmpresa = partes.split(" ")[0].toLowerCase();
        const info = partes.replace(nomeEmpresa, "").trim();

        if (!info) {
          await sendMessage(from, "⚠️ Por favor, informe algo sobre a empresa, ex: 'empresa Brink tem plano de saúde e VR'");
          return res.sendStatus(200);
        }

        await db.collection("empresas").updateOne(
          { nome: nomeEmpresa },
          { $set: { beneficios: info, atualizadoEm: new Date() } },
          { upsert: true }
        );

        console.log(`treinoDonna: informações salvas no DB para empresa -> ${nomeEmpresa}`);
        await sendMessage(from, `🏢 Informações salvas para ${nomeEmpresa}: ${info}`);
        return res.sendStatus(200);
      } catch (error) {
        console.error("❌ Erro ao salvar informações da empresa:", error);
        await sendMessage(from, "⚠️ Ocorreu um erro ao salvar as informações da empresa.");
        return res.sendStatus(500);
      }
    }

    // 👇 COMANDO PERSONALIZADO: consultar informações de empresa
    if (body.toLowerCase().startsWith("info da empresa")) {
      try {
        const partes = body.split("info da empresa");
        const nomeEmpresa = partes[1] ? partes[1].trim().toLowerCase() : null;

        if (!nomeEmpresa) {
          await sendMessage(from, "⚠️ Informe o nome da empresa, ex: 'info da empresa Brink'");
          return res.sendStatus(200);
        }

        const empresa = await db.collection("empresas").findOne({ nome: nomeEmpresa });

        if (empresa) {
          console.log(`treinoDonna: consulta de informações para empresa -> ${nomeEmpresa}`);
          await sendMessage(from, `🏢 ${nomeEmpresa.toUpperCase()}:\n${empresa.beneficios}`);
        } else {
          await sendMessage(from, `❌ Não encontrei informações sobre ${nomeEmpresa}.`);
        }

        return res.sendStatus(200);
      } catch (error) {
        console.error("❌ Erro ao consultar informações da empresa:", error);
        await sendMessage(from, "⚠️ Ocorreu um erro ao buscar informações da empresa.");
        return res.sendStatus(500);
      }
    }

    // ===== Memória e GPT =====
    const memories = await getUserMemory(from, 20);
    const chatHistory = memories.reverse()
      .map(m => ({
        role: m.role,
        content: m.content || ""
      }))
      .filter(m => m.content.trim() !== "");

    const systemMessage = {
      role: "system",
      content: `Você é a Donna, assistente pessoal do usuário.
- Use o nome do usuário quando souber.
- Responda de forma objetiva, clara, direta e amigável.
- Priorize respostas curtas e práticas.
- Se precisar listar opções, limite a no máximo 3 itens.
- Nunca escreva parágrafos longos.
- Adapte o tom para ser acolhedora e prestativa.
- Se a pergunta for sobre horário, data, clima ou lembretes, responda de forma precisa.
- Não invente informações; se não souber, admita de forma educada.`
    };

    let reply = await funcoesExtras(from, promptBody);
    if (!reply) reply = await obterResposta(promptBody, from);

    if (!reply) {
      const pdfTrechos = await buscarPergunta(promptBody);
      const promptFinal = pdfTrechos
        ? `${promptBody}\n\nBaseado nestes trechos de PDF:\n${pdfTrechos}`
        : promptBody;

      reply = await askGPT(promptFinal, [systemMessage, ...chatHistory]);
      await treinarDonna(promptBody, reply, from);
    }

    await saveMemory(from, "user", promptBody);
    await saveMemory(from, "assistant", reply);

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

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Erro no webhook:", err);
    res.sendStatus(500);
  }
});

// ===== ROTA DE SAÚDE PARA RENDER DETECTAR A PORTA =====
app.get("/", (req, res) => {
  res.send("✅ Donna está online!");
});

// ===== INICIA O SERVIDOR =====
app.listen(PORT, () => console.log(`✅ Donna rodando na porta ${PORT}`));


export {
  askGPT,
  getTodayEvents,
  addEvent,
  saveMemory,
  db
};

