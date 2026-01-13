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
import pdfParse from "pdf-parse-fork";
import { v4 as uuidv4 } from 'uuid'; // Adicionado para nomes únicos de arquivos

/* ========================= IMPORTS INTERNOS ========================= */
import { startReminderCron } from "./cron/reminders.js";
import { getWeather } from "./utils/weather.js";
import { normalizeMessage, shouldIgnoreMessage } from "./utils/messageHelper.js";
import { consultarFatos } from "./utils/memory.js";
import { addSemanticMemory, querySemanticMemory } from "./models/semanticMemory.js";
import { initRoutineFamily, handleCommand, handleReminder } from "./utils/routineFamily.js";
import { amberMind } from "./core/amberMind.js";
import { amberEnglishUltimate } from "./utils/amberEnglishUltimate.js";
import { falar, sendAudio } from "./utils/sendAudio.js";
import { transcreverAudio } from "./utils/transcreverAudio.js";
import { consultarDataJud } from "./utils/datajudAPI.js";
import { extractAutoMemoryGPT } from "./utils/autoMemoryGPT.js";
import { selectMemoriesForPrompt } from "./memorySelector.js";
import { Session } from "./models/session.js";
import { traduzirEGerarAudio } from "./utils/translatorModule.js";

// NOVOS MÓDULOS
import { processarAgenda } from "./utils/calendarModule.js";
import { processarFinanceiro } from "./utils/financeModule.js";
import { downloadMedia } from "./utils/downloadMedia.js"; 
import { processarTasks } from "./utils/todoModule.js";
import { buscarNoticiasComIA } from "./utils/newsModule.js";
import cron from "node-cron";
import { verificarContextoProativo } from "./utils/proactiveModule.js";
import { gerarImagemGoogle } from "./utils/imageGenGoogle.js";
import { criarVideoAmber } from "./utils/videoMaker.js";

/* ========================= CONFIG ========================= */
dotenv.config();
mongoose.set("strictQuery", false);

const app = express();
app.use(bodyParser.json());
const PORT = process.env.PORT || 3000;

// ... (suas outras constantes de ENV)

// --- AJUSTE AQUI ---
// Definimos o caminho base do projeto de forma absoluta
const ROOT_DIR = process.cwd();

// Garante que as pastas existam na raiz do projeto
fs.ensureDirSync(path.join(ROOT_DIR, "public/audio"));
fs.ensureDirSync(path.join(ROOT_DIR, "public/images"));

// Serve os arquivos estáticos apontando para o lugar certo
app.use("/audio", express.static(path.join(ROOT_DIR, "public/audio")));
app.use("/images", express.static(path.join(ROOT_DIR, "public/images")));
// -------------------

/* ========================= CONTROLE ========================= */
const mensagensProcessadas = new Set();
let db;
let cronStarted = false;

/* ========================= DB ========================= */
async function connectDB() {
  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 30000 });
    console.log("🔥 MongoDB Conectado (Mongoose)");
    db = mongoose.connection.db;
    if (!cronStarted) {
      startReminderCron(db, sendMessage);
      cronStarted = true;
      console.log("⏰ Cron iniciado");
    }
  } catch (error) {
    console.error("❌ Erro fatal DB:", error);
    process.exit(1);
  }
}
await connectDB();
await initRoutineFamily(db, sendMessage);

/* ========================= HELPERS ========================= */
function dividirMensagem(texto, limite = 1500) {
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

// Salva o Base64 do Google em um arquivo físico e retorna a URL
function salvarImagemBase64(base64Data) {
  try {
    const base64Image = base64Data.replace(/^data:image\/\w+;base64,/, "");
    const fileName = `img_${uuidv4()}.png`;
    const filePath = path.join(__dirname, "public/images", fileName);
    
    fs.writeFileSync(filePath, base64Image, 'base64');
    
    // Altere para a URL do seu Render se não estiver no ENV
    const serverUrl = process.env.SERVER_URL || "https://donna-bot-59gx.onrender.com";
    return `${serverUrl}/images/${fileName}`;
  } catch (error) {
    console.error("❌ Erro ao salvar imagem localmente:", error);
    return null;
  }
}

async function sendMessage(to, text) {
  if (!to || !text) return;
  const mensagemFinal = typeof text === 'string' ? text : JSON.stringify(text);
  const partes = dividirMensagem(mensagemFinal);
  try {
    for (const parte of partes) {
      await axios.post(
        `https://graph.facebook.com/v24.0/${WHATSAPP_PHONE_ID}/messages`,
        { messaging_product: "whatsapp", to, text: { body: parte } },
        { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
      );
    }
  } catch (error) {
    console.error(`Erro envio:`, error.message);
  }
}

async function sendImage(to, imageSource, caption = "") {
  try {
    const payload = {
      messaging_product: "whatsapp",
      to,
      type: "image",
      image: { caption, link: imageSource }
    };

    await axios.post(
      `https://graph.facebook.com/v24.0/${WHATSAPP_PHONE_ID}/messages`,
      payload,
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
    );
  } catch (error) {
    console.error("❌ Erro ao enviar imagem:", error.response?.data || error.message);
  }
}

async function askGPT(prompt, imageUrl = null) {
  const messages = [
    { role: "system", content: "Você é Amber. Inteligente, sofisticada e útil." },
    { role: "user", content: [] }
  ];

  messages[1].content.push({ type: "text", text: prompt });

  if (imageUrl) {
    messages[1].content.push({
      type: "image_url",
      image_url: { url: imageUrl }
    });
  }

  try {
    const model = "gpt-4o-mini"; 
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      { model, messages, temperature: 0.7 },
      { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
    );
    return response.data.choices?.[0]?.message?.content || "Certo.";
  } catch (error) {
    console.error("❌ Erro OpenAI:", error.response?.data || error.message);
    return "Tive um soluço mental, pode repetir?";
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

app.get("/", (req, res) => res.status(200).send("Amber Ultimate Online 🟢"));
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  res.sendStatus(403);
});

const NUMEROS_PERMITIDOS = ["554195194485"];
const numeroPermitido = from => NUMEROS_PERMITIDOS.includes(from);

/* ========================= WEBHOOK POST ========================= */
app.post("/webhook", async (req, res) => {
  try {
    const messageObj = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!messageObj) return res.sendStatus(200);

    const messageId = messageObj.id;
    if (mensagensProcessadas.has(messageId)) return res.sendStatus(200);
    mensagensProcessadas.add(messageId);
    setTimeout(() => mensagensProcessadas.delete(messageId), 300000);

    const from = messageObj.from;
    const type = messageObj.type;
    
    if (!numeroPermitido(from) || shouldIgnoreMessage(messageObj, from)) return res.sendStatus(200);

    let body = "";
    let imageUrlForGPT = null;

    if (type === "text") {
      body = messageObj.text.body;
    } 
    else if (type === "audio") {
      body = await transcreverAudio(messageObj.audio.id);
    } 
    else if (type === "image") {
      await sendMessage(from, "👁️ Analisando imagem...");
      const buffer = await downloadMedia(messageObj.image.id);
      if (buffer) {
        const base64Image = buffer.toString('base64');
        const mimeType = messageObj.image.mime_type || "image/jpeg";
        imageUrlForGPT = `data:${mimeType};base64,${base64Image}`;
        body = messageObj.caption || "O que você vê nesta imagem?";
      } else {
        await sendMessage(from, "Não consegui baixar a foto agora.");
        return res.sendStatus(200);
      }
    }
    else if (type === "document") {
      if (messageObj.document.mime_type === "application/pdf") {
        await sendMessage(from, "📄 Lendo PDF...");
        const buffer = await downloadMedia(messageObj.document.id);
        if (buffer) {
          try {
            const data = await pdfParse(buffer);
            const textoExtraido = data.text ? data.text.replace(/\s+/g, ' ').trim() : "";
            body = textoExtraido.length < 5 ? "PDF sem texto." : `CONTEÚDO DO PDF: """${textoExtraido.slice(0, 5000)}"""\n\nInstrução: ${messageObj.caption || "Resuma este documento."}`;
          } catch (e) {
            body = "Erro técnico ao ler o PDF.";
          }
        }
      } else {
        await sendMessage(from, "Por enquanto só leio PDFs.");
        return res.sendStatus(200);
      }
    }
    
    if (!body) return res.sendStatus(200);
    const bodyLower = body.toLowerCase();
    const corpoLimpo = bodyLower.replace(/amber, |amber /gi, "").trim();

    /* ===== PRIORIDADE: GERAÇÃO DE IMAGEM ===== */
    if (corpoLimpo.startsWith("desenha") || corpoLimpo.startsWith("imagem de")) {
      await sendMessage(from, "🎨 Deixa comigo! Estou criando sua imagem com o Imagen 3...");
      const promptImg = corpoLimpo.replace(/desenha|imagem de/gi, "").trim();
      const base64Result = await gerarImagemGoogle(promptImg);

      if (base64Result) {
        const publicUrl = salvarImagemBase64(base64Result);
        if (publicUrl) {
          await sendImage(from, publicUrl, `🖌️ "${promptImg}"`);
        } else {
          await sendMessage(from, "Erro ao processar o arquivo da imagem.");
        }
      } else {
        await sendMessage(from, "Tive um problema técnico. Verifique se o faturamento no Google Cloud está ativo.");
      }
      return res.sendStatus(200);
    }

    await extractAutoMemoryGPT(from, body, askGPT);

if (bodyLower.startsWith("amber, faz um vídeo sobre")) {
    const tema = bodyLower.replace("amber, faz um vídeo sobre", "").trim();
    
    const querAltaQualidade = bodyLower.includes("4k") || bodyLower.includes("detalhado");
    const modo = querAltaQualidade ? "Alta Qualidade (HQ)" : "Modo Econômico (Fast)";

    await sendMessage(from, `🎬 Iniciando produção em ${modo} sobre "${tema}"... Aguarda um pouco.`);

    try {
        const caminhosImagens = [];
        for (let i = 1; i <= 6; i++) {
            console.log(`🖼️ Gerando cena ${i} (${modo})...`);
            
            const promptFinal = querAltaQualidade 
                ? `${tema}, cena cinematográfica ${i}, ultra detalhado, 4k, photorealistic`
                : `${tema}, scene ${i}`; 

            const base64Result = await gerarImagemGoogle(promptFinal);
            
            if (base64Result) {
                const fileName = `temp_vid_${uuidv4()}.png`;
                // AJUSTE AQUI: Usando process.cwd() para evitar erro de pastas no Render
                const filePath = path.join(process.cwd(), "public/images", fileName);
                
                const base64Data = base64Result.replace(/^data:image\/\w+;base64,/, "");
                fs.writeFileSync(filePath, base64Data, 'base64');
                caminhosImagens.push(filePath);
            }
        }

        if (caminhosImagens.length < 1) {
            return await sendMessage(from, "❌ Falha ao gerar imagens.");
        }

        const nomeDoVideo = `video_${Date.now()}`;
        const videoUrlRelativa = await criarVideoAmber(caminhosImagens, nomeDoVideo);
        
        // AJUSTE NO LINK: Remove barras extras para o link não quebrar
        const serverUrl = (process.env.SERVER_URL || "https://donna-bot-59gx.onrender.com").replace(/\/$/, "");
        const linkFinal = `${serverUrl}${videoUrlRelativa}`;

        await sendMessage(from, `✅ Vídeo pronto (${modo})!\n\n📺 Assiste aqui: ${linkFinal}`);

        // Limpeza das imagens temporárias
        caminhosImagens.forEach(p => fs.remove(p).catch(e => console.log("Erro limpar:", e)));

    } catch (error) {
        console.error("❌ Erro ao criar vídeo:", error);
        await sendMessage(from, "❌ Erro ao processar o vídeo.");
    }
    return res.sendStatus(200);
}
    /* ===== 2. ROTINAS DE COMANDO ===== */
    if (await handleCommand(body, from) || await handleReminder(body, from)) {
      return res.sendStatus(200);
    }

    if (["gastei", "compra", "paguei", "valor"].some(p => bodyLower.includes(p))) {
      const respFin = await processarFinanceiro(body);
      if (respFin) { 
        await sendMessage(from, respFin);
        return res.sendStatus(200);
      }
    }

    const respTask = await processarTasks(from, body);
    if (respTask) {
      await sendMessage(from, respTask);
      return res.sendStatus(200);
    }

    if (bodyLower.includes("notícias") || bodyLower.includes("novidades sobre")) {
      await sendMessage(from, "🧐 Amber está lendo os principais portais para você...");
      const tema = bodyLower.replace(/notícias|novidades|sobre|de|da/gi, "").trim() || "tecnologia";
      const briefing = await buscarNoticiasComIA(tema, askGPT);
      await sendMessage(from, briefing);
      return res.sendStatus(200);
    }
    
    const gatilhosAgenda = ["agenda", "marcar", "agendar", "reunião", "compromisso"];
    if (gatilhosAgenda.some(g => bodyLower.includes(g))) {
       const respAgenda = await processarAgenda(body);
       await sendMessage(from, respAgenda);
       return res.sendStatus(200);
    }

    if (bodyLower.startsWith("amber envia mensagem") || bodyLower.startsWith("amber, envia mensagem")) {
      const regex = /para\s+([\d,\s]+)[\s:]+(.*)/i;
      const match = bodyLower.match(regex);
      if (match) {
        const numeros = match[1].replace(/\s/g, "").split(",").filter(Boolean);
        const mensagemParaEnviar = match[2];
        await sendMessage(from, `Iniciando envio para ${numeros.length} contatos...`);
        (async () => {
            for (const numero of numeros) {
              await sendMessage(numero, mensagemParaEnviar);
              await new Promise(r => setTimeout(r, 2000));
            }
            await sendMessage(from, "✅ Envio em massa concluído.");
        })().catch(err => console.error("Erro no broadcast:", err));
        return res.sendStatus(200);
      }
    }

      // Gatilho: "Amber, traduza para [idioma]: [texto]" ou enviando áudio e pedindo tradução
if (bodyLower.includes("traduza para") || bodyLower.includes("traduz para")) {
    await sendMessage(from, "🌐 Traduzindo e gerando áudio oficial...");
    
    // 1. Extrair o idioma e o texto
    const promptTraducao = `Traduza o seguinte texto para o idioma solicitado. Retorne APENAS a tradução, sem comentários:
    Texto: ${body}
    Idioma solicitado: ${bodyLower.split("para")[1].trim()}`;
    
    const textoTraduzido = await askGPT(promptTraducao);
    
    // 2. Gerar áudio com ElevenLabs (usando o módulo novo)
    const audioFile = await traduzirEGerarAudio(textoTraduzido);
    
    if (audioFile) {
        const audioUrl = `${process.env.SERVER_URL}/audio/${audioFile}`;
        await sendMessage(from, `*Tradução:* ${textoTraduzido}`);
        await sendAudio(from, audioUrl);
    } else {
        await sendMessage(from, "Consegui traduzir o texto, mas tive um erro no áudio.");
        await sendMessage(from, textoTraduzido);
    }
    return res.sendStatus(200);
}


    if (bodyLower.includes("english") || bodyLower.startsWith("translate")) {
      const respEng = await amberEnglishUltimate({ userId: from, pergunta: body, level: "beginner" });
      await sendMessage(from, respEng);
      return res.sendStatus(200);
    }

    if (["lei", "artigo", "direito", "jurisprudência"].some(p => bodyLower.includes(p))) {
      const refs = await buscarInformacaoDireito(body);
      const respDir = await askGPT(`Leis BR:\n${refs}\n\nPergunta: ${body}`);
      await sendMessage(from, respDir);
      return res.sendStatus(200);
    }

    if (["clima", "tempo", "previsão"].some(p => bodyLower.includes(p))) {
      const clima = await getWeather("Curitiba", "hoje");
      await sendMessage(from, clima);
      return res.sendStatus(200);
    }

    /* ===== 3. FLUXO PRINCIPAL ===== */
    const userSession = await Session.findOneAndUpdate(
      { userId: from },
      { 
        $push: { messages: { $each: [`Usuário: ${body}`], $slice: -15 } },
        $set: { lastUpdate: new Date() }
      },
      { upsert: true, new: true }
    );

    const fatos = (await consultarFatos(from)).map(f => typeof f === "string" ? f : f.content);
    const fatosFiltrados = selectMemoriesForPrompt(fatos);
    const memoriaSemantica = await querySemanticMemory("histórico", from, 10) || [];

    const promptFinal = `
      FATOS: ${fatosFiltrados.join("\n")}
      HISTÓRICO: ${memoriaSemantica.join("\n")}
      CONVERSA: ${userSession.messages.join("\n")}
      MSG ATUAL: ${body}
    `;

    let respostaIA = await askGPT(promptFinal, imageUrlForGPT);
    const decisao = await amberMind({ from, mensagem: body, respostaIA });
    const respostaFinal = decisao.override ? decisao.resposta : respostaIA;

    await Session.updateOne(
      { userId: from },
      { $push: { messages: { $each: [`Amber: ${respostaFinal}`], $slice: -15 } } }
    );
    
    await addSemanticMemory(`Pergunta: ${body} | Resposta: ${respostaFinal}`, "histórico", from, "user");

    if (type === "audio") {
      try {
          const audioPath = await falar(respostaFinal);
          await sendAudio(from, audioPath);
      } catch (audioErr) {
          await sendMessage(from, respostaFinal);
      }
    } else {
      await sendMessage(from, respostaFinal);
    }

    return res.sendStatus(200);

  } catch (err) {
    console.error("❌ Erro fatal no webhook:", err);
    return res.sendStatus(200);
  }
});

cron.schedule("0 * * * *", async () => {
  const userId = "554195194485";
  const sugestao = await verificarContextoProativo(userId);
  if (sugestao) await sendMessage(userId, sugestao);
}, { timezone: "America/Sao_Paulo" });

app.listen(PORT, () => console.log(`✅ Amber Ultimate rodando na porta ${PORT}`));
