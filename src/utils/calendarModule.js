// src/utils/calendarModule.js
import { google } from "googleapis";
import { DateTime } from "luxon";
import path from "path";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

/* ========================= CONFIGURAÇÃO AUTH ========================= */
const SCOPES = ["https://www.googleapis.com/auth/calendar"];

// Lógica inteligente para definir o caminho da chave:
// Se estiver no Render (process.env.RENDER existe), busca na pasta segura.
// Se estiver no PC local, busca na raiz do projeto.
const KEY_PATH = process.env.RENDER 
  ? "/etc/secrets/service_account.json" 
  : path.resolve("service_account.json");

const auth = new google.auth.GoogleAuth({
  keyFile: KEY_PATH,
  scopes: SCOPES,
});

const calendar = google.calendar({ version: "v3", auth });

// Se você não definir CALENDAR_ID no .env, ele tenta usar 'primary'
// (Mas para Service Accounts, é melhor definir o ID do calendário explicitamente no .env)
const CALENDAR_ID = process.env.CALENDAR_ID || "primary"; 

/* ========================= FUNÇÕES AUXILIARES ========================= */

// 1. Usa IA para entender o que o usuário quer (Criar ou Listar)
async function extrairDadosAgenda(texto) {
  const agora = DateTime.now().setZone("America/Sao_Paulo").toISO();
  
  const prompt = `
  Contexto: Hoje é ${agora} (Fuso horário de Brasília).
  O usuário disse: "${texto}"
  
  Sua missão: Extrair a intenção para a Google Agenda.
  Retorne APENAS um JSON válido (sem markdown, sem \`\`\`) com este formato:
  
  {
    "action": "create" | "list",
    "summary": "Título do evento (obrigatório se create)",
    "start": "ISO8601 string (ex: 2024-10-12T14:00:00-03:00)",
    "end": "ISO8601 string (se não informado, assuma 1h de duração)",
    "description": "Descrição opcional (se houver detalhes extras)"
  }
  
  Regras:
  - Se for uma pergunta ("o que tenho hoje?", "agenda de amanhã"), use action: "list".
  - Para "list", defina "start" e "end" cobrindo o período solicitado (ex: dia todo).
  - Converta termos como "amanhã", "sexta-feira" para a data correta baseada no Contexto.
  `;

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a JSON extractor helper." },
          { role: "user", content: prompt }
        ],
        temperature: 0 // Temperatura zero para máxima precisão no JSON
      },
      { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
    );

    const content = response.data.choices[0].message.content;
    // Limpeza de segurança para garantir que é JSON puro
    const jsonStr = content.replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error("Erro ao interpretar agenda com IA:", e.response?.data || e.message);
    return null;
  }
}

// 2. Lista eventos da agenda
async function listarEventos(startStr, endStr) {
  try {
    const res = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: startStr || DateTime.now().setZone("America/Sao_Paulo").toISO(),
      timeMax: endStr,
      maxResults: 10,
      singleEvents: true,
      orderBy: "startTime",
    });
    
    const eventos = res.data.items;
    if (!eventos || eventos.length === 0) return "📅 Agenda livre neste período.";
    
    return eventos.map((event, i) => {
      const start = event.start.dateTime || event.start.date; // Suporta eventos de dia inteiro
      const hora = DateTime.fromISO(start).toFormat("dd/MM HH:mm");
      return `${i + 1}. ${event.summary} (${hora})`;
    }).join("\n");
  } catch (err) {
    console.error("Erro API Calendar (List):", err.message);
    return "Erro ao acessar a agenda. Verifique se o e-mail da Service Account tem permissão.";
  }
}

// 3. Cria um novo evento
async function criarEvento(dados) {
  try {
    const event = {
      summary: dados.summary,
      description: dados.description || "Criado via Amber Assistente",
      start: { dateTime: dados.start, timeZone: "America/Sao_Paulo" },
      end: { dateTime: dados.end, timeZone: "America/Sao_Paulo" },
    };

    const res = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      resource: event,
    });

    const dataFormatada = DateTime.fromISO(dados.start).toFormat("dd/MM às HH:mm");
    return `✅ Agendado: "${dados.summary}" para ${dataFormatada}.\nLink: ${res.data.htmlLink}`;
  } catch (err) {
    console.error("Erro API Calendar (Insert):", err.message);
    return "Não consegui marcar. Verifique se a conta de serviço tem permissão de 'Alterar eventos' no calendário.";
  }
}

/* ========================= EXPORTAÇÃO PRINCIPAL ========================= */
export async function processarAgenda(texto) {
  // 1. Extrai intenção
  const dados = await extrairDadosAgenda(texto);
  
  if (!dados) return "Desculpe, não consegui entender os detalhes do agendamento.";

  // 2. Executa a ação
  if (dados.action === "list") {
    return await listarEventos(dados.start, dados.end);
  }

  if (dados.action === "create") {
    return await criarEvento(dados);
  }

  return "Ação de agenda desconhecida.";
}
