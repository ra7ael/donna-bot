/// src/server.js
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
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
import FormData from "form-data";
import { falar, sendAudio } from "./utils/speak.js";
import { setPapeis, clearPapeis } from "./utils/treinoDonna.js";
import { buscarPergunta } from "./utils/buscarPdf.js";
import multer from "multer";
import { funcoesExtras } from "./utils/funcoesExtras.js";
import {  salvarMemoria, consultarFatos,  buscarMemoria, limparMemoria, getDB} from "./utils/memory.js";
import { initRoutineFamily, handleCommand, handleReminder } from "./utils/routineFamily.js";
import { gerarArquivoSenior } from "./utils/generateSeniorTXT.js";
import { enviarDocumentoWhatsApp } from "./utils/enviarDocumentoDonna.js";
import { buscarEmpresa, adicionarEmpresa, atualizarCampo, formatarEmpresa } from "./utils/handleEmpresa.js";
import { searchBook } from "./utils/searchBook.js";
import { normalizeMessage, shouldIgnoreMessage } from "./utils/messageHelper.js";

mongoose.set("bufferTimeoutMS", 90000);
dotenv.config();

const app = express();

// ================== MEMÓRIA CONSCIENTE ==================

async function salvarFato(from, texto) {
  await salvarMemoria(from, {
    tipo: "fato",
    content: texto,
    createdAt: new Date()
  });
}

// =========================
// 🔁 MEMÓRIA ANTI-ECO (GLOBAL)
// =========================
const mensagensProcessadas = new Set();

app.use(bodyParser.json());

const uploadMulter = multer({ dest: "uploads/" });

let cronStarted = false;
let lastMessageSentByUser = {};

async function sendMessageIfNeeded(to, text) {
  if (!text || !to) return false;
  if (lastMessageSentByUser[to] === text) return false;
  await sendMessage(to, text);
  lastMessageSentByUser[to] = text;
  return true;
}

// ===== Papéis Profissionais =====
const profissoes = [
  "Enfermeira Obstetra","Médica", "Nutricionista", "Personal Trainer", "Psicóloga", 
  "Coach de Produtividade", "Consultora de RH", "Advogada", "Contadora", "Engenheira Civil", 
  "Arquiteta", "Designer Gráfica", "Professora de Inglês", "Professora de Matemática", "Professora de História", 
  "Cientista de Dados", "Desenvolvedora Full Stack", "Especialista em IA", "Marketing Manager", 
  "Copywriter", "Redatora Publicitária", "Social Media", "Especialista em SEO", "Especialista em E-commerce", 
  "Consultora Financeira", "Analista de Investimentos", "Corretora de Imóveis", "Jornalista", "Editora de Vídeo", 
  "Fotógrafa", "Música", "Chef de Cozinha", "Sommelier", "Designer de Moda", "Estilista", "Terapeuta Holística", 
  "Consultora de Carreira", "Recrutadora", "Especialista em Treinamento Corporativo", "Mentora de Startups", 
  "Engenheira de Software", "Administradora de Sistemas", "Especialista em Redes", "Advogada Trabalhista", 
  "Advogada Civil", "Psicopedagoga", "Fisioterapeuta", "Enfermeira", "Pediatra", "Oftalmologista", "Dentista", 
  "Barista", "Coach de Inteligência Emocional"
];

let papelAtual = null;
let papeisCombinados = [];

function verificarComandoProfissao(texto) {
  const textoLower = (texto || "").toLowerCase();
  if (textoLower.includes("sair do papel") || textoLower.includes("volte a ser assistente") || textoLower.includes("saia do papel")) {
    papelAtual = null;
    papeisCombinados = [];
    clearPapeis();
    return { tipo: "saida", resposta: "Ok! 😊 Voltei a ser sua assistente pessoal." };
  }
  for (const p of profissoes) {
    const pLower = p.toLowerCase();
    if (textoLower.includes(`você é ${pLower}`) || textoLower.includes(`seja meu ${pLower}`) || textoLower.includes(`ajude-me como ${pLower}`) || textoLower === pLower) {
      papelAtual = p;
      papeisCombinados = [p];
      setPapeis([p]);
      return { tipo: "papel", resposta: `Perfeito! Agora estou no papel de ${p}. O que deseja?` };
    }
  }
  const combinarMatch = textoLower.match(/(misture|combine|junte) (.+)/i);
  if (combinarMatch) {
    const solicitados = combinarMatch[2].split(/,| e /).map(s => s.trim());
    const validos = solicitados.filter(s => profissoes.map(p => p.toLowerCase()).includes(s.toLowerCase()));
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
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

let db;
async function connectDB() {
  let tentativas = 5;
  while (tentativas > 0) {
    try {
      console.log("🔹 Tentando conectar ao MongoDB...");
      const client = await MongoClient.connect(MONGO_URI, { useUnifiedTopology: true, serverSelectionTimeoutMS: 60000, socketTimeoutMS: 90000 });
      db = client.db("donna");
      console.log("✅ Conectado ao MongoDB ✅");
      await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 60000, connectTimeoutMS: 60000, socketTimeoutMS: 90000, maxPoolSize: 10 });
      console.log("✅ Mongoose conectado com sucesso ✅");

      if (!cronStarted) {
        startReminderCron(db, sendMessageIfNeeded);
        cronStarted = true;
        console.log("⏰ Cron iniciado APENAS UMA VEZ (via sendMessageIfNeeded)");
      } else {
        console.log("⚠️ Cron já estava rodando, não iniciado novamente.");
      }
      break;
    } catch (err) {
      tentativas--;
      console.error(`❌ Falha ao conectar. Tentativas restantes: ${tentativas}`);
      console.error(err.message);
      if (tentativas === 0) process.exit(1);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}
await connectDB();
export { db };

await initRoutineFamily(db, sendMessage);

app.post("/webhook", async (req, res) => {
  try {
    const messageObj = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const from = messageObj?.from || null;

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

    if (!["text", "document"].includes(type) || (type === "text" && /^\d+$/.test(body.trim()))) {
      res.sendStatus(200);
      return;
    }

    const messageId = messageObj.id;
    if (mensagensProcessadas.has(messageId)) {
      res.sendStatus(200);
      return;
    }
    mensagensProcessadas.add(messageId);
    setTimeout(() => mensagensProcessadas.delete(messageId), 5 * 60 * 1000);

    // 💾 SALVAR MEMÓRIA CONSCIENTE
    if (textoLower.startsWith("lembre que")) {
      const fato = body.replace(/lembre que/i, "").trim();
      await salvarFato(from, fato);
      await sendMessage(from, "📌 Ok. Isso ficou guardado.");
      res.sendStatus(200);
      return;
    }

    if (textoLower.includes("o que você lembra")) {
      const fatos = await consultarFatos(from);
      await sendMessage(
        from,
        fatos.length ? fatos.join("\n") : "Ainda não tenho nada salvo."
      );
      res.sendStatus(200);
      return;
    }

    // ✅ ÚNICO DONO DA MEMÓRIA (apenas comando consciente)
    // restante do webhook (PDF, empresas, senior, comandos, clima, IA) continua igual
    // substitua semantic memory por askGPT(body) direto

    let respostaFinal = await askGPT(body);
    await sendMessage(from, respostaFinal);
    res.sendStatus(200);

  } catch (err) {
    console.error("❌ Webhook erro:", err.message);
    res.sendStatus(500);
  }
});

// ========================= FUNÇÕES AUXILIARES =========================

async function sendMessage(to, text) {
  try {
    const partes = dividirMensagem(text);
    for (let parte of partes) {
      await axios.post(
        `https://graph.facebook.com/v24.0/${WHATSAPP_PHONE_ID}/messages`,
        { messaging_product: "whatsapp", to, text: { body: parte } },
        { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" }, timeout: 30000 }
      );
    }
  } catch (err) {
    console.error("❌ Erro enviar WhatsApp:", err.message);
  }
}

function dividirMensagem(texto, limite = 300) {
  const partes = [];
  let inicio = 0;
  while (inicio < texto.length) {
    let fim = inicio + limite;
    if (fim < texto.length) {
      fim = texto.lastIndexOf(' ', fim);
      if (fim === -1) fim = inicio + limite;
    }
    partes.push(texto.slice(inicio, fim).trim());
    inicio = fim + 1;
  }
  return partes;
}

async function askGPT(prompt) {
  try {
    const contextoDonna = "Você é Amber, sua personalidade é baseada na icônica Donna Paulsen de Suits. Responda com autoridade, direta e elegante, no máximo 2 frases.";
    const contextoHorario = `Agora no Brasil são: ${DateTime.now().setZone("America/Sao_Paulo").toLocaleString(DateTime.DATETIME_MED)}`;

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-5-mini",
        messages: [
          { role: "system", content: contextoHorario },
          { role: "system", content: contextoDonna },
          { role: "user", content: prompt || "" }
        ]
      },
      { headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" }, timeout: 30000 }
    );

    return response.data.choices?.[0]?.message?.content || "Hmm… ainda estou pensando!";
  } catch (err) {
    console.error("❌ Erro GPT:", JSON.stringify(err.message));
    return "Hmm… ainda estou pensando!";
  }
}

app.listen(PORT, () => console.log(`✅ Donna rodando na porta ${PORT}`));

global.apiExports = {
  askGPT,
  salvarMemoria,
  enviarDocumentoWhatsApp
};

app.post("/webhook", async (req, res) => {
  try {
    const messageObj = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const from = messageObj?.from || null;

    if (!messageObj) {
      res.sendStatus(200);
      return;
    }

    // 🚪 PORTEIRO
    if (shouldIgnoreMessage(messageObj, from)) {
      res.sendStatus(200);
      return;
    }

    // 🧠 TRADUTOR
    const normalized = normalizeMessage(messageObj);
    if (!normalized) {
      res.sendStatus(200);
      return;
    }

    const { body, bodyLower: textoLower, type } = normalized;

// 🧠 MEMÓRIA CONSCIENTE
const fatos = await consultarFatos(from);

let contextoMemoria = "";

if (fatos.length) {
  contextoMemoria =
    "FATOS QUE VOCÊ SABE SOBRE O USUÁRIO:\n" +
    fatos.map(f => `- ${f}`).join("\n") +
    "\n\n";
}
    
    // 🚫 FILTRO DE TIPO
    if (!["text", "document"].includes(type)) {
      console.log("⛔ Tipo ignorado:", type);
      res.sendStatus(200);
      return;
    }

    if (type === "text" && /^\d+$/.test(body.trim())) {
      console.log("⛔ Texto numérico ignorado:", body);
      res.sendStatus(200);
      return;
    }

    // 🔁 ANTI-ECO REAL
    const messageId = messageObj.id;
    if (mensagensProcessadas.has(messageId)) {
      console.log("🔁 Mensagem duplicada ignorada:", messageId);
      res.sendStatus(200);
      return;
    }

    mensagensProcessadas.add(messageId);
    setTimeout(() => mensagensProcessadas.delete(messageId), 5 * 60 * 1000);

    console.log("📩 Mensagem recebida:", { body, type });

    // ✅ ÚNICO DONO DA MEMÓRIA (CORREÇÃO PRINCIPAL)
    await processarMemoria({ from, texto: body });

    /* ========================= PDF / LIVROS ========================= */

    async function checkPDFProcessed(pdfId) {
      try {
        const result = await ProcessedPDFs.findOne({ pdfId });
        return result !== null;
      } catch (error) {
        console.error("Erro ao verificar se o PDF foi processado:", error);
        return false;
      }
    }

    function dividirTextoEmTrechos(texto, tamanhoMax = 1000) {
      const palavras = texto.split(/\s+/);
      const trechos = [];
      for (let i = 0; i < palavras.length; i += tamanhoMax) {
        trechos.push(palavras.slice(i, i + tamanhoMax).join(" "));
      }
      return trechos;
    }

    if (messageObj.type === "document") {
      const pdfId = messageObj.document?.id;
      const nomeArquivo = messageObj.document?.filename || "livro_sem_nome";

      if (await checkPDFProcessed(pdfId)) {
        await sendMessage(from, "⚠ Esse PDF já foi processado anteriormente.");
        res.sendStatus(200);
        return;
      }

      const mediaBuffer = await downloadMedia(pdfId);
      if (!mediaBuffer) {
        await sendMessage(from, "⚠ Não consegui baixar o PDF.");
        res.sendStatus(200);
        return;
      }

      let textoExtraido = "";

      try {
        const pdfData = await pdfParse(Buffer.from(mediaBuffer, "base64"));
        textoExtraido = pdfData.text || "";

        if (!textoExtraido || textoExtraido.trim().length < 200) {
          await sendMessage(from, "🕵️ PDF parece imagem, ativando OCR...");

          const pdfjsLib = require("pdfjs-dist");
          const { createWorker } = require("tesseract.js");

          const pdf = await pdfjsLib.getDocument({ data: mediaBuffer }).promise;
          const worker = await createWorker();
          await worker.load();
          await worker.loadLanguage("eng+por");
          await worker.initialize("eng+por");

          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 2.0 });
            const canvasFactory = new pdfjsLib.NodeCanvasFactory();
            const { canvas, context } = canvasFactory.create(
              viewport.width,
              viewport.height
            );

            await page.render({ canvasContext: context, viewport }).promise;
            const { data: text } = await worker.recognize(canvas);
            textoExtraido += text + "\n";
          }

          await worker.terminate();
        }

        await saveBookContent(textoExtraido, "pdf", from, pdfId, nomeArquivo);

        for (const trecho of dividirTextoEmTrechos(textoExtraido)) {
          const embeddingRes = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: trecho
          });

          await saveEmbeddingToDB(from, trecho, embeddingRes.data[0].embedding, pdfId);
        }

        await sendMessage(from, "✅ PDF processado com sucesso.");
        res.sendStatus(200);
        return;

      } catch (err) {
        console.error("❌ Erro PDF:", err);
        await sendMessage(from, "❌ Erro ao processar o PDF.");
        res.sendStatus(200);
        return;
      }
    }

    /* ========================= EMPRESAS ========================= */

    if (textoLower.startsWith("empresa buscar")) {
      const lista = buscarEmpresa(body.replace(/empresa buscar/i, "").trim());
      await sendMessage(from, lista.length ? lista.map(formatarEmpresa).join("\n\n") : "Nenhuma empresa encontrada.");
      res.sendStatus(200);
      return;
    }

    if (textoLower.startsWith("empresa adicionar")) {
      const p = body.replace(/empresa adicionar/i, "").trim().split(";");
      adicionarEmpresa({
        codigo: p[0] || "",
        empresa: p[1] || "",
        beneficios: p[2] || "",
        vt: p[3] || "",
        vr: p[4] || "",
        va: p[5] || "",
        observacao: p[6] || "",
      });
      await sendMessage(from, "Empresa adicionada com sucesso.");
      res.sendStatus(200);
      return;
    }

    if (textoLower.startsWith("empresa atualizar")) {
      const partes = body.split(" ");
      const ok = atualizarCampo(partes[2], partes[3]?.toUpperCase(), partes.slice(4).join(" "));
      await sendMessage(from, ok ? "Atualizado com sucesso." : "Erro ao atualizar.");
      res.sendStatus(200);
      return;
    }

    /* ========================= SENIOR ========================= */

    if (textoLower.startsWith("gerar senior")) {
      try {
        const dados = {};
        body.replace(/gerar senior/i, "").trim().split(" ").forEach(p => {
          const [k, v] = p.split("=");
          if (k && v) dados[k] = v;
        });

        if (!dados.nome || !dados.cpf || !dados.cargo) {
          await sendMessage(from, "Formato inválido.");
          res.sendStatus(200);
          return;
        }

        const dirPath = path.join(process.cwd(), "generated");
        if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });

        const filePath = path.join(dirPath, `senior_${dados.cpf}.txt`);
        fs.writeFileSync(filePath, Object.values(dados).join("|"), "utf-8");

        const { enviarDocumentoWhatsApp } = await import("./utils/enviarDocumentoDonna.js");
        await enviarDocumentoWhatsApp(from, filePath, "Arquivo Senior gerado.");
        res.sendStatus(200);
        return;

      } catch (err) {
        console.error(err);
        await sendMessage(from, "Erro ao gerar Senior.");
        res.sendStatus(200);
        return;
      }
    }

    /* ========================= COMANDOS / LEMBRETES ========================= */

    if (await handleCommand(body, from) || await handleReminder(body, from)) {
      res.sendStatus(200);
      return;
    }

    /* ========================= CLIMA ========================= */

    if (textoLower.includes("clima") || textoLower.includes("tempo")) {
      await sendMessage(from, await getWeather("Curitiba", "hoje"));
      res.sendStatus(200);
      return;
    }

    /* ========================= IA ========================= */

    // 🧠 Memória consciente (fatos explícitos)
const fatos = await consultarFatos(from);

let contextoMemoria = "";
if (fatos.length) {
  contextoMemoria =
    "FATOS QUE VOCÊ SABE SOBRE O USUÁRIO:\n" +
    fatos.map(f => `- ${f}`).join("\n") +
    "\n\n";
}

// 🧠 Memória semântica (similaridade)
const semanticResults = await querySemanticMemory(body, from, 3);

// 🎯 Prompt final unificado
const promptFinal = semanticResults?.length
  ? `${contextoMemoria}Pergunta do usuário: ${body}\n\nContexto relevante:\n${semanticResults.join("\n")}`
  : `${contextoMemoria}Pergunta do usuário: ${body}`;

const respostaFinal = await askGPT(promptFinal);

await sendMessage(from, respostaFinal);
res.sendStatus(200);
