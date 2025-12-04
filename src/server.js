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
import { setPapeis, clearPapeis } from "./utils/treinoDonna.js";
import { buscarPergunta } from "./utils/buscarPdf.js";
import multer from "multer";
import { funcoesExtras } from "./utils/funcoesExtras.js";
import { extractAutoMemoryGPT } from "./utils/autoMemoryGPT.js";
import { addSemanticMemory, querySemanticMemory } from "./models/semanticMemory.js";
import enqueueSemanticMemory from './utils/enqueueSemanticMemory.js';
import { saveChatMemory, querySemanticMemory } from './utils/memory.js';

mongoose.set("bufferTimeoutMS", 90000); // ⬆️ aumenta o tempo antes do timeout

dotenv.config();
const app = express();
app.use(bodyParser.json());
const uploadMulter = multer({ dest: "uploads/" });

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
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

// ⚡ openai instanciado com a variável correta
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ===== Conexão com MongoDB =====
let db;

async function connectDB() {
  let tentativas = 5;

  while (tentativas > 0) {
    try {
      console.log("🔹 Tentando conectar ao MongoDB...");
      const client = await MongoClient.connect(MONGO_URI, {
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 60000, // ⬆️ aumentei
        socketTimeoutMS: 90000           // ⬆️ aumentei
      });

      db = client.db("donna");
      console.log("✅ Conectado ao MongoDB ✅");

      await mongoose.connect(MONGO_URI, {
        serverSelectionTimeoutMS: 60000, // ⬆️ aumentei
        connectTimeoutMS: 60000,         // ⬆️ aumentei
        socketTimeoutMS: 90000,          // ⬆️ aumentei
        maxPoolSize: 10
      });

      console.log("✅ Mongoose conectado com sucesso ✅");
      startReminderCron(db, sendMessage);
      break; // se conectar, sai do loop

    } catch (err) {
      tentativas--;
      console.error(`❌ Falha ao conectar. Tentativas restantes: ${tentativas}`);
      console.error(err.message);

      if (tentativas === 0) {
        console.error("❌ Não foi possível conectar ao banco. Encerrando...");
        process.exit(1);
      }

      // aguarda 5s antes de tentar de novo
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

await connectDB();
export { db };

// ===== 📚 Funções de Livros (colocar aqui) =====

// Salvar conteúdo do livro no banco
async function saveBookContent(content, format, userId) {
  const contentChunks = content.split('\n').map(chunk => chunk.trim()).filter(chunk => chunk);
  for (let chunk of contentChunks) {
    await db.collection('books').insertOne({
      userId,
      format,
      content: chunk,
      createdAt: new Date(),
    });
  }
  console.log(`📚 Livro salvo no banco (${format})`);
}

// Consultar conteúdo do livro
async function queryBookContent(userId) {
  const items = await db.collection('books').find({ userId }).toArray();
  return items.map(i => i.content).join('\n');
}

// Endpoint de upload do livro
app.post('/upload-book', uploadMulter.single('book'), async (req, res) => {
  const { filename, mimetype } = req.file;
  const userId = req.body.userId || req.body.from || null;
  const filePath = path.join(__dirname, 'uploads', filename);
  const format = mimetype.includes("pdf") ? "pdf" : "epub";

  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  await saveBookContent(data.text, format, userId);
  fs.unlinkSync(filePath);

  res.status(200).send("✅ Livro processado");
});

// Endpoint de consulta do livro sem GPT
app.get('/book-content/:userId', async (req, res) => {
  const { userId } = req.params;
  const content = await queryBookContent(userId);
  res.status(200).send(content || "📚 Nenhum livro salvo");
});


// ===== Salvar memória do chat (cache evita duplicação) =====
let chatCache = new Set();

async function saveChatMemory(userId, role, content) {
  if (!content || !content.toString().trim()) return;

  // Sanitizar o conteúdo (remover espaços extras)
  const sanitizedContent = content.toString().trim();

  // Gerar chave de cache única
  const key = `${userId}-${sanitizedContent}`;

  // Verificar se já existe esse conteúdo no cache
  if (chatCache.has(key)) {
    console.log("💾 Conteúdo já está no cache, não salvando novamente.");
    return;
  }

  // Verificar se o conteúdo já existe no banco de dados
  try {
    const existingMemory = await db.collection("chatMemory").findOne({ userId, content: sanitizedContent });
    if (existingMemory) {
      console.log("💾 Conteúdo já existe no banco de dados, não salvando novamente.");
      return;
    }

    // Adicionar ao cache para evitar futuras duplicações
    chatCache.add(key);

    // Salvar conteúdo no banco de dados
    await db.collection("chatMemory").insertOne({
      userId,
      role,
      content: sanitizedContent,
      createdAt: new Date()
    });

    console.log("💾 Chat salvo na chatMemory.");
  } catch (err) {
    console.error("❌ Erro ao salvar chat:", err.message);
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
  } catch (err) {
    console.error("❌ Erro ao recuperar memória:", err.message);
    return [];
  }
}

// ===== Função de busca mantida =====
async function buscarMemoria(userId) {
  try {
    const items = await getChatMemory(userId, 20);
    if (!items.length) return null;
    return items.map(m => ({
      role: m.role,
      content: m.content,
      createdAt: m.createdAt
    }));
  } catch (err) {
    console.error("❌ Erro ao buscar memória:", err.message);
    return [];
  }
}

// ===== Endpoint de memória mantido =====
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

// ===== Função para salvar memória semântica, verificando duplicação =====
async function saveSemanticMemoryIfNeeded(category, keyword, userId) {
  try {
    // Verificar se a palavra-chave já está salva para o usuário
    const existingMemory = await db.collection("semanticMemory").findOne({
      userId,
      category,
      content: keyword,
    });

    if (existingMemory) {
      console.log("💾 Palavra-chave já salva. Não salvando novamente.");
      return;
    }

    // Caso não exista, salvar a palavra-chave no banco
    await db.collection("semanticMemory").insertOne({
      userId,
      category,
      content: keyword,
      createdAt: new Date(),
    });

    console.log(`💾 Palavra-chave salva na categoria "${category}": ${keyword}`);
  } catch (err) {
    console.error("❌ Erro ao salvar memória semântica:", err.message);
  }
}

// ===== Função askGPT mantida e com cast seguro =====
async function askGPT(prompt, history = []) {
  try {
    const safeMessages = history
      .map(m => ({ role: m.role, content: typeof m.content === "string" ? m.content : "" }))
      .filter(m => m.content.trim() !== "");

    const sanitizedMessages = safeMessages.map(m => ({
      role: m.role,
      content: m.content.toString().trim()
    }));

    const contextoDonna = `Você é Donna, sua personalidade é baseada na iconica Donna Paulsen de Suits mas nunca mencione isso apenas aja como ela, uma mulher confiante, inteligente, sarcástica e profissional. Responda com autoridade, não tenha medo de ser direta ou espirituosa, mas sempre com respeito. Seja engraçada, mas nunca perca a compostura. Sua forma de se comunicar é clara, objetiva e sempre elegante. sempre responda com no maximo 2 frases`;

    const contextoHorario = `Agora no Brasil são: ${DateTime.now().setZone("America/Sao_Paulo").toLocaleString(DateTime.DATETIME_MED)}`;
    sanitizedMessages.unshift({ role: "system", content: contextoHorario });
    sanitizedMessages.push({ role: "user", content: prompt || "" });

    // Identificar palavras-chave no prompt
    const palavrasChave = identificarPalavrasChave(prompt);

    // Evitar duplicação: filtra palavras-chave já salvas
    const palavrasChaveUnicas = [...new Set(palavrasChave)];

    // Se encontrar palavras-chave, salvar elas como memória semântica
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

// Função para identificar palavras-chave no prompt
function identificarPalavrasChave(texto) {
  const regex = /\b(\w{3,})\b/g;
  const palavras = texto.match(regex) || [];
  const palavrasChave = palavras.filter(p => p.length > 3);
  return palavrasChave;
}

// Função para dividir a mensagem em partes
function dividirMensagem(texto, limite = 120) {
  const partes = [];
  while (texto.length > limite) {
    partes.push(texto.slice(0, limite));
    texto = texto.slice(limite);
  }
  partes.push(texto);
  return partes;
}

let lastMessageSent = null;

// Envia apenas se não for igual à última e aguarda a conclusão
async function sendMessageIfNeeded(to, text) {
  if (!text || text === lastMessageSent) {
    console.log("💬 duplicada, pulando");
    return false;
  }
  await sendMessage(to, text);
  lastMessageSent = text;
  return true;
}

// Função para enviar mensagem via WhatsApp
async function sendMessage(to, text) {
  try {
    const partes = dividirMensagem(text);
    for (let parte of partes) {
      await axios.post(
        `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_ID}/messages`,
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

// ✅ disponibiliza internamente sem quebrar ESM
global.apiExports = { askGPT, saveChatMemory, enqueueSemanticMemory, querySemanticMemory };

// ===== Webhook mantido =====
app.post("/webhook", async (req, res) => {
  try {
    const messageObj = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const from = messageObj?.from || null;

    if (messageObj.type === "document") {
      const mediaBuffer = await downloadMedia(messageObj.document?.id);
      if (!mediaBuffer) {
        await sendMessage(from, "⚠ Não consegui baixar o livro.");
        return res.sendStatus(200);
      }

      const textoExtraido = await pdfParse(Buffer.from(mediaBuffer, "base64"));
      await saveBookContent(textoExtraido.text, "pdf", from);
      await sendMessage(from, "✅ Livro salvo no banco. Me peça quando quiser ler.");
      return res.sendStatus(200);
    }

    if (!messageObj) return res.sendStatus(200);

    let body = "";
    if (messageObj.type === "text") body = messageObj.text?.body || "";

    if (messageObj.type === "audio") {
      const audioBuffer = await downloadMedia(messageObj.audio?.id);
      if (audioBuffer) body = "audio: recebido";
    }

    if (["memoria", "o que voce lembra", "me diga o que tem salvo", "busque sua memoria"].some(g => body.toLowerCase().includes(g))) {
      const items = await getChatMemory(from, 30);
      if (!items.length) {
        await sendMessage(from, "Ainda não tenho nenhuma memória salva 🧠");
      } else {
        const resposta = items.map(i => `• ${i.content}`).join("\n");
        await sendMessage(from, `Memórias salvas:\n\n${resposta}`);
      }
      return res.sendStatus(200);
    }

    if (body.toLowerCase().includes("qual é meu nome")) {
      const items = await getChatMemory(from, 20);
      const nomeItem = items.find(m => m.content.toLowerCase().startsWith("nome:"));
      const nome = nomeItem?.content.replace(/.*nome:/i, "").trim();
      await sendMessage(from, nome ? `Seu nome salvo é: ${JSON.stringify(nome)} 😊` : "Você ainda não tem nome salvo.");
      return res.sendStatus(200);
    }

    const patterns = [
      { regex: /(meu nome é|eu sou o|sou o)/i, label: "nome do usuário" },
      { regex: /(me chama de|pode me chamar de)/i, label: "apelido do usuário" },
      { regex: /(ideia:|anote isso|guarda essa)/i, label: "ideia do usuário" },
      { regex: /(no meu trabalho|cartoes devem estar disponiveis)/i, label: "regra de trabalho" }
    ];

    for (const p of patterns) {
      if (p.regex.test(body)) {
        const valor = body.replace(p.regex, "").trim();
        await saveChatMemory(from, p.label.includes("ideia") ? "notes" : "profile", `${p.label}: ${JSON.stringify(valor)}`);
        enqueueSemanticMemory(p.label, valor, from, "user");
        await sendMessage(from, p.label.includes("ideia") ? `Salvei sua ideia 💡` : `Prontinho! Vou lembrar de você como ${JSON.stringify(valor)} ✨`);
        return res.sendStatus(200);
      }
    }

    const extractedData = await extractAutoMemoryGPT(from, body);
    for (const [categoria, dados] of Object.entries(extractedData)) {
      if (!dados) continue;
      enqueueSemanticMemory(`auto_${categoria}`, JSON.stringify(dados), from, "user");
    }

    await saveChatMemory(from, "user", JSON.stringify(body));
    enqueueSemanticMemory("chat geral", body, from, "user");

    const semanticResults = await querySemanticMemory(body, from, 3);
    let reply;
    if (semanticResults && semanticResults.length) {
      reply = await askGPT(`${body}\n\nContexto relevante:\n${semanticResults.join("\n")}`);
    } else {
      reply = await askGPT(body);
    }

    await saveChatMemory(from, "assistant", JSON.stringify(reply));
    enqueueSemanticMemory("resposta GPT", reply, from, "assistant");
    await sendMessage(from, reply);

    return res.sendStatus(200);

  } catch (err) {
    console.error("❌ Webhook erro:", JSON.stringify(err.message));
    return res.sendStatus(500);
  }
});

// ✅ Export mantido sem quebrar
export { 
  askGPT,
  saveChatMemory,
  enqueueSemanticMemory,
  querySemanticMemory
};

// ✅ Mantém apenas UM listen no final do arquivo
app.listen(PORT, () => console.log(`✅ Donna rodando na porta ${PORT}`));
