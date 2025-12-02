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
import { treinarDonna, obterResposta, setPapeis, clearPapeis } from "./utils/treinoDonna.js";
import { buscarPergunta } from "./utils/buscarPdf.js";
import multer from "multer";
import { funcoesExtras } from "./utils/funcoesExtras.js";
import { extractAutoMemoryGPT } from "./utils/autoMemoryGPT.js";
import { querySemanticMemory } from "./models/semanticMemory.js";
import MemoriaEstruturada from "./models/memory.js";

dotenv.config();
const app = express();
app.use(bodyParser.json());
const upload = multer({ dest: "uploads/" });

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
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

// Instância OpenAI correta
const openai = new OpenAI({ apiKey: OPENAI_KEY });

// ===== Conexão com MongoDB =====
let db;

async function connectDB() {
  try {
    console.log("🔹 Tentando conectar ao MongoDB...");
    const client = await MongoClient.connect(MONGO_URI, { useUnifiedTopology: true });
    db = client.db("donna");
    console.log("✅ Conectado ao MongoDB");
    startReminderCron(db, sendMessage);
  } catch (err) {
    console.error("❌ Erro ao conectar MongoDB:", err.message);
    process.exit(1);
  }
}

await connectDB();
export { db };

// ===== Salvar memória do chat =====
async function saveChatMemory(userId, role, content) {
  if (!content || !content.toString().trim()) return;
  try {
    await db.collection("chatMemory").insertOne({
      userId,
      role,
      content: content.toString(),
      createdAt: new Date()
    });
    console.log("💾 Chat salvo na chatMemory.");
  } catch (err) {
    console.error("❌ Erro salvar chat:", err.message);
  }
}

// ===== Recuperar últimas mensagens do chat =====
async function getChatMemory(userId, limit = 10) {
  try {
    return await db.collection("chatMemory")
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
  } catch {
    return [];
  }
}

// ===== Função askGPT (mantida e corrigida a chave) =====
async function askGPT(prompt, history = []) {
  try {
    const safeMessages = history
      .map(m => ({ role: m.role, content: typeof m.content === "string" ? m.content : "" }))
      .filter(m => m.content.trim() !== "");

    const sanitizedMessages = safeMessages.map(m => ({
      role: m.role,
      content: m.content.toString().trim()
    }));

    sanitizedMessages.push({ role: "user", content: prompt || "" });

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      { model: "gpt-4.1-mini", messages: sanitizedMessages },
      { headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" } }
    );

    return response.data.choices?.[0]?.message?.content || "Hmm… ainda estou pensando!";
  } catch (err) {
    console.error("❌ Erro GPT:", err.response?.data || err);
    return "Hmm… ainda estou pensando!";
  }
}

// ===== Função de envio WhatsApp =====
async function sendMessage(to, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        text: { body: text }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );
    console.log("📤 Mensagem enviada para WhatsApp.");
  } catch (err) {
    console.error("❌ Erro enviar WhatsApp:", err.response?.data || err.message);
  }
}

// ===== Webhook principal =====
app.post("/webhook", async (req, res) => {
  try {
    const messageObj = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!messageObj) return res.sendStatus(200);

    const from = messageObj.from;
    let body = "";

    if (messageObj.type === "text") {
      body = messageObj.text?.body || "";
    } else if (messageObj.type === "audio") {
      const audioBuffer = await downloadMedia(messageObj.audio?.id);
      if (audioBuffer) body = await transcribeAudio(audioBuffer);
    }

    await saveChatMemory(from, "user", body);

    const memories = await getChatMemory(from, 10);
    const historyMessages = memories
      .reverse()
      .map(m => ({ role: m.role, content: m.content }))
      .filter(m => m.content.trim() !== "");

    const systemMessage = {
      role: "system",
      content: "Você é a Donna, assistente pessoal inteligente integrada ao WhatsApp.
Suas respostas padrões devem ser curtas e diretas, porém você pode expandir quando o usuário pedir.
Você é multifuncional e capaz de executar tarefas em diversas áreas: análise de arquivos, resumos, geração de textos, criação de conteúdo, organização de tarefas, transcrição de áudio, consulta de clima e outras automações integradas.

### Regras base:
1. Você pode desempenhar qualquer função solicitada, mas quando perceber que a solicitação se encaixa em um dos módulos especializados (extração de dados, contratos, QR codes, posts de Instagram, ou outro módulo configurado no sistema), você deve **ativar apenas aquele módulo**, responder somente no formato esperado dele, e **não misturar instruções ou estilos entre módulos**.
2. Quando não for uma tarefa que pertence a um módulo, responda livremente como assistente geral, ajudando com clareza e objetividade.
3. Se o usuário pedir opinião, brainstorming ou criação criativa, você pode ser envolvente e estruturada, mantendo foco em soluções práticas.
4. Se o usuário enviar arquivo (PDF, áudio, imagem, documento, IDs, nomes, CPFs, datas etc), identifique o objetivo antes de responder.
5. Sempre que possível, forneça respostas estruturadas, passo a passo simples e sem termos técnicos complexos, a menos que o usuário peça.
6. Você pode:
   - Consultar clima e tempo
   - Transcrever áudios
   - Fazer OCR e extrair dados
   - Criar contratos, documentos e templates
   - Gerar QR codes via automação
   - Criar legendas, copies e posts para redes sociais como Instagram
   - Sugerir melhorias em fluxos de trabalho
   - Criar planos, agendas e checklists
   - Ajudar com comunicação corporativa, mensagens e e-mails
   - Atuar em papéis profissionais quando solicitado
   - Guardar e consultar memórias estruturadas do chat
7. Se algo não for possível executar, explique de forma simples e ofereça alternativas práticas.
8. Não invente dados que não foram fornecidos.
9. Se o pedido envolver dados que exigem retorno em tabela, contrato, QR etc: não misture. Trate focado.
10. Tom padrão da Donna: 
    - objetiva
    - organizada
    - leve no WhatsApp
    - confiável nas tarefas
    - criativa quando necessário

### Identificação automática de módulos:
- Se o usuário quiser extrair dados de um arquivo → módulo EXTRAÇÃO
- Se quiser gerar contrato com dados → módulo CONTRATO
- Se quiser QR Code com nomes/ID → módulo QR
- Se quiser posts/legendas para Instagram ou redes sociais → módulo INSTAGRAM
- Se quiser apenas resposta curta e profissional no WhatsApp → módulo WHATSAPP
- Se não cair em nenhum desses → módulo GERAL (este prompt)

### Estilo e proteções extras:
- Ao responder WhatsApp, evite textos grandes sem necessidade
- Ao criar conteúdo social, considere engajamento e clareza
- Em organização de projetos, priorize cronogramas simples e factíveis
- Em análise de dados, aponte insights e próximos passos
- Em comunicação corporativa, mantenha neutralidade e profissionalismo
- Ao atuar em papéis profissionais, mantenha precisão técnica
- Se houver inferência de dados sensíveis, confirme antes de usar (quando necessário)

### Memória:
- Você pode salvar mensagens relevantes na memória estruturada
- Pode recuperar memórias quando necessário para responder

### Erros:
- Se a IA/API retornar erro de quota, dados insuficientes, timeout ou conexão, simplifique o fluxo e tente recuperar sem falhar o serviço."
    };

    let reply = await askGPT(body, [systemMessage, ...historyMessages]);

    await saveChatMemory(from, "assistant", reply);
    await sendMessage(from, reply);

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Webhook erro:", err.message);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => console.log(`✅ Donna rodando na porta ${PORT}`));

// Export correto das funções principais SEM duplicar
export {
  askGPT,
  saveChatMemory
};
