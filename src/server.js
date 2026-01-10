// src/server.js
import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import dotenv from "dotenv";
import mongoose from "mongoose";
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
// IMPORTANTE: Importamos o modelo de sessão aqui
import { Session } from "./models/session.js";

/* ========================= CONFIG ========================= */
dotenv.config();
mongoose.set("strictQuery", false); // Evita warnings do Mongoose

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

// Garante que a pasta de áudio existe para não quebrar no deploy
fs.ensureDirSync(path.join(__dirname, "public/audio"));
app.use("/audio", express.static(path.join(__dirname, "public/audio")));

/* ========================= CONTROLE ========================= */
const mensagensProcessadas = new Set();
// REMOVIDO: const sessionMemory = {}; (Agora usamos o MongoDB)
let db; // Referência para o driver nativo extraído do Mongoose
let cronStarted = false;

/* ========================= DB ========================= */
async function connectDB() {
  try {
    // Conexão unificada via Mongoose
    await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 30000,
    });
    
    console.log("🔥 MongoDB Conectado (Mongoose)");
    
    // Extrai o driver nativo da conexão já estabelecida
    db = mongoose.connection.db;

    if (!cronStarted) {
      startReminderCron(db, sendMessage);
      cronStarted = true;
      console.log("⏰ Cron iniciado");
    }
  } catch (error) {
    console.error("❌ Erro fatal ao conectar no DB:", error);
    process.exit(1); // Encerra o app se não tiver banco, para o Render reiniciar
  }
}

// Inicialização
await connectDB();
// Passamos a função unificada sendMessage
await initRoutineFamily(db, sendMessage);

/* ========================= HELPERS ========================= */
function dividirMensagem(texto, limite = 1500) { // WhatsApp aceita ~4096, 1500 é seguro
  if (!texto) return [];
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

// Função Unificada de Envio (Substitui as duas anteriores)
async function sendMessage(to, text) {
  if (!to || !text) return;
  
  // Normaliza para string caso venha objeto
  const mensagemFinal = typeof text === 'string' ? text : JSON.stringify(text);
  const partes = dividirMensagem(mensagemFinal);

  try {
    for (const parte of partes) {
      await axios.post(
        `https://graph.facebook.com/v24.0/${WHATSAPP_PHONE_ID}/messages`,
        { 
          messaging_product: "whatsapp", 
          to, 
          text: { body: parte } 
        },
        { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
      );
    }
  } catch (error) {
    console.error(`Erro ao enviar msg para ${to}:`, error.response?.data || error.message);
  }
}

async function askGPT(prompt) {
  const systemPrompt = `
Você é Amber, uma assistente pessoal do Rafa, altamente inteligente, discreta e confiável, inspirada no arquétipo de Donna Paulsen (Suits).

Agora no Brasil são ${DateTime.now().setZone("America/Sao_Paulo").toLocaleString(DateTime.DATETIME_MED)}.

PERSONALIDADE:
- Extremamente perceptiva e contextual.
- Segura, calma e precisa.
- Empática sem ser sentimental.
- Confiante sem arrogância.
- Inteligente sem precisar provar.
- Direta, elegante e objetiva.

COMPORTAMENTO FUNDAMENTAL:
- Nunca explique processos internos ou que está "memorizando".
- Nunca invente histórico.
- Na dúvida, aja com neutralidade elegante.

OBJETIVO:
- Ajudar o usuário a pensar melhor e facilitar decisões.
`;

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini", 
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt }
        ],
        temperature: 0.7
      },
      {
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }
      }
    );

    return response.data.choices?.[0]?.message?.content || "Certo.";
  } catch (error) {
    console.error("Erro no GPT:", error.response?.data || error.message);
    return "Desculpe, tive um problema momentâneo de conexão mental.";
  }
}

async function buscarInformacaoDireito(pergunta) {
  try {
    const resultados = await consultarDataJud(pergunta);
    if (!resultados || !resultados.length) return "Não encontrei dados oficiais.";
    return resultados.map((r, i) => `${i + 1}. ${r.titulo} - ${r.link}`).join("\n");
  } catch (e) {
    console.error("Erro DataJud:", e);
    return "Erro ao consultar base jurídica.";
  }
}

/* ========================= ROTAS DE VERIFICAÇÃO ========================= */
// Rota Raiz para Health Check do Render
app.get("/", (req, res) => {
  res.status(200).send("Donna/Amber Online 🟢");
});

const NUMEROS_PERMITIDOS = ["554195194485"]; // Adicione outros se necessário
const numeroPermitido = from => NUMEROS_PERMITIDOS.includes(from);

app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verificado");
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

/* ========================= WEBHOOK POST ========================= */
app.post("/webhook", async (req, res) => {
  try {
    const messageObj = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!messageObj) return res.sendStatus(200);

    const messageId = messageObj.id;
    if (mensagensProcessadas.has(messageId)) return res.sendStatus(200);
    mensagensProcessadas.add(messageId);
    
    // Limpeza automática do cache de IDs
    setTimeout(() => mensagensProcessadas.delete(messageId), 300000);

    const from = messageObj.from;
    
    // Filtro de segurança e ignore
    if (!numeroPermitido(from) || shouldIgnoreMessage(messageObj, from)) {
        return res.sendStatus(200);
    }

    const normalized = normalizeMessage(messageObj);
    if (!normalized) return res.sendStatus(200);

    let { body, bodyLower, type, audioId } = normalized;
    let responderEmAudio = false;
    let mensagemTexto = body;

    // Processamento de Áudio
    if (type === "audio") {
      mensagemTexto = await transcreverAudio(audioId);
      if (!mensagemTexto) return res.sendStatus(200); // Falha na transcrição
      bodyLower = mensagemTexto.toLowerCase();
      responderEmAudio = true;
    }

    /* ===== MEMÓRIA AUTOMÁTICA ===== */
    // Executa em "background" (sem await) se quiser velocidade, mas aqui deixei await para garantir contexto
    await extractAutoMemoryGPT(from, mensagemTexto, askGPT);

    /* ===== 1. COMANDOS DE ROTINA ===== */
    if (await handleCommand(body, from) || await handleReminder(body, from)) {
      return res.sendStatus(200);
    }
   
    /* ===== 2. BROADCAST (ENVIO EM MASSA) ===== */
    // Regex flexível para: "Amber envia mensagem para X, Y msg" ou "Amber envia mensagem para X, Y: msg"
    if (bodyLower.startsWith("amber envia mensagem") || bodyLower.startsWith("amber, envia mensagem")) {
      const regex = /para\s+([\d,\s]+)[\s:]+(.*)/i;
      const match = bodyLower.match(regex);

      if (!match) {
        await sendMessage(from, "Formato: 'Amber envia mensagem para <numeros> <mensagem>'");
        return res.sendStatus(200);
      }

      const numeros = match[1].replace(/\s/g, "").split(",").filter(Boolean);
      const mensagemParaEnviar = match[2];

      await sendMessage(from, `Iniciando envio para ${numeros.length} contatos...`);

      // 🔥 EXTREMAMENTE IMPORTANTE:
      // Executamos o loop em background (sem await) para liberar o Webhook imediatamente.
      // Isso evita Timeout do WhatsApp.
      (async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms));
          for (const numero of numeros) {
            await sendMessage(numero, mensagemParaEnviar);
            await sleep(2000); // Pausa de 2s para evitar bloqueio por spam
          }
          await sendMessage(from, "✅ Envio em massa concluído.");
      })().catch(err => console.error("Erro no broadcast background:", err));

      return res.sendStatus(200); // Retorna OK para o WhatsApp imediatamente
    }

    /* ===== 3. INGLÊS ===== */
    if (bodyLower.includes("english") || bodyLower.startsWith("translate")) {
      const respostaEnglish = await amberEnglishUltimate({
        userId: from,
        pergunta: mensagemTexto,
        level: "beginner"
      });
      await sendMessage(from, respostaEnglish);
      return res.sendStatus(200); // IMPORTANTE: Return para parar execução
    }

    /* ===== 4. DIREITO ===== */
    if (["lei", "artigo", "direito", "jurisprudência"].some(p => bodyLower.includes(p))) {
      const refs = await buscarInformacaoDireito(mensagemTexto);
      const resposta = await askGPT(
        `Responda com base em leis brasileiras oficiais.\nReferências:\n${refs}\n\nPergunta: ${mensagemTexto}`
      );
      await sendMessage(from, resposta);
      return res.sendStatus(200);
    }

    /* ===== 5. CLIMA ===== */
    if (["clima", "tempo", "previsão"].some(p => bodyLower.includes(p))) {
      const clima = await getWeather("Curitiba", "hoje");
      await sendMessage(from, clima);
      return res.sendStatus(200);
    }

    /* ===== 6. CONTEXTO GERAL + IA (Fallback) ===== */
    const fatos = (await consultarFatos(from)).map(f => typeof f === "string" ? f : f.content);
    const fatosFiltrados = selectMemoriesForPrompt(fatos);
    const memoriaSemantica = await querySemanticMemory("histórico", from, 10) || [];

    // [MODIFICADO] Gerenciamento de sessão PERSISTENTE (MongoDB)
    let userSession = await Session.findOne({ userId: from });
    if (!userSession) {
      // Cria nova sessão se não existir
      userSession = await Session.create({ userId: from, messages: [] });
    }

    // Adiciona a mensagem atual
    userSession.messages.push(`Usuário: ${mensagemTexto}`);
    
    // Mantém apenas as últimas 15 mensagens no banco
    if (userSession.messages.length > 15) {
      userSession.messages = userSession.messages.slice(-15);
    }

    const prompt = `
FATOS CONHECIDOS:
${fatosFiltrados.map(f => f.content || f).join("\n")}

HISTÓRICO RELEVANTE:
${memoriaSemantica.join("\n")}

CONVERSA ATUAL:
${userSession.messages.join("\n")}

Última mensagem: ${mensagemTexto}
`;

    let respostaIA = await askGPT(prompt);
    
    // AmberMind: Verifica se a IA alucinou ou precisa de ajuste
    const decisao = await amberMind({ from, mensagem: mensagemTexto, respostaIA });
    const respostaFinal = decisao.override ? decisao.resposta : respostaIA;

    // Salva a resposta da Amber na sessão
    userSession.messages.push(`Amber: ${respostaFinal}`);
    
    // Atualiza o TTL (expiração)
    userSession.lastUpdate = new Date();
    await userSession.save(); // Salva no MongoDB
    
    // Salva na memória semântica de longo prazo
    await addSemanticMemory(
      `Pergunta: ${mensagemTexto} | Resposta: ${respostaFinal}`,
      "histórico",
      from,
      "user"
    );

    if (responderEmAudio) {
      try {
          const audioPath = await falar(respostaFinal);
          await sendAudio(from, audioPath);
      } catch (audioErr) {
          console.error("Erro ao gerar audio, enviando texto:", audioErr);
          await sendMessage(from, respostaFinal);
      }
    } else {
      await sendMessage(from, respostaFinal);
    }

    return res.sendStatus(200);

  } catch (err) {
    console.error("❌ Erro CRÍTICO no webhook:", err);
    // Mesmo com erro, respondemos 200 para o WhatsApp não ficar reenviando a mensagem "travada"
    return res.sendStatus(200); 
  }
});

/* ========================= START ========================= */
app.listen(PORT, () => {
  console.log(`✅ Donna rodando na porta ${PORT}`);
});
