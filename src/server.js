// src/server.js

import express from 'express';
import OpenAI from "openai";
import { MongoClient } from 'mongodb';
import bodyParser from 'body-parser';
import axios from 'axios';
import dotenv from 'dotenv';
import mongoose from "mongoose";
import { DateTime } from 'luxon';
import { startReminderCron } from "./cron/reminders.js";
import { getWeather } from "./utils/weather.js";
import { downloadMedia } from './utils/downloadMedia.js';
import cron from "node-cron";
import { responderFAQ } from "./utils/faqHandler.js";
import { numerosAutorizados } from "./config/autorizados.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import FormData from "form-data";
import { falar, sendAudio } from "./utils/speak.js";
import { treinarDonna, obterResposta, setPapeis, clearPapeis } from "./utils/treinoDonna.js";
import { buscarPergunta } from "./utils/buscarPdf.js"; // <-- adicionado
import multer from "multer";
import { processarPdf } from "./utils/processarPdf.js";

dotenv.config();

const app = express();
app.use(bodyParser.json());

const upload = multer({ dest: "uploads/" });

// ===== Papéis Profissionais =====
const profissoes = [
  "Enfermeira Obstetra","Médica", "Nutricionista", "Personal Trainer", "Psicóloga", "Coach de Produtividade",
  "Consultora de RH", "Advogada", "Contadora", "Engenheira Civil", "Arquiteta",
  "Designer Gráfica", "Professora de Inglês", "Professora de Matemática", "Professora de História",
  "Cientista de Dados", "Desenvolvedora Full Stack", "Especialista em IA", "Marketing Manager", // neutro
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
  await db.collection("donna").insertOne({
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
  return await db.collection("donna").find({ numero: number, data: today }).sort({ hora: 1 }).toArray();
}

app.post("/webhook", async (req, res) => {
  try {
    const messageObj = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!messageObj) return res.sendStatus(200);

    const from = messageObj.from;
    let body = "";
    let isAudioResponse = false;

    if (!numerosAutorizados.includes(from)) {
      console.log(`🚫 Número não autorizado ignorado: ${from}`);
      return res.sendStatus(200);
    }

    if (messageObj.type === "text") {
      body = messageObj.text?.body || "";
      if (body.toLowerCase().startsWith("fala ")) {
        body = body.slice(5).trim();
        isAudioResponse = true;
      }
    } else if (messageObj.type === "audio") {
      const audioBuffer = await downloadMedia(messageObj.audio?.id);
      if (audioBuffer) body = await transcribeAudio(audioBuffer);
      isAudioResponse = true;
    } else {
      await sendMessage(from, "Só consigo responder mensagens de texto ou áudio 😉");
      return res.sendStatus(200);
    }

    const promptBody = (body || "").trim();
    const state = userStates[from] || {};

    if ((!promptBody || promptBody.length < 2) && state.step !== "ESCOLHER_EMPRESA") {
      await sendMessage(from, "❌ Por favor, digite uma mensagem completa ou uma palavra-chave válida.");
      return res.sendStatus(200);
    }

    const keywords = ["EMPRESA", "BANCO", "PAGAMENTO", "BENEFICIOS", "FOLHA PONTO", "HOLERITE"];
    if (keywords.includes(promptBody.toUpperCase())) {
      if (!state.nome) {
        userStates[from] = { step: "PEDIR_NOME", key: promptBody.toUpperCase() };
        await sendMessage(from, "Por favor, digite seu NOME completo:");
      } else {
        userStates[from].step = "PEDIR_EMPRESA";
        userStates[from].key = promptBody.toUpperCase();
        await sendMessage(from, "Digite o NOME da empresa em que você trabalha:");
      }
      return res.sendStatus(200);
    }

    const comandoPapel = verificarComandoProfissao(promptBody);
    if (comandoPapel) {
      await sendMessage(from, comandoPapel.resposta);
      return res.sendStatus(200);
    }

    if (state.step === "PEDIR_NOME") {
      userStates[from].nome = promptBody;
      await setUserName(from, promptBody);
      userStates[from].step = "PEDIR_EMPRESA";
      await sendMessage(from, "Agora digite o NOME da empresa em que você trabalha:");
      return res.sendStatus(200);
    }

    if (state.step === "PEDIR_EMPRESA") {
      const empresaInput = promptBody.toUpperCase();
      const empresasEncontradas = empresas.filter(e => e.nome.toUpperCase().includes(empresaInput));
      if (empresasEncontradas.length === 0) {
        await sendMessage(from, "❌ Empresa não encontrada. Digite exatamente o nome da empresa ou confira a grafia.");
        return res.sendStatus(200);
      }

      if (empresasEncontradas.length === 1) {
        const empresa = empresasEncontradas[0];
        userStates[from].empresa = empresa.nome;
        userStates[from].step = null;
        const { nome, key } = userStates[from];

        await sendMessage(from, `✅ Cadastro confirmado para ${nome} na empresa ${empresa.nome}`);
        return res.sendStatus(200);
      }

      userStates[from].empresasOpcoes = empresasEncontradas;
      userStates[from].step = "ESCOLHER_EMPRESA";
      let listaMsg = "🔎 Encontramos mais de uma empresa correspondente:\n";
      empresasEncontradas.forEach((e, i) => {
        listaMsg += `${i + 1}. ${e.nome}\n`;
      });
      listaMsg += "\nDigite apenas o número da empresa desejada.";
      await sendMessage(from, listaMsg);
      return res.sendStatus(200);
    }

    if (state.step === "ESCOLHER_EMPRESA") {
      const escolha = parseInt(promptBody.trim(), 10);
      const opcoes = state.empresasOpcoes || [];

      if (isNaN(escolha) || escolha < 1 || escolha > opcoes.length) {
        await sendMessage(from, "❌ Opção inválida. Digite apenas o número da empresa listado.");
        return res.sendStatus(200);
      }

      const empresaEscolhida = opcoes[escolha - 1];
      userStates[from].empresa = empresaEscolhida.nome;
      userStates[from].step = null;
      delete userStates[from].empresasOpcoes;

      const { nome, key } = state;
      await sendMessage(from, `✅ Cadastro confirmado!\nNome: ${nome}\nEmpresa: ${empresaEscolhida.nome}`);
      return res.sendStatus(200);
    }

    let userName = await getUserName(from);
    const nameMatch = promptBody.match(/meu nome é (\w+)/i);
    if (nameMatch) {
      userName = nameMatch[1];
      await setUserName(from, userName);
      await sendMessage(from, `Ótimo! Agora vou te chamar de ${userName} 😊`);
      return res.sendStatus(200);
    }

    const memories = await getUserMemory(from, 6);
    const chatHistory = memories.reverse()
      .map(m => ({ role: m.role, content: m.content || "" }))
      .filter(m => m.content.trim() !== "");

    const systemMessage = {
      role: "system",
      content: `Você é a Donna, assistente pessoal do usuário.
- Use o nome do usuário quando souber.
- Responda de forma objetiva, clara, direta e amigável.
- Priorize respostas curtas e práticas.
- Responda de forma **curta, clara e direta** (máx. 2 a 3 frases).
- Se precisar listar opções, limite a no máximo 3 itens.
- Nunca escreva parágrafos longos.
- Adapte o tom para ser acolhedora e prestativa.
- Se a pergunta for sobre horário, data, clima ou lembretes, responda de forma precisa.
- Não invente informações; se não souber, admita de forma educada.`
    };

    // ===== Verifica se há resposta treinada =====
    let reply = await obterResposta(promptBody);

    if (!reply) {
      // ===== Buscar trechos do PDF =====
      const pdfTrechos = await buscarPergunta(promptBody);
      const promptFinal = pdfTrechos
        ? `${promptBody}\n\nBaseado nestes trechos de PDF:\n${pdfTrechos}`
        : promptBody;

      // Se não tem resposta treinada, usa GPT
      reply = await askGPT(promptFinal, [systemMessage, ...chatHistory]);
      await treinarDonna(promptBody, reply);
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

app.listen(PORT, () => console.log(`✅ Donna rodando na porta ${PORT}`));

export { askGPT };

