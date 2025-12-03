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
import { downloadMedia } from './utils/downloadMedia.js";
import cron from "node-cron";
import { numerosAutorizados } from "./config/autorizados.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import FormData from "form-data";
import { falar, sendAudio } from "./utils/speak.js";
import { setPapeis, clearPapeis } from "./utils/treinoDonna.js";
import { buscarPergunta } from "./utils/buscarPdf.js";
import multer from "multer";
import { funcoesExtras } from "./utils/funcoesExtras.js";
import { extractAutoMemoryGPT } from "./utils/autoMemoryGPT.js";
import { querySemanticMemory } from "./models/semanticMemory.js";
import MemoriaEstruturada from "./models/memory.js";

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

let papelAtual = null;
let papeisCombinados = [];

// ===== Verificação de papel =====
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
      papelAtual = "Multiplos";
      papeisCombinados = validos;
      setPapeis(validos);
      return { tipo: "papel", resposta: `Beleza! Vou atuar como ${validos.join(" + ")}. Qual sua dúvida?` };
    }
    return { tipo: "erro", resposta: "Não reconheci esses papéis — verifique a grafia ou escolha outros." };
  }

  return null;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use('/audio', express.static(path.join(__dirname, 'public/audio')));

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

const openai = new OpenAI({ apiKey: OPENAI_KEY });

// ===== Conexão com MongoDB =====
let db;

async function connectDB() {
  try {
    console.log("🔹 Tentando conectar ao MongoDB...");
    const client = await MongoClient.connect(MONGO_URI, { useUnifiedTopology: true });
    db = client.db("donna");
    console.log("✅ Conectado ao MongoDB");
    startReminderCron(db, sendMessage);
  } catch (err) {
    console.error("❌ Erro ao conectar MongoDB:", err.message);
    process.exit(1);
  }
}

await connectDB();
export { db };

// ===== Salvar memória do chat (AGORA SALVA 1x SÓ) =====
let chatCache = new Set();
async function saveChatMemory(userId, role, content) {
  if (!content || !content.toString().trim()) return;
  const key = userId + content;
  if (chatCache.has(key)) return;
  chatCache.add(key);

  try {
    await db.collection("chatMemory").insertOne({
      userId,
      role,
      content: content.toString(),
      createdAt: new Date()
    });
    console.log("💾 Chat salvo na chatMemory.");
  } catch (err) {
    console.error("❌ Erro salvar chat:", err.message);
  }
}

// ===== Recuperar memória do usuário =====
async function getChatMemory(userId, limit = 10) {
  try {
    return await db.collection("chatMemory")
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
  } catch {
    return [];
  }
}

// ✅ FUNÇÃO ACRESCENTADA SEM ALTERAR O RESTO DO CÓDIGO
async function buscarMemoria(userId) {
  const items = await getChatMemory(userId, 20);
  if (!items.length) return null;
  return items.map(m => ({
    role: m.role,
    content: m.content,
    createdAt: m.createdAt
  }));
}

// 📌 Endpoint de memória mantido
app.get("/memoria/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const memories = await db.collection("chatMemory")
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray();

    res.json(memories.map(m => m.content));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ===== Função askGPT corrigida =====
async function askGPT(prompt, history = []) {
  try {
    const safeMessages = history
      .map(m => ({ role: m.role, content: typeof m.content === "string" ? m.content : "" }))
      .filter(m => m.content.trim() !== "");

    const sanitizedMessages = safeMessages.map(m => ({
      role: m.role,
      content: m.content.toString().trim()
    }));

    const contextoHorario = `Agora no Brasil são: ${DateTime.now().setZone("America/Sao_Paulo").toLocaleString(DateTime.DATETIME_MED)}`;
    sanitizedMessages.unshift({ role: "system", content: contextoHorario });
    sanitizedMessages.push({ role: "user", content: prompt || "" });

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      { model: "gpt-5-mini", messages: sanitizedMessages },
      { headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" } }
    );

    return response.data.choices?.[0]?.message?.content || "Hmm… ainda estou pensando!";
  } catch (err) {
    console.error("❌ Erro GPT:", err.response?.data || err);
    return "Hmm… ainda estou pensando!";
  }
}

// ===== Função de envio WhatsApp mantida =====
async function sendMessage(to, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        text: { body: text }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );
    console.log("📤 Mensagem enviada para WhatsApp.");
  } catch (err) {
    console.error("❌ Erro enviar WhatsApp:", err.response?.data || err.message);
  }
}

// ===== Webhook principal com busca e leitura de memória =====
app.post("/webhook", async (req, res) => {
  try {
    const messageObj = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!messageObj) return res.sendStatus(200);

    const from = messageObj.from;
    let body = "";

    // 1. Capturar texto
    if (messageObj.type === "text") {
      body = messageObj.text?.body || "";
    }

    // 2. Capturar áudio antes dos gatilhos
    if (messageObj.type === "audio") {
      const audioBuffer = await downloadMedia(messageObj.audio?.id);
      if (audioBuffer) body = "audio: recebido";
    }

    // 3. Gatilho para buscar memória (1x só)
    if (
      body.toLowerCase().includes("memoria") ||
      body.toLowerCase().includes("o que voce lembra") ||
      body.toLowerCase().includes("me diga o que tem salvo") ||
      body.toLowerCase().includes("busque sua memoria")
    ) {
      const items = await getChatMemory(from, 30);
      if (!items.length) {
        await sendMessage(from, "Ainda não tenho nenhuma memória salva 🧠");
      } else {
        const resposta = items.map(i => `• ${i.content}`).join("\n");
        await sendMessage(from, `Memórias salvas:\n\n${resposta}`);
      }
      return res.sendStatus(200);
    }

    // 4. Gatilho para buscar nome salvo
    if (body.toLowerCase().includes("qual é meu nome")) {
      const items = await getChatMemory(from, 20);
      const nomeItem = items.find(m => m.content.toLowerCase().startsWith("nome:") || m.content.toLowerCase().includes("nome:"));
      const nome = nomeItem?.content.replace(/.*nome:/i, "").trim();
      await sendMessage(from, nome ? `Seu nome salvo é: ${nome} 😊` : "Você ainda não tem nome salvo.");
      return res.sendStatus(200);
    }

    // 5. Salvar nome se o usuário disser
    if (
      body.toLowerCase().includes("meu nome é") ||
      body.toLowerCase().includes("eu sou o") ||
      body.toLowerCase().includes("sou o")
    ) {
      const nome = body.replace(/(meu nome é|eu sou o|sou o)/i, "").trim();
      await saveChatMemory(from, "profile", `nome: ${nome}`);
      await sendMessage(from, `Prontinho! Vou lembrar de você como ${nome} ✨`);
      return res.sendStatus(200);
    }

    // 6. Salvar preferências se ele disser
    if (body.toLowerCase().includes("me chama de") || body.toLowerCase().includes("pode me chamar de")) {
      const apelido = body.replace(/(me chama de|pode me chamar de)/i, "").trim();
      await saveChatMemory(from, "preferences", `apelido: ${apelido}`);
      await sendMessage(from, `Beleza! Vou usar ${apelido} pra falar com você 😎`);
      return res.sendStatus(200);
    }

    // 7. Guardar ideias
    if (body.toLowerCase().includes("ideia:") || body.toLowerCase().includes("anote isso") || body.toLowerCase().includes("guarda essa")) {
      const nota = body.replace(/(ideia:|anote isso|guarda essa)/i, "").trim();
      await saveChatMemory(from, "notes", `anotacao: ${nota}`);
      await sendMessage(from, `Salvei sua ideia 💡`);
      return res.sendStatus(200);
    }

    // 8. Guardar regras do seu RH
    if (body.toLowerCase().includes("no meu trabalho") || body.toLowerCase().includes("cartoes devem estar disponiveis")) {
      await saveChatMemory(from, "work_rules", `regra: ${body}`);
      await sendMessage(from, "Regra do seu trabalho salva ✔️");
      return res.sendStatus(200);
    }

    // 9. Finalmente, salvar o chat e interagir com GPT
    await saveChatMemory(from, "user", body);

    const memories = await getChatMemory(from, 10);
    const historyMessages = memories
      .reverse()
      .map(m => ({ role: "assistant", content: m.content }));

    let reply = await askGPT(body, historyMessages);

    await saveChatMemory(from, "assistant", reply);
    await sendMessage(from, reply);

    return res.sendStatus(200);
  } catch (err) {
    console.error("❌ Webhook erro:", err.message);
    return res.sendStatus(500);
  }
});

app.listen(PORT, () => console.log(✅ Donna rodando na porta ${PORT})); 
export { askGPT, saveChatMemory };
