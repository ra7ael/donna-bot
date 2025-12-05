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
import { enqueueSemanticMemory } from './utils/semanticQueue.js';
import { salvarMemoria, buscarMemoria, limparMemoria, getDB } from './utils/memory.js';

mongoose.set("bufferTimeoutMS", 90000); // ⬆️ aumenta o tempo antes do timeout

dotenv.config();
const app = express();
app.use(bodyParser.json());
const uploadMulter = multer({ dest: "uploads/" });

/* =========================
   Controle de cron & dedup
   ========================= */
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

/* =========================
   Variáveis e helpers gerais
   ========================= */

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

function verificarComandoProfissao(texto) {
  const textoLower = (texto || "").toLowerCase();

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

/* =========================
   Conexão com MongoDB (única)
   ========================= */
let db;

async function connectDB() {
  let tentativas = 5;

  while (tentativas > 0) {
    try {
      console.log("🔹 Tentando conectar ao MongoDB...");
      const client = await MongoClient.connect(MONGO_URI, {
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 60000,
        socketTimeoutMS: 90000
      });

      db = client.db("donna");
      console.log("✅ Conectado ao MongoDB ✅");

      await mongoose.connect(MONGO_URI, {
        serverSelectionTimeoutMS: 60000,
        connectTimeoutMS: 60000,
        socketTimeoutMS: 90000,
        maxPoolSize: 10
      });

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

/* =========================
   Funções de livros e rotas
   ========================= */
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
    await saveBookContent(data.text, format, userId);
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

/* =========================
   Recuperar / salvar memória
   ========================= */
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
    const existingMemory = await db.collection("semanticMemory").findOne({
      userId,
      category,
      content: keyword,
    });

    if (existingMemory) {
      console.log("💾 Palavra-chave já salva. Não salvando novamente.");
      return;
    }

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

async function askGPT(prompt, history = []) {
  try {
    const safeMessages = history
      .map(m => ({ role: m.role, content: typeof m.content === "string" ? m.content : "" }))
      .filter(m => m.content.trim() !== "");

    const sanitizedMessages = safeMessages.map(m => ({
      role: m.role,
      content: m.content.toString().trim()
    }));

    const contextoDonna = `Você é Donna, sua personalidade é baseada na icônica Donna Paulsen de Suits. Seja confiante, inteligente, sarcástica e profissional. Responda com autoridade, sendo direta, espirituosa, mas sempre respeitosa. Seja engraçada, mas nunca perca a compostura. Sua forma de se comunicar é clara, objetiva e sempre elegante. Sempre responda com no máximo 2 frases.`;

    const contextoHorario = `Agora no Brasil são: ${DateTime.now().setZone("America/Sao_Paulo").toLocaleString(DateTime.DATETIME_MED)}`;
    sanitizedMessages.unshift({ role: "system", content: contextoHorario });
    sanitizedMessages.push({ role: "user", content: prompt || "" });

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

async function sendMessage(to, text, isAudio = false) {
  try {
    if (isAudio) {
      const audioBuffer = await textToAudio(text); // Converte o texto para áudio
      await sendAudioMessage(to, audioBuffer);
    } else {
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
    }
    console.log("📤 Mensagem enviada para WhatsApp.");
  } catch (err) {
    console.error("❌ Erro enviar WhatsApp:", err.message);
  }
}

async function sendAudioMessage(to, audioBuffer) {
  try {
    await axios.post(
      `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        audio: { link: audioBuffer } // Assumindo que o link do áudio é retornado
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        },
        timeout: 30000
      }
    );
    console.log("📤 Áudio enviado para WhatsApp.");
  } catch (err) {
    console.error("❌ Erro ao enviar áudio:", err.message);
  }
}

/* Função para converter texto em áudio (usando OpenAI ou TTS externo) */
async function textToAudio(text) {
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/audio/generate", // URL para geração de áudio (ajuste conforme sua API de TTS)
      {
        model: "whisper-1", // Ou outro modelo de TTS, dependendo da sua API
        input: text,
        voice: "pt-BR", // ou qualquer voz que preferir
        encoding: "mp3"
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    return response.data.audio_url; // Ou base64, dependendo da resposta
  } catch (err) {
    console.error("❌ Erro ao gerar áudio:", err.message);
    return null;
  }
}

/* =========================
   Webhook WhatsApp
   ========================= */
app.post("/webhook", async (req, res) => {
  try {
    const messageObj = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const from = messageObj?.from || null;
    if (!messageObj) return res.sendStatus(200);

    // 🚨 1. BLOQUEIO: IGNORA MENSAGENS QUE NÃO SÃO DO USUÁRIO
    if (messageObj.id && messageObj.id.startsWith("wamid.")) {
      if (String(messageObj.id).includes("false_")) {
        console.log("⚠ Ignorando mensagem enviada pela Donna (evita loop).");
        return res.sendStatus(200);
      }
    }

    // Se não for tipo reconhecido
    if (!["text", "document", "audio"].includes(messageObj.type)) {
      return res.sendStatus(200);
    }

    /* =========================
       DOCUMENTOS
       ========================= */
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

    /* =========================
       TEXTO E ÁUDIO
       ========================= */
    let body = "";
    if (messageObj.type === "text") body = messageObj.text?.body || "";
    if (messageObj.type === "audio") {
      const audioBuffer = await downloadMedia(messageObj.audio?.id);
      if (audioBuffer) {
        // Transcrever o áudio para texto
        const transcricao = await transcreverAudio(audioBuffer);
        if (transcricao) {
          body = transcricao; // Corpo da mensagem é a transcrição do áudio
          await sendMessage(from, `🎤 Áudio transcrito: ${body}`);
        } else {
          await sendMessage(from, "⚠ Não consegui transcrever o áudio.");
        }
      }
    }

    if (body) {
      const respostaGPT = await askGPT(body);
      const isAudioResponse = messageObj.type === "audio"; // Se a mensagem recebida foi um áudio, a resposta será em áudio também
      await sendMessage(from, respostaGPT, isAudioResponse); // Enviar a resposta como áudio ou texto
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Erro no webhook:", err.message);
    res.sendStatus(500);
  }
});

/* =========================
   Função de transcrição de áudio
   ========================= */
async function transcreverAudio(audioBuffer) {
  try {
    const transcricao = await axios.post(
      "https://speech.googleapis.com/v1/speech:recognize",
      {
        config: { encoding: "LINEAR16", sampleRateHertz: 16000, languageCode: "pt-BR" },
        audio: { content: audioBuffer.toString("base64") }
      },
      { headers: { Authorization: `Bearer ${process.env.GOOGLE_CLOUD_API_KEY}` } }
    );

    return transcricao.data?.results?.[0]?.alternatives?.[0]?.transcript || null;
  } catch (err) {
    console.error("❌ Erro ao transcrever áudio:", err.message);
    return null;
  }
}

       MEMÓRIAS MANUAIS
       ========================= */
    if (["memoria", "o que voce lembra", "me diga o que tem salvo", "busque sua memoria"]
      .some(g => body.toLowerCase().includes(g))) {

      const items = await buscarMemoria(from);
      if (!items || !items.length) await sendMessage(from, "Ainda não tenho nenhuma memória salva 🧠");
      else await sendMessage(
        from,
        `Memórias salvas:\n\n${items.map(i => `• ${i.content}`).join("\n")}`
      );
      return res.sendStatus(200);
    }

    if (body.toLowerCase().includes("qual é meu nome")) {
      const items = await buscarMemoria(from);
      const nomeItem = (items || []).find(m => m.content.toLowerCase().startsWith("nome:"));
      const nome = nomeItem?.content.replace(/.*nome:/i, "").trim();
      await sendMessage(from, nome ? `Seu nome salvo é: ${JSON.stringify(nome)} 😊` : "Você ainda não tem nome salvo.");
      return res.sendStatus(200);
    }

    /* =========================
       PADRÕES DE PERFIL
       ========================= */
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
          p.label.includes("ideia") ? `Salvei sua ideia 💡` : `Prontinho! Vou lembrar de você como ${JSON.stringify(valor)} ✨`
        );
        return res.sendStatus(200);
      }
    }

    /* =========================
       MEMÓRIA AUTOMÁTICA
       ========================= */

    // ❌ AGREGAÇÃO DE GPT PARA AS RESPOSTAS DA DONNA REMOVIDO
    const extractedData = await extractAutoMemoryGPT(from, body);

    for (const [categoria, dados] of Object.entries(extractedData)) {
      if (!dados) continue;
      enqueueSemanticMemory(`auto_${categoria}`, JSON.stringify(dados), from, "user");
    }

    // ✔ SALVA APENAS MENSAGEM DO USUÁRIO
    await salvarMemoria(from, "user", JSON.stringify(body));
    enqueueSemanticMemory("chat geral", body, from, "user");

    /* =========================
       PROCESSAMENTO DE RESPOSTA GPT
       ========================= */
    const semanticResults = await querySemanticMemory(body, from, 3);
    const reply =
      semanticResults && semanticResults.length
        ? await askGPT(`${body}\n\nContexto relevante:\n${semanticResults.join("\n")}`)
        : await askGPT(body);

    // ❌ NÃO SALVAR RESPOSTA DA DONNA COMO MEMÓRIA → CORTA LOOP!
    // await salvarMemoria(from, "assistant", JSON.stringify(reply));
    // enqueueSemanticMemory("resposta GPT", reply, from, "assistant");

    await sendMessage(from, reply);

    return res.sendStatus(200);

  } catch (err) {
    console.error("❌ Webhook erro:", JSON.stringify(err.message));
    return res.sendStatus(500);
  }
});

app.listen(PORT, () => console.log(`✅ Donna rodando na porta ${PORT}`));
