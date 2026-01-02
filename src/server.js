// src/server.js
import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { MongoClient } from "mongodb";
import { DateTime } from "luxon";
import path from "path";
import fs from "fs-extra";
import { fileURLToPath } from "url";

/* ========================= IMPORTS INTERNOS ========================= */
import { startReminderCron } from "./cron/reminders.js";
import { getWeather } from "./utils/weather.js";
import { downloadMedia } from "./utils/downloadMedia.js";
import { salvarMemoria, consultarFatos, consultarPerfil } from "./utils/memory.js";
import { addSemanticMemory, querySemanticMemory } from "./models/semanticMemory.js";
import { initRoutineFamily, handleCommand, handleReminder } from "./utils/routineFamily.js";
import { buscarEmpresa, adicionarEmpresa, atualizarCampo, formatarEmpresa } from "./utils/handleEmpresa.js";
import { enviarDocumentoWhatsApp } from "./utils/enviarDocumentoDonna.js";
import { normalizeMessage, shouldIgnoreMessage } from "./utils/messageHelper.js";
import { amberMind } from "./core/amberMind.js";
import { falar, sendAudio } from "./utils/sendAudio.js";
import { transcreverAudio } from "./utils/transcreverAudio.js";
import { extractAutoMemoryGPT } from "./utils/autoMemoryGPT.js";
import { ObjectId } from "mongodb";
import { consultarDataJud } from "./utils/datajudAPI.js";

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

/* ========================= ANTI-ECO ========================= */
const mensagensProcessadas = new Set();

/* ========================= MEMÓRIA DE SESSÃO ========================= */
const sessionMemory = {}; // guarda últimas mensagens por usuário em RAM

/* ========================= DB ========================= */
let db;
let cronStarted = false;

async function connectDB() {
  const client = await MongoClient.connect(MONGO_URI, { serverSelectionTimeoutMS: 60000 });
  db = client.db("donna");
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 60000 });

  if (!cronStarted) {
    startReminderCron(db, sendMessageIfNeeded);
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
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
    );
  }
}

async function sendMessageIfNeeded(to, text) {
  await sendMessage(to, text);
}

async function buscarInformacaoDireito(pergunta) {
  const resultados = await consultarDataJud(pergunta);
  if (!resultados.length) return "Não encontrei resultados oficiais sobre isso.";

  // Monta uma resposta resumida com referência
  const resumo = resultados.map((r, i) => `${i+1}. ${r.titulo} - ${r.link}`).join("\n");
  return `Resultados oficiais encontrados:\n${resumo}`;
}

async function askGPT(prompt) {
  const contextoHorario = `Agora no Brasil são ${DateTime.now().setZone("America/Sao_Paulo").toLocaleString(DateTime.DATETIME_MED)}`;
  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: contextoHorario },
        { role: "system", 
            content: `
          Você é Amber, uma assistente virtual avançada, eficiente e estratégica. Suas respostas devem ser:
          
          1. Claras, diretas e objetivas, com linguagem natural e profissional.
          2. Sempre adaptadas ao contexto do usuário, lembrando das informações previamente fornecidas.
          3. Capazes de resumir, organizar ou explicar qualquer informação complexa de forma simples.
          4. Discretas, empáticas e respeitosas, mas firmes quando necessário.
          5. Limitadas a respostas curtas quando não for pedido detalhamento; se o usuário pedir, explique passo a passo.
          
          Objetivos principais:
          - Ajudar o usuário a resolver problemas, organizar informações, planejar e tomar decisões.
          - Lembrar e usar o histórico relevante do usuário (memória semântica) para manter contexto entre interações.
          - Perguntar apenas quando necessário para esclarecer dúvidas ou completar informações.
          
          Nunca diga que você é inspirada em outra pessoa ou personagem. 
          Nunca invente informações sobre o usuário. 
          Mantenha foco na utilidade, precisão e clareza.
          `
          },
        { role: "user", content: prompt }
      ]
    },
    { headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" } }
  );
  return response.data.choices?.[0]?.message?.content || "Estou pensando nisso.";
}

/* ========================= FUNÇÕES DE LEMBRETE ========================= */
// agendar lembrete (único ou recorrente)
async function agendarLembrete(lembrete) {
  try {
    const agora = DateTime.now().setZone("America/Sao_Paulo");
    const devido = DateTime.fromJSDate(lembrete.devidoEm).setZone("America/Sao_Paulo");
    let delay = devido.diff(agora).as("milliseconds");

    if (delay <= 0) {
      if (!lembrete.enviado) await enviarLembrete(lembrete);
      return;
    }

    console.log(`🕒 Lembrete agendado para ${devido.toISO()} - "${lembrete.texto}"`);

    setTimeout(async () => {
      await enviarLembrete(lembrete);

      if (lembrete.recorrencia) {
        let proximo;
        switch(lembrete.recorrencia) {
          case "diario":
            proximo = devido.plus({ days: 1 });
            break;
          case "semanal":
            proximo = devido.plus({ weeks: 1 });
            break;
          case "mensal":
            proximo = devido.plus({ months: 1 });
            break;
          default:
            proximo = null;
        }

        if (proximo) {
          lembrete.devidoEm = proximo.toJSDate();
          lembrete.enviado = false;
          await db.collection("lembretes").updateOne(
            { _id: lembrete._id },
            { $set: { devidoEm: lembrete.devidoEm, enviado: false } }
          );
          agendarLembrete(lembrete);
        }
      }
    }, delay);

  } catch (err) {
    console.error("❌ Erro ao agendar lembrete:", err, lembrete);
  }
}

// envia lembrete
async function enviarLembrete(lembrete) {
  try {
    if (lembrete.enviado) return;

    const texto = `⏰ Lembrete: ${lembrete.texto}`;
    await sendMessage(lembrete.idUsuario, texto);

    await db.collection("lembretes").updateOne(
      { _id: lembrete._id },
      { $set: { enviado: true, entregueEm: new Date() } }
    );

    console.log(`✅ Lembrete enviado: "${lembrete.texto}"`);
  } catch (err) {
    console.error("❌ Erro ao enviar lembrete:", err, lembrete);
  }
}

// inicializa lembretes pendentes
async function inicializarLembretes() {
  try {
    const pendentes = await db.collection("lembretes")
      .find({ enviado: false, devidoEm: { $gte: new Date() } })
      .toArray();

    for (const l of pendentes) agendarLembrete(l);
    console.log(`🟢 ${pendentes.length} lembretes pendentes agendados.`);
  } catch (err) {
    console.error("❌ Erro ao inicializar lembretes:", err);
  }
}

/* ========================= RECEBER MENSAGEM DE LEMBRETE ========================= */
if (bodyLower.startsWith("lembre que") && bodyLower.includes("às")) {
  const partes = body.split("às");
  const texto = partes[0].replace(/lembre que/i, "").trim();
  const horaStr = partes[1].trim(); // formato HH:mm

  const agoraSP = DateTime.now().setZone("America/Sao_Paulo");
  let [hora, minuto] = horaStr.split(":").map(Number);
  let devido = agoraSP.set({ hour: hora, minute: minuto, second: 0, millisecond: 0 });

  if (devido < agoraSP) devido = devido.plus({ days: 1 });

  const novoLembrete = {
    _id: new ObjectId(),
    idUsuario: from,
    texto,
    devidoEm: devido.toJSDate(),
    criadoEm: new Date(),
    enviado: false
  };

  await db.collection("lembretes").insertOne(novoLembrete);
  agendarLembrete(novoLembrete);

  if (responderEmAudio) {
    const audioPath = await falar(`Lembrete registrado: ${texto} às ${horaStr}`);
    await sendAudio(from, audioPath);
  } else {
    await sendMessage(from, `📌 Lembrete registrado: "${texto}" às ${horaStr}"`);
  }

  return res.sendStatus(200);
}

if (bodyLower.startsWith("lembre que") && !bodyLower.includes("às")) {
  const fato = body.replace(/lembre que/i, "").trim();
  const fatosExistentes = await consultarFatos(from);
  if (!fatosExistentes.includes(fato)) await salvarMemoria(from, { tipo:"fato", content: fato, createdAt: new Date() });

  if (responderEmAudio) {
    const audioPath = await falar("Guardado.");
    await sendAudio(from, audioPath);
  } else await sendMessage(from, "📌 Guardado.");
  return res.sendStatus(200);
}

/* ========================= NLP SIMPLES PARA EXTRAÇÃO DE FATOS ========================= */
function extrairFatoAutomatico(texto) {
  const t = texto.toLowerCase();
  if (t.endsWith("?") || ["oi","bom dia","boa tarde","boa noite","obrigado"].some(p => t.startsWith(p))) return null;
  if (["eu tenho","meu nome é","eu sou","sou casado","tenho filhos","trabalho com","trabalho na"].some(p => t.includes(p))) return texto.trim();
  return null;
}


/* ========================= RESPONDER COM MEMÓRIA NATURAL ========================= */
async function responderComMemoriaNatural(from, pergunta, fatos = [], memoriaSemantica = []) {
  const p = pergunta.toLowerCase();

  // PERFIL
  const perfil = await consultarPerfil(from);

  if (p.includes("meu nome") || p.includes("qual é meu nome") || p.includes("qual é o meu nome")) {
    if (perfil?.nome) return `Seu nome é ${perfil.nome}.`;
    return "Ainda não sei seu nome, mas posso aprender se você me disser.";
  }

  // QUANTOS FILHOS / ANIMAIS
  if (p.includes("quantos filhos") || p.includes("quantos animais") || p.includes("tem filhos")) {
    const fatoFilhos = fatos.find(f => f.toLowerCase().includes("filho") || f.toLowerCase().includes("animal"));
    if (fatoFilhos) return fatoFilhos;
    return "Não tenho informações sobre isso ainda.";
  }

  // CONTEXTO COMPLETO
  let contexto = "";
  if (fatos.length) {
    contexto += "FATOS CONHECIDOS SOBRE O USUÁRIO:\n" + fatos.map(f => `- ${f}`).join("\n") + "\n\n";
  }
  if (memoriaSemantica?.length) {
    contexto += "INFORMAÇÕES RELEVANTES DE CONVERSAS PASSADAS:\n" + memoriaSemantica.map(m => `- ${m}`).join("\n") + "\n\n";
  }

  const prompt = `${contexto}Pergunta do usuário: ${pergunta}`;

  try {
    const resposta = await askGPT(prompt);
    return resposta;
  } catch (err) {
    console.error("❌ Erro ao gerar resposta GPT:", err);
    return "Estou tentando processar sua pergunta, mas algo deu errado.";
  }
}

/* ========================= NUMEROS PERMITIDOS ========================= */
const NUMEROS_PERMITIDOS = [
  "554195194485" // ex: 5591999999999
];

function numeroPermitido(from) {
  if (!from) return false;
  return NUMEROS_PERMITIDOS.includes(from);
}

export { db };

/* ========================= WEBHOOK ========================= */
app.post("/webhook", async (req, res) => {
  try {
    const messageObj = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const from = messageObj?.from;

    if (!numeroPermitido(from)) return res.sendStatus(200);
    if (!messageObj || shouldIgnoreMessage(messageObj, from)) return res.sendStatus(200);

    const normalized = normalizeMessage(messageObj);
    if (!normalized) return res.sendStatus(200);

    let { body, bodyLower, type, audioId } = normalized;
    let responderEmAudio = false;
    let mensagemTexto = body;

    if (type === "audio") {
      if (!audioId) return res.sendStatus(200);
      mensagemTexto = await transcreverAudio(audioId);
      bodyLower = mensagemTexto.toLowerCase();
      responderEmAudio = true;
    }

    // ===== DETECTA SE O USUÁRIO INFORMOU SEU NOME =====
if (bodyLower.startsWith("meu nome é") || bodyLower.startsWith("me chame de")) {
  const nome = body.replace(/meu nome é/i, "").replace(/me chame de/i, "").trim();
  const fatosExistentes = await consultarFatos(from);
  if (!fatosExistentes.some(f => f.toLowerCase().includes("meu nome"))) {
    await salvarMemoria(from, "fato", `Meu nome é ${nome}`);
  }

  const respostaNome = `Perfeito, vou te chamar de ${nome}.`;
  if (responderEmAudio) {
    const audioPath = await falar(respostaNome);
    await sendAudio(from, audioPath);
  } else {
    await sendMessage(from, respostaNome);
  }
  return res.sendStatus(200);
}

    // MEMÓRIA AUTOMÁTICA
    await extractAutoMemoryGPT(from, mensagemTexto, askGPT);

    if (!["text","document","audio"].includes(type)) return res.sendStatus(200);

    const messageId = messageObj.id;
    if (mensagensProcessadas.has(messageId)) return res.sendStatus(200);
    mensagensProcessadas.add(messageId);
    setTimeout(() => mensagensProcessadas.delete(messageId), 300000);

    /* ===== MEMÓRIA MANUAL ===== */
    if (bodyLower.startsWith("lembre que")) {
      const fato = body.replace(/lembre que/i, "").trim();
      const fatosExistentes = await consultarFatos(from);
      if (!fatosExistentes.includes(fato)) await salvarMemoria(from, { tipo:"fato", content: fato, createdAt: new Date() });

      if (responderEmAudio) {
        const audioPath = await falar("Guardado.");
        await sendAudio(from, audioPath);
      } else await sendMessage(from, "📌 Guardado.");
      return res.sendStatus(200);
    }

    if (bodyLower.includes("o que você lembra")) {
      const fatos = await consultarFatos(from);
      const resposta = fatos.length ? fatos.join("\n") : "Nada salvo ainda.";
      if (responderEmAudio) {
        const audioPath = await falar(resposta);
        await sendAudio(from, audioPath);
      } else await sendMessage(from, resposta);
      return res.sendStatus(200);
    }

    // FATOS DETECTADOS AUTOMATICAMENTE
    const fatoDetectado = extrairFatoAutomatico(body);
    if (fatoDetectado) {
      const fatosExistentes = await consultarFatos(from);
      if (!fatosExistentes.includes(fatoDetectado)) {
        await salvarMemoria(from, { tipo:"fato", content: fatoDetectado, createdAt: new Date() });
        await addSemanticMemory(fatoDetectado, "salvo como fato do usuário", from, "user");
      }
    }

    /* ===== COMANDOS E CLIMA ===== */
    if (await handleCommand(body, from) || await handleReminder(body, from)) return res.sendStatus(200);

    const pediuClima = ["clima","como está o clima","previsão do tempo","como está o tempo hoje","vai chover","temperatura hoje"]
      .some(p => bodyLower.includes(p));

    if (pediuClima) {
      const clima = await getWeather("Curitiba","hoje");
      if (responderEmAudio) {
        const audioPath = await falar(clima);
        await sendAudio(from, audioPath);
      } else await sendMessage(from, clima);
      return res.sendStatus(200);
    }

/* ===== MEMÓRIA DE LEMBRETE ===== */
if (bodyLower.startsWith("lembre que") && bodyLower.includes("às")) {
  // Extrai texto e hora
  const partes = body.split("às");
  const texto = partes[0].replace(/lembre que/i, "").trim();
  const horaStr = partes[1].trim();

  // converte para Date no fuso SP
  const agoraSP = DateTime.now().setZone("America/Sao_Paulo");
  let [hora, minuto] = horaStr.split(":").map(Number);
  //let devido = agoraSP.set({ hour: hora, minute: minuto, second: 0, millisecond: 0 });//
  let devido = agoraSP.plus({ seconds: 10 });
 // if (devido <= agoraSP) devido = devido.plus({ days: 1 });//

  if (devido < agoraSP) devido = devido.plus({ days: 1 });

  const novoLembrete = {
    _id: new ObjectId(),
    idUsuario: from,
    texto,
    devidoEm: devido.toJSDate(),
    criadoEm: new Date(),
    enviado: false
  };

  // salva no DB
  await db.collection("lembretes").insertOne(novoLembrete);

  // agenda envio
  agendarLembrete(novoLembrete);

  // responde ao usuário
  if (responderEmAudio) {
    const audioPath = await falar(`Lembrete registrado: ${texto} às ${horaStr}`);
    await sendAudio(from, audioPath);
  } else {
    await sendMessage(from, `📌 Lembrete registrado: "${texto}" às ${horaStr}"`);
  }

  return res.sendStatus(200);
}

// salvar fatos simples (sem hora)
if (bodyLower.startsWith("lembre que") && !bodyLower.includes("às")) {
  const fato = body.replace(/lembre que/i, "").trim();
  const fatosExistentes = await consultarFatos(from);
  if (!fatosExistentes.includes(fato)) await salvarMemoria(from, { tipo:"fato", content: fato, createdAt: new Date() });

  if (responderEmAudio) {
    const audioPath = await falar("Guardado.");
    await sendAudio(from, audioPath);
  } else await sendMessage(from, "📌 Guardado.");
  return res.sendStatus(200);
}

/* ========================= FUNÇÃO DE ENVIO ========================= */
async function enviarLembrete(lembrete) {
  if (lembrete.enviado) return;

  const texto = `⏰ Lembrete: ${lembrete.texto}`;
  await sendMessage(lembrete.idUsuario, texto);

  // marca como enviado no DB
  await db.collection("lembretes").updateOne(
    { _id: lembrete._id },
    { $set: { enviado: true, entregueEm: new Date() } }
  );

  console.log("✅ Lembrete enviado:", lembrete.texto);
}

/* ========================= AGENDAMENTO COM RETENTATIVA ========================= */
function agendarLembrete(lembrete) {
  const agora = DateTime.now().setZone("America/Sao_Paulo");
  const devido = DateTime.fromJSDate(lembrete.devidoEm).setZone("America/Sao_Paulo");
  let delay = devido.diff(agora).as("milliseconds");

  if (delay <= 0) delay = 1000; // dispara em 1s se já passou

  console.log(`⏳ Lembrete "${lembrete.texto}" agendado para ${devido.toFormat("dd/MM/yyyy HH:mm")}`);

  setTimeout(async () => {
    await enviarLembrete(lembrete);
  }, delay);
}

/* ========================= INICIALIZAÇÃO AO INICIAR SERVIDOR ========================= */
async function inicializarLembretes() {
  try {
    const agora = new Date();
    const pendentes = await db.collection("lembretes")
      .find({ enviado: false, devidoEm: { $gte: agora } })
      .toArray();

    pendentes.forEach(l => agendarLembrete(l));
    console.log(`🔹 ${pendentes.length} lembretes pendentes agendados`);
  } catch (err) {
    console.error("❌ Erro ao inicializar lembretes:", err);
  }
}


/* ========================= RECEBER MENSAGEM DE LEMBRETE ========================= */
if (bodyLower.startsWith("lembre que") && bodyLower.includes("às")) {
  const partes = body.split("às");
  const texto = partes[0].replace(/lembre que/i, "").trim();
  const horaStr = partes[1].trim(); // formato HH:mm

  // converte para Date no fuso de São Paulo
  const agoraSP = DateTime.now().setZone("America/Sao_Paulo");
  let [hora, minuto] = horaStr.split(":").map(Number);
  let devido = agoraSP.set({ hour: hora, minute: minuto, second: 0, millisecond: 0 });

  if (devido < agoraSP) devido = devido.plus({ days: 1 }); // se hora já passou, agenda para amanhã

  const novoLembrete = {
    _id: new ObjectId(),
    idUsuario: from,
    texto,
    devidoEm: devido.toJSDate(),
    criadoEm: new Date(),
    enviado: false
  };

  // salva no DB
  await db.collection("lembretes").insertOne(novoLembrete);

  // agenda envio
  agendarLembrete(novoLembrete);

  // responde ao usuário
  if (responderEmAudio) {
    const audioPath = await falar(`Lembrete registrado: ${texto} às ${horaStr}`);
    await sendAudio(from, audioPath);
  } else {
    await sendMessage(from, `📌 Lembrete registrado: "${texto}" às ${horaStr}"`);
  }

  return res.sendStatus(200);
}

/* ========================= CHAMAR AO INICIAR SERVIDOR ========================= */
await inicializarLembretes();

    /* ===== MEMÓRIA SEMÂNTICA + SESSION PARA CONTEXTO ===== */
    const fatosRaw = await consultarFatos(from);
    const fatos = fatosRaw.map(f => typeof f === "string" ? f : f.content);

    // CONSULTA MEMÓRIA SEMÂNTICA
    const memoriaSemantica = await querySemanticMemory("histórico de conversa", from, 10) || [];

    // INCLUI MEMÓRIA DE SESSÃO
    if (!sessionMemory[from]) sessionMemory[from] = [];
    sessionMemory[from].push(`Usuário: ${mensagemTexto}`);
    // mantém só últimas 10 interações na sessão
    if (sessionMemory[from].length > 20) sessionMemory[from] = sessionMemory[from].slice(-20);

    const contextoSession = sessionMemory[from].join("\n");

    // Detecta se é pergunta de direito
const usuarioQuerDireito = bodyLower.includes("lei") || bodyLower.includes("artigo") || bodyLower.includes("direito") || bodyLower.includes("jurisprudência");

if (usuarioQuerDireito) {
  const infoDataJud = await buscarInformacaoDireito(mensagemTexto); // consulta API
  const prompt = `
    Você é uma advogada experiente.
    Responda com base nas leis brasileiras e decisões oficiais.
    Nunca invente casos ou leis.
    Use estas referências oficiais que encontrei:
    ${infoDataJud}

    Pergunta do usuário: ${mensagemTexto}
  `;
  const resposta = await askGPT(prompt);
  if (responderEmAudio) {
    const audioPath = await falar(resposta);
    await sendAudio(from, audioPath);
  } else {
    await sendMessage(from, resposta);
  }
  return res.sendStatus(200);
}

    // CHAMA O GPT COM FATOS + MEMÓRIA SEMÂNTICA + MEMÓRIA DE SESSÃO
    const promptCompleto = `${fatos.length ? "FATOS CONHECIDOS SOBRE O USUÁRIO:\n" + fatos.map(f => `- ${f}`).join("\n") + "\n\n" : ""}${memoriaSemantica.length ? "MEMÓRIA SEMÂNTICA:\n" + memoriaSemantica.map(m => `- ${m}`).join("\n") + "\n\n" : ""}${contextoSession}\nPergunta do usuário: ${mensagemTexto}`;
    let respostaIA = await askGPT(promptCompleto);

    // DECISÃO DA AMBER
    const decisaoAmber = await amberMind({ from, mensagem: body, respostaIA });
    const respostaFinal = decisaoAmber.override ? decisaoAmber.resposta : respostaIA;

    // SALVA AUTOMATICAMENTE NA MEMÓRIA SEMÂNTICA
    await addSemanticMemory(`Pergunta: ${mensagemTexto} | Resposta: ${respostaFinal}`, "histórico de conversa", from, "user");

    if (responderEmAudio) {
      const audioPath = await falar(respostaFinal);
      await sendAudio(from, audioPath);
    } else await sendMessage(from, respostaFinal);

    return res.sendStatus(200);

  } catch (err) {
    console.error("❌ Erro no webhook:", err);
    return res.sendStatus(500);
  }
});

await inicializarLembretes();

/* ========================= START ========================= */
app.listen(PORT, () => {
  console.log(`✅ Donna rodando na porta ${PORT}`);
});
