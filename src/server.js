// src/server.js
import express from 'express';
import OpenAI from "openai";
import mongoose from "mongoose";
import bodyParser from 'body-parser';
import axios from 'axios';
import dotenv from 'dotenv';
import FormData from 'form-data';
import { DateTime } from 'luxon';
import { startReminderCron } from "./cron/reminders.js";
import { getWeather } from "./utils/weather.js";
import speak from "./utils/speak.js";
import { downloadMedia } from './utils/downloadMedia.js';
import cron from 'node-cron';
import { responderFAQ } from "./utils/faqHandler.js";
import { numerosAutorizados } from "./config/autorizados.js";
import fs from "fs";
import path from "path";

dotenv.config();

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const GPT_API_KEY = process.env.OPENAI_API_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

const openai = new OpenAI({ apiKey: GPT_API_KEY });

// ===== Conectar MongoDB com Mongoose =====
mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log("✅ Conectado ao MongoDB com Mongoose"))
.catch(err => console.error("❌ Erro ao conectar MongoDB:", err));

// ===== Definir Models =====
import { Schema } from 'mongoose';

const userSchema = new Schema({
  numero: String,
  nome: String
});
const User = mongoose.model("User", userSchema);

const memorySchema = new Schema({
  numero: String,
  role: String,
  content: String,
  timestamp: { type: Date, default: Date.now }
});
const SemanticMemory = mongoose.model("SemanticMemory", memorySchema);

const eventSchema = new Schema({
  numero: String,
  titulo: String,
  descricao: String,
  data: String,
  hora: String,
  sent: { type: Boolean, default: false },
  timestamp: { type: Date, default: Date.now }
});
const DonnaEvent = mongoose.model("DonnaEvent", eventSchema);

// Caminho absoluto para garantir que funcione no Render
const empresasPath = path.resolve("./src/data/empresa.json");
const empresas = JSON.parse(fs.readFileSync(empresasPath, "utf8"));

// ===== Armazena estado dos usuários =====
const userStates = {};

// ===== Funções GPT =====
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

// ===== Funções usuários e memória com Mongoose =====
async function getUserName(number) {
  const doc = await User.findOne({ numero: number });
  return doc?.nome || null;
}

async function setUserName(number, name) {
  await User.updateOne({ numero: number }, { nome: name }, { upsert: true });
}

async function getUserMemory(number, limit = 5) {
  return await SemanticMemory.find({ numero: number })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
}

async function saveMemory(number, role, content) {
  if (!content || !content.trim()) return;
  await SemanticMemory.create({ numero: number, role, content });
}

// ===== Funções agenda com Mongoose =====
async function addEvent(number, title, description, date, time) {
  await DonnaEvent.create({
    numero: number,
    titulo: title,
    descricao: description || title,
    data: date,
    hora: time
  });
}

async function getTodayEvents(number) {
  const today = DateTime.now().toFormat("yyyy-MM-dd");
  return await DonnaEvent.find({ numero: number, data: today }).sort({ hora: 1 }).lean();

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

async function sendAudio(to, audioBuffer) {
  if (!audioBuffer) return;
  try {
    const formData = new FormData();
    formData.append("messaging_product", "whatsapp");
    formData.append("to", to);
    formData.append("type", "audio");
    formData.append("audio", audioBuffer, { filename: "audio.mp3" });

    await axios.post(
      `https://graph.facebook.com/v17.0/${WHATSAPP_PHONE_ID}/messages`,
      formData,
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, ...formData.getHeaders() } }
    );
    console.log("📤 Áudio enviado");
  } catch (err) {
    console.error("❌ Erro ao enviar áudio:", err.response?.data || err);
  }
}

// ===== Usuários e memória =====
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
  await db.collection("semanticMemory").insertOne({
    numero: number,
    role,
    content,
    timestamp: new Date()
  });
}

// ===== Transcrição =====
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

// ===== Agenda =====
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

// ===== Webhook =====
app.post("/webhook", async (req, res) => {
  try {
    const messageObj = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!messageObj) return res.sendStatus(200);

    const from = messageObj.from;
    let body = "";
    let isAudioResponse = false;

    if (messageObj.type === "text") {
      body = messageObj.text?.body || "";
      if (body.toLowerCase().startsWith("fala ")) {
        body = body.slice(5).trim();
        isAudioResponse = true;
      }
    } else if (messageObj.type === "audio") {
      const audioBuffer = await downloadMedia(messageObj.audio?.id);
      if (audioBuffer) body = await transcribeAudio(audioBuffer);
      isAudioResponse = false;
    } else {
      await sendMessage(from, "Só consigo responder mensagens de texto ou áudio 😉");
      return res.sendStatus(200);
    }

    const promptBody = (body || "").trim();
    const state = userStates[from] || {};

    // ⚠️ Bloquear entradas inválidas ou letras soltas
    if ((!promptBody || promptBody.length < 2) && state.step !== "ESCOLHER_EMPRESA") {
      await sendMessage(from, "❌ Por favor, digite uma mensagem completa ou uma palavra-chave válida.");
      return res.sendStatus(200);
    }

    // ===== FLUXO PALAVRAS-CHAVE =====
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

    if (state.step === "PEDIR_NOME") {
      userStates[from].nome = promptBody;
      await setUserName(from, promptBody);
      userStates[from].step = "PEDIR_EMPRESA";
      await sendMessage(from, "Agora digite o NOME da empresa em que você trabalha:");
      return res.sendStatus(200);
    }

    // ===== PEDIR EMPRESA =====
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
        const { data_de_pagamento, data_adiantamento, fechamento_do_ponto, metodo_ponto } = empresa;

        switch (key) {
          case "EMPRESA":
            await sendMessage(from,
              `✅ Cadastro recebido!\nNome: ${nome}\nEmpresa: ${empresa.nome}\n\nInformações da empresa:\n- Data de pagamento: ${data_de_pagamento || "Não informado"}\n- Data de adiantamento: ${data_adiantamento || "Não informado"}\n- Fechamento do ponto: ${fechamento_do_ponto}\n- Método de ponto: ${metodo_ponto}`
            );
            break;
          case "BANCO":
            await sendMessage(from,
              `Olá ${nome}, para alterar ou enviar informações bancárias da empresa ${empresa.nome}, envie os dados para o número 41 99833-3283 - Rafael`
            );
            break;
          case "PAGAMENTO":
            await sendMessage(from,
              `💸 Datas de pagamento da empresa ${empresa.nome}:\n- Pagamento: ${data_de_pagamento || "Não informado"}\n- Adiantamento: ${data_adiantamento || "Não informado"}`
            );
            break;
          case "BENEFICIOS":
            await sendMessage(from,
              `🎁 Benefícios da empresa ${empresa.nome}:\n- VT, VR e outros\nEntre em contato com 41 99464-062 Rene para mais informações.`
            );
            break;
          case "FOLHA PONTO":
            await sendMessage(from,
              `🕓 Informações da folha de ponto da empresa ${empresa.nome}:\n- Fechamento do ponto: ${fechamento_do_ponto}\n- Método de ponto: ${metodo_ponto}`
            );
            break;
          case "HOLERITE":
            await sendMessage(from,
              `📄 O holerite da empresa ${empresa.nome} estará disponível na data de pagamento (${data_de_pagamento || "Não informado"}) no aplicativo Wiipo. Basta se cadastrar para conferir.`
            );
            break;
          default:
            await sendMessage(from, `❌ Palavra-chave inválida. Digite uma das opções do menu.`);
        }

        return res.sendStatus(200);
      }

      // Mais de uma empresa encontrada → lista opções
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

    // ===== ESCOLHER EMPRESA =====
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
      const { data_de_pagamento, data_adiantamento, fechamento_do_ponto, metodo_ponto } = empresaEscolhida;

      switch (key) {
        case "EMPRESA":
          await sendMessage(from,
            `✅ Cadastro confirmado!\nNome: ${nome}\nEmpresa: ${empresaEscolhida.nome}\n\nInformações da empresa:\n- Data de pagamento: ${data_de_pagamento || "Não informado"}\n- Data de adiantamento: ${data_adiantamento || "Não informado"}\n- Fechamento do ponto: ${fechamento_do_ponto}\n- Método de ponto: ${metodo_ponto}`
          );
          break;
        case "BANCO":
          await sendMessage(from,
            `Olá ${nome}, para alterar ou enviar informações bancárias da empresa ${empresaEscolhida.nome}, envie os dados para o número 41 99833-3283 - Rafael`
          );
          break;
        case "PAGAMENTO":
          await sendMessage(from,
            `💸 Datas de pagamento da empresa ${empresaEscolhida.nome}:\n- Pagamento: ${data_de_pagamento || "Não informado"}\n- Adiantamento: ${data_adiantamento || "Não informado"}`
          );
          break;
        case "BENEFICIOS":
          await sendMessage(from,
            `🎁 Benefícios da empresa ${empresaEscolhida.nome}:\n- VT, VR e outros\nEntre em contato com 41 99464-062 Rene para mais informações.`
          );
          break;
        case "FOLHA PONTO":
          await sendMessage(from,
            `🕓 Informações da folha de ponto da empresa ${empresaEscolhida.nome}:\n- Fechamento do ponto: ${fechamento_do_ponto}\n- Método de ponto: ${metodo_ponto}`
          );
          break;
        case "HOLERITE":
          await sendMessage(from,
            `📄 O holerite da empresa ${empresaEscolhida.nome} estará disponível na data de pagamento (${data_de_pagamento || "Não informado"}) no aplicativo Wiipo. Basta se cadastrar para conferir.`
          );
          break;
        default:
          await sendMessage(from, `❌ Palavra-chave inválida. Digite uma das opções do menu.`);
      }

      return res.sendStatus(200);
    }

    // ===== Responder FAQ geral =====
    const faqReply = await responderFAQ(promptBody);
    if (faqReply) {
      await sendMessage(from, faqReply);
      return res.sendStatus(200);
    }

    // ===== Mensagem padrão GPT =====
    const memory = await getUserMemory(from, 5);
    const gptResponse = await askGPT(promptBody, memory.map(m => ({ role: m.role, content: m.content })));
    await sendMessage(from, gptResponse);
    await saveMemory(from, "user", promptBody);
    await saveMemory(from, "assistant", gptResponse);

    return res.sendStatus(200);
  } catch (err) {
    console.error("❌ Erro webhook:", err);
    return res.sendStatus(500);
  }
});

// ===== Start cron e servidor =====
startReminderCron(db); // lembretes
app.listen(PORT, () => console.log(`🚀 Server rodando na porta ${PORT}`));
export { askGPT };

