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

  if (!tasks.length) return "Você não tem nenhum lembrete cadastrado.";

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

  if (!tasks.length) return "Você não tem lembretes para hoje.";

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

/**
 * Função principal de execução de comandos extras
 */
export async function funcoesExtras(from, texto) {
  const normalize = (str) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const t = normalize(texto.toLowerCase());
  const agora = DateTime.now().setZone(fusoSP);

  // ===== Comandos de lembretes com ID =====
  if (t.startsWith("concluir lembrete")) {
    const match = t.match(/concluir lembrete (\d+)/);
    if (!match) return "❌ Informe o número do lembrete, ex: 'concluir lembrete 2'";
    const index = parseInt(match[1]) - 1;

    const tasks = await tasksCollection().find({ numero: from }).sort({ data: 1, hora: 1 }).toArray();
    if (!tasks[index]) return "❌ Número inválido. Confira a lista de lembretes.";

    await concluirLembrete(tasks[index]._id);
    return `✅ Lembrete "${tasks[index].titulo}" marcado como concluído.`;
  }

  if (t.startsWith("remover lembrete")) {
    const match = t.match(/remover lembrete (\d+)/);
    if (!match) return "❌ Informe o número do lembrete, ex: 'remover lembrete 3'";
    const index = parseInt(match[1]) - 1;

    const tasks = await tasksCollection().find({ numero: from }).sort({ data: 1, hora: 1 }).toArray();
    if (!tasks[index]) return "❌ Número inválido. Confira a lista de lembretes.";

    await removerLembrete(tasks[index]._id);
    return `🗑️ Lembrete "${tasks[index].titulo}" removido com sucesso.`;
  }

  // Comandos antigos de criação/listagem de lembretes (simulação ou texto livre)
  if (t.startsWith("lembrete") || t.startsWith("adicionar tarefa") || t.startsWith("nova tarefa")) {
    const tarefa = t.replace(/lembrete|adicionar tarefa|nova tarefa/, "").trim();
    if (!tarefa) return "❌ Informe uma mensagem ou tarefa.";
    const hoje = agora.toFormat("yyyy-MM-dd");
    const hora = agora.toFormat("HH:mm");
    const task = await criarLembrete(from, tarefa, tarefa, hoje, hora);
    return `✅ Tarefa criada: "${tarefa}" (ID: ${task._id})`;
  }

  if (t.includes("minhas tarefas") || t.includes("listar tarefas") || t.includes("listar lembretes")) {
    return await listarLembretes(from);
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

  if (t.startsWith("contagem regressiva")) {
    const match = t.match(/\d+/);
    return match ? `⏱️ Começando contagem regressiva de ${match[0]} segundos!`
                 : "❌ Informe a quantidade de segundos, ex: 'contagem regressiva 10'";
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

 // ===== Novas funções por categoria (DP e Folha) =====
  if (t.includes("calcular férias")) return "📌 Função: cálculo de férias do colaborador (simulação)";
  if (t.includes("calcular décimo terceiro")) return "📌 Função: cálculo de décimo terceiro salário (simulação)";
  if (t.includes("gerar holerite")) return "📌 Função: gerar holerite em PDF (simulação)";
  if (t.includes("admissão de funcionário")) return "📌 Função: cadastro de novo funcionário (simulação)";
  if (t.includes("demissão de funcionário")) return "📌 Função: demissão e baixa no sistema (simulação)";

  // ===== Se nada se aplica =====
  return null;
}
