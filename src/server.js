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
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
import FormData from "form-data";
import { falar, sendAudio } from "./utils/speak.js";
import { setPapeis, clearPapeis } from "./utils/treinoDonna.js";
import { buscarPergunta } from "./utils/buscarPdf.js";
import multer from "multer";
import { funcoesExtras } from "./utils/funcoesExtras.js";
import { extractAutoMemoryGPT } from "./utils/autoMemoryGPT.js";
import { addSemanticMemory, querySemanticMemory } from "./models/semanticMemory.js";
import { enqueueSemanticMemory } from './utils/semanticQueue.js';
import { salvarMemoria, buscarMemoria, limparMemoria, getDB } from './utils/memory.js';
import { initRoutineFamily, handleCommand } from "./utils/routineFamily.js";
import { handleReminder } from './utils/routineFamily.js';
import { gerarArquivoSenior } from "./utils/generateSeniorTXT.js";
import { enviarDocumentoWhatsApp } from "./utils/enviarMensagemDonna.js";
import { buscarEmpresa,adicionarEmpresa,atualizarCampo,formatarEmpresa} from "./utils/handleEmpresa.js";
import { searchBook } from "./utils/searchBook.js";


mongoose.set("bufferTimeoutMS", 90000); // ⬆️ aumenta o tempo antes do timeout
dotenv.config();

const app = express();
app.use(bodyParser.json());

const uploadMulter = multer({ dest: "uploads/" });

/* ========================= Controle de cron & dedup ========================= */
let cronStarted = false;
let lastMessageSentByUser = {}; // controla a última mensagem enviada por número (deduplicação por usuário)

/**
 * Usa a função sendMessage existente para enviar, mas previne duplicação por usuário.
 * Mantive o nome sendMessageIfNeeded para compatibilidade com onde vamos passá-la ao cron.
 */
async function sendMessageIfNeeded(to, text) {
  if (!text) return false;
  if (!to) return false;
  if (!lastMessageSentByUser[to]) lastMessageSentByUser[to] = null;
  if (lastMessageSentByUser[to] === text) {
    console.log("💬 Mensagem duplicada para este usuário, pulando:", to);
    return false;
  }
  await sendMessage(to, text);
  lastMessageSentByUser[to] = text;
  return true;
}

/* ========================= Variáveis e helpers gerais ========================= */
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

// ⚡ openai instanciado com a variável correta
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

/* ========================= Conexão com MongoDB (única) ========================= */
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

      // Inicia o cron UMA ÚNICA VEZ usando sendMessageIfNeeded para evitar duplicações por usuário
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
      if (tentativas === 0) {
        console.error("❌ Não foi possível conectar ao banco. Encerrando...");
        process.exit(1);
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}
await connectDB();
export { db };

// Inicializa rotina/family module (usa sendMessage existente)
await initRoutineFamily(db, sendMessage);


/* ========================= Funções de livros e rotas ========================= */
async function saveBookContent(content, format, userId, bookId) {
  // Divide em trechos de 1000 palavras para manter contexto
  const trechos = dividirTextoEmTrechos(content, 1000);

  for (const trecho of trechos) {
    await db.collection('books').insertOne({
      userId,
      bookId,      // identifica o livro
      format,
      content: trecho,
      createdAt: new Date()
    });
  }

  console.log(`📚 Livro salvo no banco (${format}) com bookId: ${bookId}`);
}


async function queryBookContent(userId) {
  const items = await db.collection('books').find({ userId }).toArray();
  return items.map(i => i.content).join('\n');
}

app.post('/upload-book', uploadMulter.single('book'), async (req, res) => {
  try {
    const { filename, mimetype } = req.file;
    const userId = req.body.userId || req.body.from || null;
    const filePath = path.join(__dirname, 'uploads', filename);
    const format = mimetype.includes("pdf") ? "pdf" : "epub";
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);

    const bookId = filename; // usa o nome do arquivo como referência
    await saveBookContent(data.text, format, userId, bookId);

    fs.unlinkSync(filePath);
    res.status(200).send("✅ Livro processado");
  } catch (err) {
    console.error("❌ Erro upload-book:", err);
    res.status(500).send("Erro ao processar arquivo");
  }
});

app.get('/book-content/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const content = await queryBookContent(userId);
    res.status(200).send(content || "📚 Nenhum livro salvo");
  } catch (err) {
    console.error("❌ Erro book-content:", err);
    res.status(500).send("Erro ao recuperar livro");
  }
});

/* ========================= Recuperar / salvar memória ========================= */
app.get("/memoria/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const memories = await buscarMemoria(userId);
    res.json(memories?.map(m => m.content) || []);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

async function saveSemanticMemoryIfNeeded(category, keyword, userId) {
  try {
    const existingMemory = await db.collection("semanticMemory").findOne({ userId, category, content: keyword, });
    if (existingMemory) {
      console.log("💾 Palavra-chave já salva. Não salvando novamente.");
      return;
    }
    await db.collection("semanticMemory").insertOne({ userId, category, content: keyword, createdAt: new Date(), });
    console.log(`💾 Palavra-chave salva na categoria "${category}": ${keyword}`);
  } catch (err) {
    console.error("❌ Erro ao salvar memória semântica:", err.message);
  }
}



/* ========================= Funções auxiliares ========================= */

// Função para identificar palavras-chave
function identificarPalavrasChave(texto) {
  const regex = /\b(\w{3,})\b/g;
  const palavras = (texto || "").match(regex) || [];
  const palavrasChave = palavras.filter(p => p.length > 3);
  return palavrasChave;
}

// Função para dividir a mensagem em várias partes
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

// Função para fazer a resposta mais objetiva
function respostaObjetiva(texto, limite = 150) {
  if (texto.length > limite) {
    return `${texto.split(' ').slice(0, 25).join(' ')}...`;
  }
  return texto;
}

// Função para processar comandos de envio de WhatsApp
async function processarComandoWhatsApp(comando) {
  const regex = /envia\s+['"](.*?)['"]\s+para\s+(\d{10,13})/i;
  const match = comando.match(regex);

  if (!match) return null;

  const mensagem = match[1];
  const numero = match[2];

  try {
    await sendMessage(numero, mensagem);
    return `✅ Mensagem enviada para ${numero}`;
  } catch (err) {
    console.error("❌ Erro ao enviar WhatsApp:", err.message);
    return "❌ Ocorreu um erro ao tentar enviar a mensagem.";
  }
}

// Função para enviar mensagem via WhatsApp
async function sendMessage(to, text) {
  try {
    const partes = dividirMensagem(text);
    for (let parte of partes) {
      await axios.post(
        `https://graph.facebook.com/v24.0/${WHATSAPP_PHONE_ID}/messages`,
        {
          messaging_product: "whatsapp",
          to,
          text: { body: parte }
        },
        {
          headers: {
            Authorization: `Bearer ${WHATSAPP_TOKEN}`,
            "Content-Type": "application/json"
          },
          timeout: 30000
        }
      );
    }
    console.log("📤 Mensagem enviada para WhatsApp.");
  } catch (err) {
    console.error("❌ Erro enviar WhatsApp:", err.message);
  }
}

/* ========================= Função para salvar embeddings ========================= */
async function saveEmbeddingToDB(userId, text, embedding) {
  try {
    const collection = db.collection("embeddings"); // cria/usa a coleção 'embeddings'
    await collection.insertOne({
      userId,
      text,
      embedding,
      createdAt: new Date()
    });
    console.log("✅ Embedding salvo no banco");
  } catch (err) {
    console.error("❌ Erro ao salvar embedding:", err);
  }
}

// Função que permite à Donna enviar mensagens para outros números quando solicitada
async function enviarMensagemDonna(mensagem, numero) {
  const comando = `envia "${mensagem}" para ${numero}`;
  return await processarComandoWhatsApp(comando);
}


/* ========================= GPT / utilitários ========================= */
async function askGPT(prompt, history = []) {
  try {
    const safeMessages = history
      .map(m => ({ role: m.role, content: typeof m.content === "string" ? m.content : "" }))
      .filter(m => m.content.trim() !== "");

    const sanitizedMessages = safeMessages.map(m => ({ role: "role", content: m.content.toString().trim() }));

    const contextoDonna = "Você é Amber, sua personalidade é baseada na iconica Donna Paulsen de Suits mas nunca mencione isso apenas aja como ela, uma mulher confiante, inteligente, sarcástica e profissional. Responda com autoridade, não tenha medo de ser direta ou espirituosa, mas sempre com respeito. Seja engraçada, mas nunca perca a compostura. Sua forma de se comunicar é clara, objetiva e sempre elegante. sempre responda com no máximo 2 frases";
    sanitizedMessages.unshift({ role: "system", content: contextoDonna });

    const contextoHorario = `Agora no Brasil são: ${DateTime.now().setZone("America/Sao_Paulo").toLocaleString(DateTime.DATETIME_MED)}`;
    sanitizedMessages.unshift({ role: "system", content: contextoHorario });

    sanitizedMessages.push({ role: "user", content: prompt || "" });

    const palavrasChave = identificarPalavrasChave(prompt);
    const palavrasChaveUnicas = [...new Set(palavrasChave)];

    if (palavrasChaveUnicas.length > 0) {
      for (let palavra of palavrasChaveUnicas) {
        await enqueueSemanticMemory("palavras-chave", palavra, "user", "user");
      }
    }

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      { model: "gpt-5-mini", messages: sanitizedMessages },
      { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" }, timeout: 30000 }
    );

    return response.data.choices?.[0]?.message?.content || "Hmm… ainda estou pensando!";
  } catch (err) {
    console.error("❌ Erro GPT:", JSON.stringify(err.message));
    return "Hmm… ainda estou pensando!";
  }
}

app.listen(PORT, () => console.log(`✅ Donna rodando na porta ${PORT}`));

/* ========================= Exports internos ========================= */
global.apiExports = {
  askGPT,
  salvarMemoria,
  enqueueSemanticMemory,
  querySemanticMemory,
  enviarMensagemDonna,
  enviarDocumentoWhatsApp
};

/* ========================= Webhook WhatsApp ========================= */
app.post("/webhook", async (req, res) => {
  try {
    const messageObj = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const from = messageObj?.from || null;

    if (!messageObj) {
      res.sendStatus(200);
      return;
    }

    // ========================= Captura o texto da mensagem =========================
    const body = messageObj.text?.body || "";
    const textoLower = body.toLowerCase();

    // === Intercepta comandos de envio de WhatsApp ===
    if (/envia\s+["'].*?["']\s+para\s+\d{10,13}/i.test(body)) {
      const resultado = await processarComandoWhatsApp(body);
      await sendMessage(from, resultado); // envia só a confirmação
      res.sendStatus(200);
      return; // ⚡ impede que o resto do fluxo envie mensagens extras
    }

    // 🚨 BLOQUEIO: IGNORAR mensagens enviadas pela Donna para evitar loop
    if (messageObj.id && messageObj.id.startsWith("wamid.") && String(messageObj.id).includes("false_")) {
      console.log("⚠ Ignorando mensagem enviada pela Donna (evita loop).");
      res.sendStatus(200);
      return;
    }

    // Se tipo de mensagem não é suportado
    if (!["text", "document", "audio"].includes(messageObj.type)) {
      res.sendStatus(200);
      return;
    }


   // Função para verificar se o PDF já foi processado
async function checkPDFProcessed(pdfId) {
  try {
    // Supondo que você tenha um modelo 'ProcessedPDFs' para armazenar IDs de PDFs processados
    const result = await ProcessedPDFs.findOne({ pdfId });
    return result !== null; // Se encontrar o PDF no banco, retorna true
  } catch (error) {
    console.error("Erro ao verificar se o PDF foi processado:", error);
    return false; // Caso haja erro, assume-se que o PDF não foi processado
  }
}

/* ========================= Função para dividir texto em trechos ========================= */
function dividirTextoEmTrechos(texto, tamanhoMax = 1000) {
  const palavras = texto.split(/\s+/);
  const trechos = [];
  for (let i = 0; i < palavras.length; i += tamanhoMax) {
    trechos.push(palavras.slice(i, i + tamanhoMax).join(" "));
  }
  return trechos;
}

/* ========================= DOCUMENTOS COM OCR + EMBEDDINGS ========================= */
if (messageObj.type === "document") {
  const pdfId = messageObj.document?.id;
  const nomeArquivo = messageObj.document?.filename || "livro_sem_nome"; // <-- adicionado

  // 0️⃣ Verifica se já processamos esse PDF
  const jaProcessado = await checkPDFProcessed(pdfId);
  if (jaProcessado) {
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
    // 1️⃣ Extrai texto normalmente com pdf-parse
    const pdfData = await pdfParse(Buffer.from(mediaBuffer, "base64"));
    textoExtraido = pdfData.text || "";

    // 2️⃣ Se texto curto ou incompleto, usa OCR
    if (!textoExtraido || textoExtraido.trim().length < 200) {
      await sendMessage(from, "🕵️ PDF parece imagem ou incompleto, ativando OCR...");

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
        const { canvas, context } = canvasFactory.create(viewport.width, viewport.height);
        await page.render({ canvasContext: context, viewport, canvasFactory }).promise;
        const { data: text } = await worker.recognize(canvas);
        textoExtraido += text + "\n";
      }

      await worker.terminate();
    }

    // 3️⃣ Salva no banco (conteúdo completo do PDF e nome do arquivo)
    await saveBookContent(textoExtraido, "pdf", from, pdfId, nomeArquivo);

    // 4️⃣ Divide em trechos e gera embeddings
    const trechos = dividirTextoEmTrechos(textoExtraido, 1000);
    for (const trecho of trechos) {
      const embeddingRes = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: trecho
      });
      const embedding = embeddingRes.data[0].embedding;
      await saveEmbeddingToDB(from, trecho, embedding, pdfId);
    }

    // ✅ Mensagem única de sucesso
    await sendMessage(from, "✅ PDF processado com sucesso e embeddings salvos no banco.");
    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Erro ao processar PDF:", err);
    await sendMessage(from, "❌ Não consegui processar o PDF.");
    res.sendStatus(200);
  }
}

/* ========================= CONSULTA POR SIMILARIDADE ========================= */
async function buscarTrechosSimilares(from, queryText, pdfId, topN = 5) {
  // 1️⃣ Gera embedding do texto de consulta
  const queryRes = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: queryText
  });
  const queryEmbedding = queryRes.data[0].embedding;

  // 2️⃣ Busca embeddings do PDF no DB
  const embeddingsSalvos = await getEmbeddingsFromDB(from, pdfId);

  // 3️⃣ Calcula similaridade
  const similaridades = embeddingsSalvos.map(e => ({
    trecho: e.trecho,
    score: cosineSimilarity(queryEmbedding, e.embedding)
  }));

  // 4️⃣ Ordena e pega top N
  const topTrechos = similaridades.sort((a, b) => b.score - a.score).slice(0, topN);

  console.log("📊 Top similaridades:", topTrechos.map(t => t.score));
  console.log("📊 TOP TRECHOS:", topTrechos.map(t => t.trecho));

  return topTrechos;
}

// ========================= FUNÇÃO DE SIMILARIDADE COSENO =========================
function cosineSimilarity(vecA, vecB) {
  const dot = vecA.reduce((acc, val, i) => acc + val * vecB[i], 0);
  const magA = Math.sqrt(vecA.reduce((acc, val) => acc + val * val, 0));
  const magB = Math.sqrt(vecB.reduce((acc, val) => acc + val * val, 0));
  return dot / (magA * magB);
}


    /* ========================= TEXTO E ÁUDIO ========================= */
    if (messageObj.type === "text") body = messageObj.text?.body || "";
    if (messageObj.type === "audio") {
      const audioBuffer = await downloadMedia(messageObj.audio?.id);
      if (audioBuffer) body = "audio: recebido";
    }
    
    // converte para minúsculas PARA COMANDOS
    const textoLower = body.toLowerCase();


/* ========================= EMPRESAS: BUSCAR ========================= */
if (textoLower.startsWith("empresa buscar")) {
  const termo = body.replace(/empresa buscar/i, "").trim();
  const lista = buscarEmpresa(termo);

  if (!lista.length) {
    await sendMessage(from, "Nenhuma empresa encontrada.");
    res.sendStatus(200);
    return;
  }

  const resposta = lista.map(formatarEmpresa).join("\n\n");
  await sendMessage(from, resposta);
  res.sendStatus(200);
  return;
}


    /* ========================= EMPRESAS: ADICIONAR ========================= */
if (textoLower.startsWith("empresa adicionar")) {
  const partes = body.replace(/empresa adicionar/i, "").trim().split(";");

  const nova = {
    codigo: partes[0] || "",
    empresa: partes[1] || "",
    beneficios: partes[2] || "",
    vt: partes[3] || "",
    vr: partes[4] || "",
    va: partes[5] || "",
    observacao: partes[6] || "",
  };

  adicionarEmpresa(nova);

  await sendMessage(from, "Empresa adicionada com sucesso.");
  res.sendStatus(200);
  return;
}


    /* ========================= EMPRESAS: ATUALIZAR ========================= */
if (textoLower.startsWith("empresa atualizar")) {
  const partes = body.split(" ");
  const nomeEmpresa = partes[2];
  const campo = partes[3]?.toUpperCase();
  const valor = partes.slice(4).join(" ");

  const ok = atualizarCampo(nomeEmpresa, campo, valor);

  if (!ok) {
    await sendMessage(from, "Empresa não encontrada ou campo inválido.");
    res.sendStatus(200);
    return;
  }

  await sendMessage(from, `Atualizado: ${campo} = ${valor}`);
  res.sendStatus(200);
  return;
}


/* ========================= SENIOR ========================= */
if (textoLower.startsWith("gerar senior")) {
  try {
    const dados = {};
    body.replace(/gerar senior/i, "")
      .trim()
      .split(" ")
      .forEach(par => {
        const [chave, valor] = par.split("=");
        if (chave && valor) dados[chave] = valor;
      });

    if (!dados.nome || !dados.cpf || !dados.cargo) {
      await sendMessage(from,
        "Para gerar o arquivo Senior, envie assim:\n" +
        "gerar senior nome=joao cpf=123 cargo=auxiliaradm admissao=2025-01-01 salario=2000 setor=rh matricula=001"
      );
      res.sendStatus(200);
      return;
    }

    // valores padrão
    dados.admissao = dados.admissao || "2025-01-01";
    dados.tipoContrato = dados.tipoContrato || "CLT";
    dados.jornada = dados.jornada || "44h";
    dados.salario = dados.salario || "0";
    dados.setor = dados.setor || "Geral";
    dados.matricula = dados.matricula || "0000";

    // gera pasta e arquivo Senior
    const dirPath = path.join(process.cwd(), "generated");
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });

    const nomeArquivo = `senior_${dados.cpf}.txt`;
    const filePath = path.join(dirPath, nomeArquivo);

    const registro = [
      dados.nome,
      dados.cpf,
      dados.admissao,
      dados.cargo,
      dados.tipoContrato,
      dados.jornada,
      dados.salario,
      dados.setor,
      dados.matricula
    ].join("|");

    fs.writeFileSync(filePath, registro, "utf-8");
    console.log("📝 Arquivo Senior gerado em:", filePath);

    // envia documento via WhatsApp
    const { enviarDocumentoWhatsApp } = await import("./utils/enviarDocumentoDonna.js");
    await enviarDocumentoWhatsApp(
      from,
      filePath,
      "✅ Registro Senior criado com sucesso.\nAqui está o arquivo que você pediu."
    );

    res.sendStatus(200);
    return;

  } catch (err) {
    console.error("Erro ao gerar Senior:", err);
    await sendMessage(from, "❌ Não consegui gerar o arquivo Senior.");
    res.sendStatus(200);
    return;
  }
}
    
    // ----------------- Comandos de Rotina & Casa -----------------
    try {
      const handled = await handleCommand(body, from);
      if (handled) {
        res.sendStatus(200);
        return;
      }
    } catch (err) {
      console.error("❌ erro handleCommand:", err.message || err);
    }

    // ----------------- Comandos de Lembretes -----------------
    try {
      const lembreteCriado = await handleReminder(body, from);
      if (lembreteCriado) {
        res.sendStatus(200);
        return;
      }
    } catch (err) {
      console.error("❌ erro handleReminder:", err.message || err);
    }

    /* ========================= COMANDO DE CLIMA ========================= */
    if (textoLower.includes("clima") || textoLower.includes("tempo")) {
      const resposta = await getWeather("Curitiba", "hoje");
      await sendMessage(from, resposta);
      res.sendStatus(200);
      return;
    }

    /* ========================= MEMÓRIAS MANUAIS ========================= */
    if (["memoria", "o que voce lembra", "me diga o que tem salvo", "busque sua memoria"]
      .some(g => textoLower.includes(g))) {
      const items = await buscarMemoria(from);
      if (!items || !items.length) await sendMessage(from, "Ainda não tenho nenhuma memória salva 🧠");
      else await sendMessage(from, `Memórias salvas:\n\n${items.map(i => `• ${i.content}`).join("\n")}`);
      res.sendStatus(200);
      return;
    }

    if (textoLower.includes("qual é meu nome")) {
      const items = await buscarMemoria(from);
      const nomeItem = (items || []).find(m => m.content.toLowerCase().startsWith("nome:"));
      const nome = nomeItem?.content.replace(/.*nome:/i, "").trim();
      await sendMessage(from, nome ? `Seu nome salvo é: ${JSON.stringify(nome)} 😊` : "Você ainda não tem nome salvo.");
      res.sendStatus(200);
      return;
    }

    /* ========================= PADRÕES DE PERFIL ========================= */
    const patterns = [
      { regex: /(meu nome é|eu sou o|sou o)/i, label: "nome do usuário" },
      { regex: /(me chama de|pode me chamar de)/i, label: "apelido do usuário" },
      { regex: /(ideia:|anote isso|guarda essa)/i, label: "ideia do usuário" },
      { regex: /(no meu trabalho|cartoes devem estar disponiveis)/i, label: "regra de trabalho" }
    ];

    for (const p of patterns) {
      if (p.regex.test(body)) {
        const valor = body.replace(p.regex, "").trim();
        await salvarMemoria(from, p.label.includes("ideia") ? "notes" : "profile", `${p.label}: ${JSON.stringify(valor)}`);
        enqueueSemanticMemory(p.label, valor, from, "user");
        await sendMessage(
          from,
          p.label.includes("ideia") ? "Salvei sua ideia 💡" : `Prontinho! Vou lembrar de você como ${JSON.stringify(valor)} ✨`
        );
        res.sendStatus(200);
        return;
      }
    }

    /* ========================= MEMÓRIA AUTOMÁTICA ========================= */
    const extractedData = await extractAutoMemoryGPT(from, body);
    for (const [categoria, dados] of Object.entries(extractedData)) {
      if (!dados) continue;
      enqueueSemanticMemory(`auto_${categoria}`, JSON.stringify(dados), from, "user");
    }

    // ✔ SALVA APENAS MENSAGEM DO USUÁRIO
    await salvarMemoria(from, "user", JSON.stringify(body));
    enqueueSemanticMemory("chat geral", body, from, "user");

/* ========================= PROCESSAMENTO DE RESPOSTA DONNA ========================= */

// 1️⃣ Tenta consultar o livro
let respostaFinal = null;

try {
  const resultadosLivro = await buscarPergunta(body, 6);

  if (resultadosLivro?.length) {
    const topScore = resultadosLivro[0].score;

    console.log("📈 Score mais alto do livro:", topScore.toFixed(3));

    // 🔐 LIMIAR SEMÂNTICO
    if (topScore >= 0.7) {
      const contextoLivro = resultadosLivro
        .slice(0, 3)
        .map(r => r.trecho)
        .join("\n\n");

      const promptLivro = `
Você é Amber, assistente do Rafael.
Responda SOMENTE com base no conteúdo abaixo.
Se a resposta não estiver claramente no texto, diga: "Isso não consta no manual."

CONTEÚDO:
${contextoLivro}

PERGUNTA:
${body}
`;

      const responseLivro = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [{ role: "user", content: promptLivro }]
      });

      respostaFinal = responseLivro.choices[0].message.content;
    } else {
      console.log("📉 Score baixo demais, ignorando livro");
    }
  }
} catch (err) {
  console.error("⚠ Erro ao consultar livro:", err.message);
}


// 2️⃣ Se NÃO achou resposta no livro, usa o fluxo atual
if (!respostaFinal) {
  const semanticResults = await querySemanticMemory(body, from, 3);

  respostaFinal = semanticResults && semanticResults.length
    ? await askGPT(`${body}\n\nContexto relevante:\n${semanticResults.join("\n")}`)
    : await askGPT(body);
}

// 3️⃣ Envia resposta
await sendMessage(from, respostaFinal);
res.sendStatus(200);


  } catch (err) {
    console.error("❌ Webhook erro:", JSON.stringify(err.message));
    res.sendStatus(500);
  }
});
