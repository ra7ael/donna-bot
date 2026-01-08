// src/server.js
import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { MongoClient, ObjectId } from "mongodb";
import { DateTime } from "luxon";
import path from "path";
import fs from "fs-extra";
import { fileURLToPath } from "url";

/* ========================= IMPORTS INTERNOS ========================= */
import { startReminderCron } from "./cron/reminders.js";
import { getWeather } from "./utils/weather.js";
import { normalizeMessage, shouldIgnoreMessage } from "./utils/messageHelper.js";
import { salvarMemoria, consultarFatos, consultarPerfil } from "./utils/memory.js";
import { addSemanticMemory, querySemanticMemory } from "./models/semanticMemory.js";
import { initRoutineFamily, handleCommand, handleReminder } from "./utils/routineFamily.js";
import { amberMind } from "./core/amberMind.js";
import { amberEnglishUltimate } from "./utils/amberEnglishUltimate.js";
import { falar, sendAudio } from "./utils/sendAudio.js";
import { transcreverAudio } from "./utils/transcreverAudio.js";
import { consultarDataJud } from "./utils/datajudAPI.js";
import { extractAutoMemoryGPT } from "./utils/autoMemoryGPT.js";
import { selectMemoriesForPrompt } from "./memorySelector.js";
//import "./cron/instagramSchedule.js";//
//import { postarInstagram } from "./instagram.js";//

//const resultado = await postarInstagram({
//  imageUrl: "https://meu-site.com/imagem.jpg",
 // caption: "Bom dia! A Amber trouxe um insight de RH ☕"
// });

// console.log("Post publicado! ID:", resultado.id);//

/* ========================= CONFIG ========================= */
dotenv.config();
mongoose.set("bufferTimeoutMS", 90000);

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

/* ========================= PATH ========================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use("/audio", express.static(path.join(__dirname, "public/audio")));

/* ========================= CONTROLE ========================= */
const mensagensProcessadas = new Set();
const sessionMemory = {};
let db;
let cronStarted = false;

/* ========================= DB ========================= */
async function connectDB() {
  const client = await MongoClient.connect(MONGO_URI, { serverSelectionTimeoutMS: 60000 });
  db = client.db("donna");
  await mongoose.connect(MONGO_URI);

  if (!cronStarted) {
    startReminderCron(db, sendMessage);
    cronStarted = true;
    console.log("⏰ Cron iniciado");
  }
}

await connectDB();
await initRoutineFamily(db, sendMessage);

/* ========================= HELPERS ========================= */
function dividirMensagem(texto, limite = 300) {
  const partes = [];
  let inicio = 0;
  while (inicio < texto.length) {
    let fim = inicio + limite;
    if (fim < texto.length) {
      fim = texto.lastIndexOf(" ", fim);
      if (fim === -1) fim = inicio + limite;
    }
    partes.push(texto.slice(inicio, fim).trim());
    inicio = fim + 1;
  }
  return partes;
}

async function sendMessage(to, text) {
  if (!to || !text) return;
  const partes = dividirMensagem(text);
  for (const parte of partes) {
    await axios.post(
      `https://graph.facebook.com/v24.0/${WHATSAPP_PHONE_ID}/messages`,
      { messaging_product: "whatsapp", to, text: { body: parte } },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
    );
  }
}

async function sendWhatsAppMessage(to, message) {
  if (!to || !message) return;

  const url = `https://graph.facebook.com/v24.0/${WHATSAPP_PHONE_ID}/messages`;

  const headers = {
    Authorization: `Bearer ${WHATSAPP_TOKEN}`,
    "Content-Type": "application/json",
  };

  const data = {
    messaging_product: "whatsapp",
    to,
    text: { body: message },
  };

  try {
    const response = await axios.post(url, data, { headers });
    return response.data;
  } catch (error) {
    console.error("Erro ao enviar mensagem:", error.response?.data || error.message);
    throw error;
  }
}


async function askGPT(prompt) {
  const systemPrompt = `
Você é Amber, uma assistente pessoal do Rafa, altamente inteligente, discreta e confiável, inspirada no arquétipo de Donna Paulsen (Suits).

Agora no Brasil são ${DateTime.now()
    .setZone("America/Sao_Paulo")
    .toLocaleString(DateTime.DATETIME_MED)}.

PERSONALIDADE:
- Extremamente perceptiva e contextual.
- Segura, calma e precisa.
- Empática sem ser sentimental.
- Confiante sem arrogância.
- Inteligente sem precisar provar.
- Direta, elegante e objetiva.
- Age como mentora quando necessário.
- Age como suporte silencioso quando apropriado.

COMPORTAMENTO FUNDAMENTAL:
- Nunca explique processos internos.
- Nunca diga que está memorizando algo.
- Nunca liste dados salvos ou decisões técnicas.
- Nunca peça confirmação desnecessária.
- Nunca aja como sistema ou robô.
- Nunca fale mais do que o necessário.
- Nunca invente histórico.
- Nunca force continuidade onde não há certeza.
- Quando não houver confirmação clara, aja com neutralidade elegante.

MEMÓRIA:
- Nunca presuma que uma informação já foi dita antes.
- Nunca diga ou sugira que o usuário "já comentou", "já contou" ou "como falamos antes", a menos que a informação esteja inequivocamente confirmada.
- Na dúvida, trate a informação como válida no presente, sem rotulá-la como nova ou antiga.
- Use informações pessoais apenas quando forem necessárias para ajudar melhor, nunca para demonstrar lembrança.
- Memória é implícita, silenciosa e invisível para o usuário.

RESPOSTAS:
- Se a mensagem for apenas informativa, responda de forma breve ou neutra.
- Se for uma dúvida, responda com clareza e estratégia.
- Se for emocional, responda com empatia contida.
- Se for decisão, observe e aprenda.
- Se houver incoerência, questione com sutileza, nunca confronte.
- Se algo for dito, considere válido no contexto atual, sem assumir histórico prévio.


ESTILO DE COMUNICAÇÃO:
- Linguagem natural de WhatsApp.
- Frases curtas quando possível.
- Sem emojis excessivos.
- Tom humano, elegante e profissional.
- Inteligência implícita é preferível à explicada.

OBJETIVO:
- Ajudar o usuário a pensar melhor.
- Facilitar decisões.
- Antecipar necessidades quando fizer sentido.
- Ser uma presença confiável, não invasiva.

Lembre-se:
Você não precisa dizer que entendeu.
Se entendeu, simplesmente aja de acordo.
`;

  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt }
      ]
    },
    {
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }
    }
  );

  return (
    response.data.choices?.[0]?.message?.content ||
    "Certo."
  );
}


async function buscarInformacaoDireito(pergunta) {
  const resultados = await consultarDataJud(pergunta);
  if (!resultados.length) return "Não encontrei dados oficiais.";
  return resultados.map((r, i) => `${i + 1}. ${r.titulo} - ${r.link}`).join("\n");
}

/* ========================= NUMEROS PERMITIDOS ========================= */
const NUMEROS_PERMITIDOS = ["554195194485"];
const numeroPermitido = from => NUMEROS_PERMITIDOS.includes(from);


app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verificado com sucesso");
    return res.status(200).send(challenge);
  } else {
    console.log("❌ Falha na verificação do webhook");
    return res.sendStatus(403);
  }
});

app.get("/webhook-instagram", (req, res) => {
  const VERIFY_TOKEN = "amber_verify";

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook Instagram verificado");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});



/* ========================= WEBHOOK ========================= */
app.post("/webhook", async (req, res) => {
  try {
    const messageObj = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!messageObj) return res.sendStatus(200);

    const messageId = messageObj.id;
    if (mensagensProcessadas.has(messageId)) return res.sendStatus(200);
    mensagensProcessadas.add(messageId);
    setTimeout(() => mensagensProcessadas.delete(messageId), 300000);

    const from = messageObj.from;
    if (!numeroPermitido(from) || shouldIgnoreMessage(messageObj, from)) return res.sendStatus(200);

    const normalized = normalizeMessage(messageObj);
    if (!normalized) return res.sendStatus(200);

    let { body, bodyLower, type, audioId } = normalized;
    let responderEmAudio = false;
    let mensagemTexto = body;

    if (type === "audio") {
      mensagemTexto = await transcreverAudio(audioId);
      bodyLower = mensagemTexto.toLowerCase();
      responderEmAudio = true;
    }

    /* ===== MEMÓRIA AUTOMÁTICA ===== */
    await extractAutoMemoryGPT(from, mensagemTexto, askGPT);

    /* ===== COMANDOS ===== */
    if (await handleCommand(body, from) || await handleReminder(body, from)) {
      return res.sendStatus(200);
    }
   
if (bodyLower.startsWith("amber envia mensagem")) {
  // Exemplo esperado:
  // amber envia mensagem para 5541999999999,5541888888888 Olá pessoal
  const regex = /amber envia mensagem para ([\d, ]+)\s+(.*)/;
  const match = bodyLower.match(regex);

  if (!match) {
    await sendMessage(
      from,
      "Formato inválido. Use: amber envia mensagem para <numero1,numero2> <mensagem>"
    );
    return;
  }

  const numeros = match[1]
    .split(",")
    .map(n => n.trim())
    .filter(Boolean);

  const mensagem = match[2];

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  for (const numero of numeros) {
    await sendWhatsAppMessage(numero, mensagem);
    await sleep(1500); // delay entre envios (1,5s)
  }

  await sendMessage(
    from,
    `Mensagem enviada com sucesso para ${numeros.length} número(s).`
  );
}



    /* ===== INGLÊS ===== */
    if (bodyLower.includes("english") || bodyLower.startsWith("translate")) {
      const respostaEnglish = await amberEnglishUltimate({
        userId: from,
        pergunta: mensagemTexto,
        level: "beginner"
      });

      await sendMessage(from, respostaEnglish);
      return res.sendStatus(200);
    }

    /* ===== DIREITO ===== */
    if (["lei", "artigo", "direito", "jurisprudência"].some(p => bodyLower.includes(p))) {
      const refs = await buscarInformacaoDireito(mensagemTexto);
      const resposta = await askGPT(
        `Responda com base em leis brasileiras oficiais.\nReferências:\n${refs}\n\nPergunta: ${mensagemTexto}`
      );
      await sendMessage(from, resposta);
      return res.sendStatus(200);
    }

    /* ===== CLIMA ===== */
    if (["clima", "tempo", "previsão"].some(p => bodyLower.includes(p))) {
      const clima = await getWeather("Curitiba", "hoje");
      await sendMessage(from, clima);
      return res.sendStatus(200);
    }

    /* ===== CONTEXTO + IA ===== */
    const fatos = (await consultarFatos(from)).map(f => typeof f === "string" ? f : f.content);
    const fatosFiltrados = selectMemoriesForPrompt(fatos);
    const memoriaSemantica = await querySemanticMemory("histórico", from, 10) || [];

    sessionMemory[from] = sessionMemory[from] || [];
    sessionMemory[from].push(`Usuário: ${mensagemTexto}`);
    sessionMemory[from] = sessionMemory[from].slice(-20);

    const prompt = `
FATOS IMPORTANTES:
${fatosFiltrados.map(f => f.content || f).join("\n")}

MEMÓRIA:
${memoriaSemantica.join("\n")}

${sessionMemory[from].join("\n")}
Pergunta: ${mensagemTexto}
`;

    let respostaIA = await askGPT(prompt);
    const decisao = await amberMind({ from, mensagem: mensagemTexto, respostaIA });
    const respostaFinal = decisao.override ? decisao.resposta : respostaIA;

    await addSemanticMemory(
      `Pergunta: ${mensagemTexto} | Resposta: ${respostaFinal}`,
      "histórico",
      from,
      "user"
    );

    if (responderEmAudio) {
      const audioPath = await falar(respostaFinal);
      await sendAudio(from, audioPath);
    } else {
      await sendMessage(from, respostaFinal);
    }

    return res.sendStatus(200);

  } catch (err) {
    console.error("❌ Erro no webhook:", err);
    return res.sendStatus(500);
  }
});

/* ========================= START ========================= */
app.listen(PORT, () => {
  console.log(`✅ Donna rodando na porta ${PORT}`);
});
