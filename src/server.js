require("dotenv/config");
const express = require("express");
const OpenAI = require("openai");
const { MongoClient } = require("mongodb");
const pdfParse = require("pdf-parse/lib/pdf-parse.js");
const bodyParser = require("body-parser");
const axios = require("axios");
const mongoose = require("mongoose");
const cron = require("node-cron");
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");
const { DateTime } = require("luxon");

const { startReminderCron } = require("./cron/reminders.js");
const { getWeather } = require("./utils/weather.js");
const { downloadMedia } = require("./utils/downloadMedia.js");
const { falar, sendAudio } = require("./utils/speak.js");
const { numerosAutorizados } = require("./config/autorizados.js");
const { treinarDonna, obterResposta, setPapeis, clearPapeis } = require("./utils/treinoDonna.js");
const { buscarPergunta } = require("./utils/buscarPdf.js");
const { funcoesExtras } = require("./utils/funcoesExtras.js");
const { extractAutoMemoryGPT } = require("./utils/autoMemoryGPT.js");
const { salvarMemoria, buscarMemoria, limparMemoria } = require("./utils/memory.js");
const Message = require("./models/Message.js");
const Reminder = require("./models/Reminder.js");
const Conversation = require("./models/Conversation.js");

// ===== Conectar Mongoose antecipadamente =====
if (process.env.MONGO_URI) {
  mongoose
    .connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 })
    .then(() => console.log("✅ Mongoose conectado ao Mongo (memória estruturada)"))
    .catch((err) => console.error("❌ Falha conexão Mongoose:", err?.message || err));
} else {
  console.warn("⚠️ MONGO_URI não definida. Mongoose não será conectado.");
}

// ===== App express único =====
const app = express();
app.use(bodyParser.json());
const upload = null;

// ===== Global error handlers =====
process.on("uncaughtException", (err) => console.error("🔥 Uncaught Exception:", err));
process.on("unhandledRejection", (reason) => console.error("🔥 Unhandled Rejection:", reason));

// ===== Papéis Profissionais =====
const profissoes = [
  "Enfermeira Obstetra","Médica","Nutricionista","Personal Trainer","Psicóloga","Coach de Produtividade",
  "Consultora de RH","Advogada","Contadora","Engenheira Civil","Arquiteta","Designer Gráfica",
  "Professora de Inglês","Professora de Matemática","Professora de História","Cientista de Dados",
  "Desenvolvedora Full Stack","Especialista em IA","Social Media","Especialista em SEO","E-commerce",
  "Recrutadora","Mentora de Startups","Administradora de Sistemas","Especialista em Redes","Chef de Cozinha"
];

let papelAtual = null;
let papeisCombinados = [];

function verificarComandoProfissao(texto) {
  const textoLower = texto.toLowerCase().trim();

  if (textoLower.includes("sair do papel") || textoLower.includes("volte a ser assistente") || textoLower.includes("saia do papel")) {
    papelAtual = null;
    papeisCombinados = [];
    clearPapeis();
    return { tipo: "saida", resposta: "Ok! 😊 Assistente pessoal reativado." };
  }

  for (const p of profissoes) {
    const pLower = p.toLowerCase();
    if (textoLower.includes(`você é ${pLower}`) || textoLower.includes(`seja meu ${pLower}`) || textoLower.includes(`ajude-me como ${pLower}`) || textoLower === pLower) {
      papelAtual = p;
      papeisCombinados = [p];
      setPapeis([p]);
      return { tipo: "papel", resposta: `💼 Papel definido: ${p}. Pode enviar a demanda!` };
    }
  }

  const combinarMatch = textoLower.match(/(misture|combine|junte) (.+)/i);
  if (combinarMatch) {
    const solicitados = combinarMatch[2].split(/,| e |\+|com/).map((s) => s.trim()).filter(Boolean);
    const validos = solicitados.filter((s) => profissoes.some((p) => p.toLowerCase() === s.toLowerCase()));
    if (validos.length > 0) {
      papelAtual = "Múltiplos";
      papeisCombinados = validos;
      setPapeis(validos);
      return { tipo: "papel", resposta: `🧠 Papéis combinados: ${validos.join(" + ")}. Pode mandar!` };
    }
    return { tipo: "erro", resposta: "❌ Perfis não reconhecidos. Confirme os nomes?" };
  }

  return null;
}

app.use("/audio", express.static(path.join(__dirname, "public/audio")));
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ===== MongoDB Globals =====
let db = null;
let mongoClientInstance = null;
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

async function sendMessage(to, message) {
  if (!message) message = "⚠️ Sem conteúdo de retorno.";

  try {
    await axios.post(
      `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_ID}/messages`,
      { messaging_product: "whatsapp", to, text: { body: message } },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
    );
    console.log("📤 Enviado WhatsApp:", message.trim());
  } catch (err) {
    console.error("❌ WhatsApp falhou:", err.response?.data || err.message);
  }
}

async function askGPT(messages) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: messages.filter((m) => typeof m.content === "string" && m.content.trim()),
      max_tokens: 300
    });

    return String(completion.choices?.[0]?.message?.content || "");
  } catch (err) {
    console.warn("⚠️ OpenAI falhou:", err?.message || err);
    return "Pensando...";
  }
}

async function connectMongo() {
  if (db) return db;

  try {
    if (!MONGO_URI) throw new Error("MONGO_URI ausente");

    console.log("🔹 Conectando ao banco...");
    const client = await MongoClient.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 });

    mongoClientInstance = client;
    db = client.db("donna");
    console.log("✅ Conexão Mongo estabelecida.");

    startReminderCron(db, sendMessage);
    return db;
  } catch (err) {
    console.error("❌ Falha conexão Mongo:", err?.message || err);
    return null;
  }
}

connectMongo();

// ===== Cron job para lembretes (Mongoose Model) =====
cron.schedule("* * * * *", async () => {
  try {
    await connectMongo();
    const now = new Date();
    const reminders = await Reminder.find({ date: { $lte: now }, sent: false }).lean();

    console.log(`⏰ Buscando lembretes no Model Reminder <= ${now.toISOString()}`);

    if (!reminders.length) {
      console.log("🔹 Nenhum lembrete pendente (Model Reminder).");
      return;
    }

    for (const r of reminders) {
      await sendMessage(r.from, `⏰ Lembrete: ${r.text} (agendado para ${r.date.toLocaleString("pt-BR")})`);
      await Reminder.updateOne({ _id: r._id }, { $set: { sent: true, disparadoEm: new Date() } });
    }
  } catch (err) {
    console.error("❌ Falha cron lembretes Model:", err?.message || err);
  }
});

// ===== Webhook =====
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!entry) return res.sendStatus(200);

    const from = entry.from;
    let body = "";

    if (!numerosAutorizados.includes(from)) {
      console.log("⛔ Número bloqueado:", from);
      return res.sendStatus(200);
    }

    if (entry.type === "text") {
      body = entry.text.body;
    } else if (entry.type === "audio") {
      const audioBuffer = await downloadMedia(entry.audio.id);
      body = audioBuffer ? await falar(audioBuffer) : "❌ Falha transcrição.";
    } else if (entry.type === "document") {
      const pdfBuffer = await downloadMedia(entry.document.id);
      const pdfPath = path.join(__dirname, "src/utils/pdfs", entry.document.filename);
      fs.writeFileSync(pdfPath, pdfBuffer);
      await sendMessage(from, `✅ Documento salvo: ${entry.document.filename}`);
      return res.sendStatus(200);
    } else {
      await sendMessage(from, "Formato não compatível.");
      return res.sendStatus(200);
    }

    body = body.trim();
    await salvarMemoria(from, { ultimaMensagem: body });
    const memoria = await buscarMemoria(from);

    const messages = [
      { role: "system", content: "Você é a Donna, assistente pessoal do Rafael, use respostas curtas e diretas." },
      ...(memoria?.memoria ? Object.entries(memoria.memoria).map(([k,v]) => ({ role: "assistant", content: `${k}: ${v}` })) : []),
      { role: "user", content: body }
    ];

    const reply = await askGPT(messages);
    await salvarMemoria(from, { ultimaResposta: reply });
    await sendMessage(from, reply.trim());

    return res.sendStatus(200);
  } catch (err) {
    console.error("🔥 Webhook erro:", err?.message || err);
    return res.sendStatus(500);
  }
});

// ===== Iniciar servidor =====
app.listen(PORT, () => console.log(`✅ Servidor ativo na porta ${PORT}`));

module.exports = {
  askGPT,
  connectMongo,
  sendMessage,
  verificarComandoProfissao,
  salvarMemoria,
  buscarMemoria,
  limparMemoria,
  buscarPergunta,
  funcoesExtras,
  treinarDonna,
  obterResposta,
  setPapeis,
  clearPapeis,
  falar,
  sendAudio,
  getWeather,
  getDB: () => db
};
