// src/utils/funcoesExtras.js
/**
 * Funções extras da Donna - 60+ funções prontas
 * A Donna tenta executar essas funções antes de chamar o GPT.
 */

import { DateTime } from "luxon";
import axios from "axios";
import { getTodayEvents, addEvent, saveMemory } from "../server.js";
import { buscarPergunta } from "./buscarPdf.js";
import { getWeather } from "./weather.js";
import { ObjectId } from "mongodb";
import { db } from "../server.js"; // importa a conexão já aberta no server

const fusoSP = "America/Sao_Paulo";

export async function funcoesExtras(from, texto) {
  const normalize = (str) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const t = normalize(texto.toLowerCase());

  const agora = DateTime.now().setZone(fusoSP);

// Coleção de tarefas no Mongo
const tasksCollection = () => db.collection("tasks");

/**
 * Cria um novo lembrete/tarefa
 */
export async function criarLembrete(numero, titulo, descricao, data, hora) {
  const task = {
    numero,
    titulo,
    descricao: descricao || titulo,
    data, // formato YYYY-MM-DD
    hora, // formato HH:mm
    concluido: false,
    criadoEm: new Date(),
  };

  const result = await tasksCollection().insertOne(task);
  return { ...task, _id: result.insertedId };
}

/**
 * Lista todos os lembretes/tarefas de um número
 */
export async function listarLembretes(numero) {
  const tasks = await tasksCollection()
    .find({ numero })
    .sort({ data: 1, hora: 1 })
    .toArray();

  if (!tasks.length) {
    return "Você não tem nenhum lembrete cadastrado.";
  }

  return tasks
    .map(
      (t, i) =>
        `${i + 1}. ${t.titulo} - ${t.data} ${t.hora || ""} ${
          t.concluido ? "✅" : "⏳"
        }`
    )
    .join("\n");
}

/**
 * Lista apenas os lembretes de hoje
 */
export async function listarLembretesHoje(numero) {
  const hoje = DateTime.now().toFormat("yyyy-MM-dd");
  const tasks = await tasksCollection()
    .find({ numero, data: hoje })
    .sort({ hora: 1 })
    .toArray();

  if (!tasks.length) {
    return "Você não tem lembretes para hoje.";
  }

  return tasks
    .map(
      (t, i) =>
        `${i + 1}. ${t.titulo} - ${t.hora || "sem horário"} ${
          t.concluido ? "✅" : "⏳"
        }`
    )
    .join("\n");
}

/**
 * Marca um lembrete como concluído
 */
export async function concluirLembrete(taskId) {
  await tasksCollection().updateOne(
    { _id: new ObjectId(taskId) },
    { $set: { concluido: true } }
  );
  return "✅ Lembrete marcado como concluído.";
}

/**
 * Remove um lembrete pelo ID
 */
export async function removerLembrete(taskId) {
  await tasksCollection().deleteOne({ _id: new ObjectId(taskId) });
  return "🗑️ Lembrete removido.";
}

  // ===== Funções gerais =====
  if (t.includes("que horas") || t.includes("horas sao") || t.includes("horas agora")) 
    return `🕒 Agora são ${agora.toFormat("HH:mm")}`;

  if (t.includes("data de hoje") || t.includes("que dia é hoje")) 
    return `📅 Hoje é ${agora.toLocaleString(DateTime.DATE_FULL)}`;

  if (t.includes("clima") || t.includes("temperatura")) {
    try { return `🌤️ O clima atual: ${await getWeather()}`; } 
    catch { return "❌ Não consegui obter o clima no momento."; }
  }

  if (t.includes("teste")) return "✅ Função extra funcionando!";

  if (t.startsWith("contagem regressiva")) {
    const match = t.match(/\d+/);
    return match ? `⏱️ Começando contagem regressiva de ${match[0]} segundos!`
                 : "❌ Informe a quantidade de segundos, ex: 'contagem regressiva 10'";
  }

  if (t.includes("converta") && t.includes("brl para usd")) {
    const match = t.match(/[\d,.]+/);
    return match ? `💰 ${parseFloat(match[0].replace(",", ".")) * 0.20} USD`
                 : "❌ Informe o valor em BRL, ex: 'converta 50 BRL para USD'";
  }

  if (t.includes("converta") && t.includes("usd para brl")) {
    const match = t.match(/[\d,.]+/);
    return match ? `💰 ${parseFloat(match[0].replace(",", ".")) * 5.0} BRL`
                 : "❌ Informe o valor em USD, ex: 'converta 10 USD para BRL'";
  }

  // Operações matemáticas básicas
  const opMap = {
    soma: (nums) => nums.reduce((a, b) => a + b, 0),
    subtraia: (nums) => nums.reduce((a, b) => a - b),
    multiplique: (nums) => nums.reduce((a, b) => a * b, 1),
    divida: (nums) => nums.length >= 2 ? (nums.reduce((a, b) => a / b)).toFixed(2) : null
  };

  for (let key of Object.keys(opMap)) {
    if (t.startsWith(key)) {
      const nums = t.match(/-?\d+(\.\d+)?/g)?.map(Number);
      if (!nums || (key === "subtraia" || key === "divida") && nums.length < 2) 
        return `❌ Informe números válidos, ex: '${key} 10 2'`;
      return `➗ Resultado: ${opMap[key](nums)}`;
    }
  }

  if (t.includes("número aleatório") || t.includes("numero aleatorio")) {
    const min = t.match(/min\s*(\d+)/)?.[1] || 0;
    const max = t.match(/max\s*(\d+)/)?.[1] || 100;
    return `🎲 Número aleatório: ${Math.floor(Math.random() * (max - min + 1)) + parseInt(min)}`;
  }

  if (t.startsWith("lembrete") || t.startsWith("adicionar tarefa") || t.startsWith("nova tarefa")) {
    const tarefa = t.replace(/lembrete|adicionar tarefa|nova tarefa/, "").trim();
    return tarefa ? `✅ Tarefa criada: "${tarefa}" (simulação)` 
                  : "❌ Informe uma mensagem ou tarefa.";
  }

  if (t.includes("minhas tarefas") || t.includes("listar tarefas"))
    return "📋 Suas tarefas: [simulação] 1. Estudar JS 2. Revisar PDF 3. Treinar Donna";

  if (t.startsWith("traduzir")) {
    const palavra = t.replace("traduzir", "").trim();
    return palavra ? `🌐 "${palavra}" em inglês é "${palavra}-en" (simulação)`
                   : "❌ Informe a palavra, ex: 'traduzir casa'";
  }

  if (t.includes("bitcoin") || t.includes("btc")) {
    try { const res = await axios.get("https://api.coindesk.com/v1/bpi/currentprice.json");
          return `₿ Bitcoin: $${res.data.bpi.USD.rate}`; } 
    catch { return "❌ Não consegui obter cotação do Bitcoin agora."; }
  }

  if (t.includes("dólar") || t.includes("dolar")) {
    try { const res = await axios.get("https://economia.awesomeapi.com.br/json/last/USD-BRL");
          return `💵 Dólar: R$${res.data["USDBRL"].bid}`; } 
    catch { return "❌ Não consegui obter cotação do dólar agora."; }
  }

  if (t.includes("euro")) {
    try { const res = await axios.get("https://economia.awesomeapi.com.br/json/last/EUR-BRL");
          return `💶 Euro: R$${res.data["EURBRL"].bid}`; } 
    catch { return "❌ Não consegui obter cotação do euro agora."; }
  }

  if (t.includes("resumo pdf") || t.includes("trecho pdf")) {
    const pdfTrechos = await buscarPergunta(texto);
    return pdfTrechos ? `📄 Trechos encontrados:\n${pdfTrechos}` : "❌ Não encontrei nada nos PDFs.";
  }

  if (t.startsWith("dias entre")) {
    const match = t.match(/(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})/);
    if (match) { 
      const diff = Math.abs(DateTime.fromISO(match[2], {zone: fusoSP}).diff(DateTime.fromISO(match[1], {zone: fusoSP}), "days").days);
      return `📆 Dias entre datas: ${diff}`;
    }
    return "❌ Use formato: 'dias entre 2025-09-01 2025-09-30'";
  }

  if (t.includes("motiva") || t.includes("frase motivacional"))
    return "💡 Acredite em você! Cada passo pequeno te leva a grandes conquistas!";

  if (t.includes("piada")) 
    return "😂 Por que o computador foi ao médico? Porque estava com vírus!";

  if (t.includes("fuso horário")) 
    return `🌍 O fuso horário atual é ${agora.offsetNameShort}`;

  if (t.includes("dia da semana") || t.includes("que dia caiu")) 
    return `📅 Hoje é ${agora.toFormat("cccc")}`;

  if (t.includes("segundos desde meia-noite")) {
    const segundos = agora.diff(agora.startOf("day"), "seconds").seconds;
    return `⏱️ Segundos desde meia-noite: ${Math.floor(segundos)}`;
  }

  if (t.includes("limpar memória")) return "🧹 Memória limpa! (simulação)";

  if (t.includes("próximo evento")) {
    const eventos = await getTodayEvents(from);
    return eventos.length ? `📅 Próximo evento: ${eventos[0].titulo} às ${eventos[0].hora}` 
                         : "📅 Nenhum evento encontrado.";
  }

  if (t.startsWith("adicionar evento")) {
    const partes = t.replace("adicionar evento", "").trim().split("|");
    if (partes.length === 3) {
      await addEvent(from, partes[0].trim(), partes[1].trim(), partes[2].trim(), "12:00");
      return `✅ Evento "${partes[0].trim()}" adicionado!`;
    }
    return "❌ Formato: adicionar evento [nome] | [descrição] | [dd/mm/aaaa]";
  }

  if (t.startsWith("salvar memória")) {
    const info = t.replace("salvar memória", "").trim();
    await saveMemory(from, info);
    return `💾 Informação salva na memória: ${info}`;
  }

  // ===== Novas funções por categoria =====
  // (aqui adicionaremos as 60 funções novas organizadas por tema)
  // Exemplo rápido para DP e Folha:
  if (t.includes("calcular férias")) return "📌 Função: cálculo de férias do colaborador (simulação)";
  if (t.includes("calcular décimo terceiro")) return "📌 Função: cálculo de décimo terceiro salário (simulação)";
  if (t.includes("gerar holerite")) return "📌 Função: gerar holerite em PDF (simulação)";
  if (t.includes("admissão de funcionário")) return "📌 Função: cadastro de novo funcionário (simulação)";
  if (t.includes("demissão de funcionário")) return "📌 Função: demissão e baixa no sistema (simulação)";

  // ===== Se nada se aplica =====
  return null;
                            }
