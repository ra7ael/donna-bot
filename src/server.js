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
import { addSemanticMemory, querySemanticMemory } from "./models/semanticMemory.js";
import { salvarMemoria, buscarMemoria, limparMemoria, getDB } from './utils/memory.js';
import { initRoutineFamily, handleCommand } from "./utils/routineFamily.js";
import { handleReminder } from './utils/routineFamily.js';
import { gerarArquivoSenior } from "./utils/generateSeniorTXT.js";
import { enviarDocumentoWhatsApp } from "./utils/enviarMensagemDonna.js";
import { buscarEmpresa,adicionarEmpresa,atualizarCampo,formatarEmpresa} from "./utils/handleEmpresa.js";
import { searchBook } from "./utils/searchBook.js";
import { normalizeMessage, shouldIgnoreMessage } from "./utils/messageHelper.js";


mongoose.set("bufferTimeoutMS", 90000); // ⬆️ aumenta o tempo antes do timeout
dotenv.config();

const app = express();

// ================== MEMÓRIA (DONO ÚNICO) ==================

async function persistirMemoriaSemantica({ userId, category, content }) {
  const existing = await db.collection("semanticMemory").findOne({
    userId,
    category,
    content
  });

  if (existing) return;

  await db.collection("semanticMemory").insertOne({
    userId,
    category,
    content,
    createdAt: new Date()
  });
}

async function processarMemoria({ from, texto }) {
  // 🧠 memória semântica por embedding (frase inteira)
  await addSemanticMemory({
    userId: from,
    content: texto
  });

  // 🧱 memória estruturada (histórico / fatos)
  await salvarMemoria(from, texto);
}


// =========================
// 🔁 MEMÓRIA ANTI-ECO (GLOBAL)
// =========================
const mensagensProcessadas = new Set();

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

    let respostaFinal;
    const semanticResults = await querySemanticMemory(body, from, 3);

    respostaFinal = semanticResults?.length
      ? await askGPT(`${body}\n\nContexto:\n${semanticResults.join("\n")}`)
      : await askGPT(body);

    await sendMessage(from, respostaFinal);
    res.sendStatus(200);

  } catch (err) {
    console.error("❌ Webhook erro:", err.message);
    res.sendStatus(500);
  }
});
