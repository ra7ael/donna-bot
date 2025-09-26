// src/server.js
import express from 'express';
import OpenAI from "openai";
import { MongoClient } from 'mongodb';
import bodyParser from 'body-parser';
import axios from 'axios';
import dotenv from 'dotenv';
import FormData from 'form-data';
import mongoose from "mongoose";
import { DateTime } from 'luxon';
import { startReminderCron } from "./cron/reminders.js";
import { getWeather } from "./utils/weather.js";
import speak from "./utils/speak.js"; // TTS opcional
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
let db;

// ===== Conectar MongoDB =====
async function connectDB() {
  try {
    const client = await MongoClient.connect(MONGO_URI, { useUnifiedTopology: true });
    db = client.db();
    console.log('✅ Conectado ao MongoDB (histórico, usuários, agenda)');
  } catch (err) {
    console.error('❌ Erro ao conectar ao MongoDB:', err);
  }
}
connectDB();

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

// ===== WhatsApp =====
async function sendMessage(to, message) {
  if (!message) return;
  try {
    let textBody;

    if (typeof message === "string") {
      textBody = message;
    } else if (typeof message === "object") {
      if (message.resposta && typeof message.resposta === "string") {
        textBody = message.resposta;
      } else {
        textBody = "❌ Ocorreu um erro ao processar sua solicitação. Tente novamente.";
      }
    } else {
      textBody = String(message);
    }

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
    date,
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
    if (!promptBody) return res.sendStatus(200);

   // ===== FLUXO EMPRESA =====
if (promptBody.toUpperCase() === "EMPRESA") {
  const userDoc = await db.collection("users").findOne({ numero: from });
  if (userDoc?.nome) {
    userStates[from] = { step: "PEDIR_EMPRESA", nome: userDoc.nome };
    await sendMessage(from, "Digite o NOME da empresa em que você trabalha:");
  } else {
    userStates[from] = { step: "PEDIR_NOME" };
    await sendMessage(from, "Por favor, digite seu NOME completo:");
  }
  return res.sendStatus(200);
}

const state = userStates[from] || {};

if (state.step === "PEDIR_NOME") {
  userStates[from].nome = promptBody;
  userStates[from].step = "PEDIR_EMPRESA";
  await setUserName(from, promptBody);
  await sendMessage(from, "Agora digite o NOME da empresa em que você trabalha:");
  return res.sendStatus(200);
}

if (state.step === "PEDIR_EMPRESA") {
  const empresaInput = promptBody.toUpperCase();
  const empresasEncontradas = empresas.filter(e =>
    e.nome.toUpperCase().includes(empresaInput)
  );

  if (empresasEncontradas.length === 0) {
    await sendMessage(from, "❌ Empresa não encontrada. Digite exatamente o nome da empresa ou confira a grafia.");
    return res.sendStatus(200);
  }

  if (empresasEncontradas.length === 1) {
    // Só uma empresa achada → segue normal
    const empresa = empresasEncontradas[0];
    userStates[from].empresa = empresa.nome;
    userStates[from].step = null;

    const { nome } = userStates[from];
    const { data_de_pagamento, data_adiantamento, fechamento_do_ponto, metodo_ponto } = empresa;

    await sendMessage(from,
      `✅ Cadastro recebido!\nNome: ${nome}\nEmpresa: ${empresa.nome}\n\nInformações da empresa:\n- Data de pagamento: ${data_de_pagamento || "Não informado"}\n- Data de adiantamento: ${data_adiantamento || "Não informado"}\n- Fechamento do ponto: ${fechamento_do_ponto}\n- Método de ponto: ${metodo_ponto}`
    );
    return res.sendStatus(200);
  }

  // Mais de uma empresa encontrada → lista opções
  userStates[from].empresasOpcoes = empresasEncontradas;
  userStates[from].step = "ESCOLHER_EMPRESA";

  const lista = empresasEncontradas.map((e, i) => `${i + 1}. ${e.nome}`).join("\n");
  await sendMessage(from,
    `🔎 Encontramos mais de uma empresa com esse nome:\n\n${lista}\n\nDigite apenas o número correspondente à sua empresa.`
  );
  return res.sendStatus(200);
}

if (state.step === "ESCOLHER_EMPRESA") {
  const escolha = parseInt(promptBody, 10);
  const opcoes = state.empresasOpcoes || [];

  if (!escolha || escolha < 1 || escolha > opcoes.length) {
    await sendMessage(from, "❌ Opção inválida. Digite apenas o número da empresa listado.");
    return res.sendStatus(200);
  }

  const empresaEscolhida = opcoes[escolha - 1];
  userStates[from].empresa = empresaEscolhida.nome;
  userStates[from].step = null;

  const { nome } = userStates[from];
  const { data_de_pagamento, data_adiantamento, fechamento_do_ponto, metodo_ponto } = empresaEscolhida;

  await sendMessage(from,
    `✅ Cadastro confirmado!\nNome: ${nome}\nEmpresa: ${empresaEscolhida.nome}\n\nInformações da empresa:\n- Data de pagamento: ${data_de_pagamento || "Não informado"}\n- Data de adiantamento: ${data_adiantamento || "Não informado"}\n- Fechamento do ponto: ${fechamento_do_ponto}\n- Método de ponto: ${metodo_ponto}`
  );
  return res.sendStatus(200);
}

    // 🔒 NÃO AUTORIZADO → apenas FAQ
    if (!numerosAutorizados.includes(from)) {
      const normalizedMsg = promptBody.trim().toLowerCase();

      if (["oi", "olá", "ola", "bom dia", "boa tarde", "boa noite", "menu"].includes(normalizedMsg)) {
        const menuMsg = `Olá! 👋 Seja bem-vindo(a) a Sé Recursos Humanos.  
Para facilitar seu atendimento, digite a PALAVRA-CHAVE do assunto que deseja falar:

🏢 EMPRESA – (em breve descrição)  
🏦 BANCO – Cadastro ou alteração de dados bancários  
💸 PAGAMENTO – Salário, datas ou descontos  
🎁 BENEFICIOS – VT, VR e outros  
🕓 FOLHA PONTO – Dúvidas sobre marcação e correções  
📄 HOLERITE – Acesso ao contracheque  

❗ Digite a palavra exata (ex: HOLERITE) e te enviaremos a instrução automaticamente.`;

        await sendMessage(from, menuMsg);

        const userHistory = await db.collection("historico").find({ numero: from }).limit(1).toArray();
        if (userHistory.length === 0) {
          await db.collection("historico").insertOne({
            numero: from,
            primeiraMensagem: promptBody,
            data: new Date()
          });
        }

        return res.sendStatus(200);
      }

      let faqReply = await responderFAQ(promptBody, await getUserName(from));

      if (faqReply && typeof faqReply !== "string") {
        if (faqReply.texto) faqReply = faqReply.texto;
        else faqReply = JSON.stringify(faqReply);
      }

      const respostaFinal = faqReply || "❓ Só consigo responder perguntas do FAQ (benefícios, férias, folha, horário, endereço, contato).";
      await sendMessage(from, respostaFinal);
      return res.sendStatus(200);
    }

    // 🔓 AUTORIZADO → fluxo GPT
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
      content: `
        Você é a Donna, assistente pessoal do usuário. 
        - Use o nome do usuário quando souber. 
        - Responda de forma objetiva, clara, direta e amigável. 
        - Priorize respostas curtas e práticas. 
        - Se a pergunta for sobre horário, data, clima ou lembretes, responda de forma precisa. 
        - Não invente informações; se não souber, admita de forma educada. 
        - Adapte seu tom para ser acolhedora e prestativa.
      `
    };

    let reply;
    const now = DateTime.now().setZone("America/Sao_Paulo");

    if (/que horas são\??/i.test(promptBody)) {
      reply = `🕒 Agora são ${now.toFormat("HH:mm")}`;
    } else if (/qual a data( de hoje)?\??/i.test(promptBody)) {
      const weekday = now.toFormat("cccc");
      reply = `📅 Hoje é ${weekday}, ${now.toFormat("dd/MM/yyyy")}`;
    } else if (/tempo|clima|previsão/i.test(promptBody)) {
      const matchCity = promptBody.match(/em\s+([a-z\s]+)/i);
      const city = matchCity ? matchCity[1].trim() : "Curitiba";
      reply = await getWeather(city, "hoje");
    } else if (/lembrete|evento|agenda/i.test(promptBody)) {
      const match = promptBody.match(/lembrete de (.+) às (\d{1,2}:\d{2})/i);
      if (match) {
        const title = match[1];
        const time = match[2];
        const date = DateTime.now().toFormat("yyyy-MM-dd");
        await addEvent(from, title, title, date, time);
        reply = `✅ Lembrete "${title}" criado para hoje às ${time}`;
      } else if (/mostrar agenda|meus lembretes/i.test(promptBody)) {
        const events = await getTodayEvents(from);
        reply = events.length === 0
          ? "📭 Você não tem nenhum evento para hoje."
          : "📅 Seus eventos de hoje:\n" + events.map(e => `- ${e.hora}: ${e.titulo}`).join("\n");
      }
    } else {
      const personalizedPrompt = userName ? `O usuário se chama ${userName}. ${promptBody}` : promptBody;
      reply = await askGPT(personalizedPrompt, [systemMessage, ...chatHistory]);
    }

    await db.collection("historico").insertOne({
      numero: from,
      mensagem: promptBody,
      resposta: reply,
      timestamp: new Date()
    });
    await saveMemory(from, "user", promptBody);
    await saveMemory(from, "assistant", reply);

    if (isAudioResponse) {
      const audioData = await speak(reply);
      if (audioData) await sendAudio(from, audioData);
    } else {
      await sendMessage(from, reply);
    }

  } catch (err) {
    console.error("❌ Erro ao processar webhook:", err);
    return res.sendStatus(500);
  }

  res.sendStatus(200);
});

// ===== Cron job =====
cron.schedule("* * * * *", async () => {
  const now = DateTime.now().setZone("America/Sao_Paulo").toFormat("HH:mm");
  const today = DateTime.now().toFormat("yyyy-MM-dd");

  const events = await db.collection("donna").find({ data: today, hora: now }).toArray();
  for (const ev of events) {
    await sendMessage(ev.numero, `⏰ Lembrete: ${ev.titulo}`);
  }
});

// ===== Start =====
(async () => {
  try {
    await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log("✅ Conectado ao MongoDB (reminders)");

    startReminderCron();

    app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
  } catch (err) {
    console.error("❌ Erro ao conectar ao MongoDB:", err);
  }
})();

export { askGPT };
