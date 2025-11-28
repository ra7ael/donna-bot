// src/utils/funcoesExtras.js
/**
 * Funções extras da Donna - 60+ funções prontas
 * A Donna tenta executar essas funções antes de chamar o GPT.
 */

import { DateTime } from "luxon";
import axios from "axios";
import { buscarPergunta } from "./buscarPdf.js";
import { getWeather } from "./weather.js";
import { ObjectId } from "mongodb";
import { getDB } from "../server.js";

const fusoSP = "America/Sao_Paulo";

// Coleção de tarefas no Mongo com proteção
const tasksCollection = () => {
  const database = getDB();
  if (!database) throw new Error("❌ Banco não inicializado ainda.");
  return database.collection("tasks");
};

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
  const database = getDB();
  if (!database) return "❌ Banco ainda não conectado.";

  const tasks = await database
    .collection("tasks")
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
  const database = getDB();
  if (!database) return "❌ Banco ainda não conectado.";

  const hoje = DateTime.now().toFormat("yyyy-MM-dd");
  const tasks = await database
    .collection("tasks")
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
  const database = getDB();
  if (!database) return "❌ Banco não conectado.";

  await database
    .collection("tasks")
    .updateOne({ _id: new ObjectId(taskId) }, { $set: { concluido: true } });

  return "✅ Lembrete marcado como concluído.";
}

/**
 * Remove um lembrete pelo ID
 */
export async function removerLembrete(taskId) {
  const database = getDB();
  if (!database) return "❌ Banco não conectado.";

  await database.collection("tasks").deleteOne({ _id: new ObjectId(taskId) });
  return "🗑️ Lembrete removido com sucesso.";
}

/**
 * Função principal de execução de comandos extras
 */
export async function funcoesExtras(from, texto) {
  if (!texto) return null;

  // Normaliza texto
  const normalize = (str) =>
    str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const t = normalize(texto.toLowerCase().trim());
  const agora = DateTime.now().setZone(fusoSP);

  // ===== Concluir lembrete Nº =====
  if (t.startsWith("concluir lembrete")) {
    const match = t.match(/concluir lembrete (\d+)/);
    if (!match) return "❌ Informe o número do lembrete, ex: 'concluir lembrete 2'";

    const index = parseInt(match[1]) - 1;
    const database = getDB();
    if (!database) return "❌ Banco não conectado.";

    const tasks = await database
      .collection("tasks")
      .find({ numero: from })
      .sort({ data: 1, hora: 1 })
      .toArray();

    if (!tasks[index]) return "❌ Número inválido. Confira a lista de lembretes.";

    await database
      .collection("tasks")
      .updateOne(
        { _id: tasks[index]._id },
        { $set: { concluido: true } }
      );

    return `✅ Lembrete "${tasks[index].titulo}" concluído!`;
  }

  // ===== Remover lembrete Nº =====
  if (t.startsWith("remover lembrete") || t.startsWith("remover tarefa")) {
    const match = t.match(/(remover lembrete|remover tarefa|remover tarefa) (\d+)/);
    if (!match) return "❌ Informe o número do lembrete, ex: 'remover lembrete 3'";

    const index = parseInt(match[2]) - 1;
    const database = getDB();
    if (!database) return "❌ Banco não conectado.";

    const tasks = await database
      .collection("tasks")
      .find({ numero: from })
      .sort({ data: 1, hora: 1 })
      .toArray();

    if (!tasks[index]) return "❌ Número inválido. Confira a lista.";

    await database.collection("tasks").deleteOne({ _id: tasks[index]._id });
    return `🗑️ Tarefa "${tasks[index].titulo}" removida!`;
  }

  // ===== Criar tarefa via texto livre =====
  if (
    t.startsWith("lembrete") ||
    t.startsWith("adicionar tarefa") ||
    t.startsWith("nova tarefa")
  ) {
    const tarefa = t
      .replace(/lembrete|adicionar tarefa|nova tarefa/, "")
      .trim();
    if (!tarefa) return "❌ Informe a descrição da tarefa.";

    const hoje = agora.toFormat("yyyy-MM-dd");
    const hora = agora.toFormat("HH:mm");

    await criarLembrete(from, tarefa, tarefa, hoje, hora);
    return `✅ Tarefa criada: "${tarefa}"`;
  }

  // ===== Listar tarefas do usuário =====
  if (t.includes("minhas tarefas") || t.includes("listar")) {
    try {
      const database = getDB();
      if (!database) return "❌ Banco não conectado.";
      const tasks = await database.collection("tasks").find({ numero: from }).toArray();
      if (!tasks.length) return "📌 Nenhuma tarefa.";
      return tasks.map((t,i)=>`${i+1}. ${t.titulo} ${t.hora||""} ${t.concluido?"✅":"⏳"}`).join("\n");
    } catch {
      return "❌ Não consegui listar agora.";
    }
  }

  // ===== Horas =====
  if (t.includes("que horas") || t.includes("hora agora")) {
    return `🕒 ${agora.toFormat("HH:mm")}`;
  }

  // ===== Data =====
  if (t.includes("data de hoje") || t.includes("que dia é hoje")) {
    return `📅 ${agora.toLocaleString(DateTime.DATE_FULL)}`;
  }

  // ===== Clima =====
  if (t.includes("clima") || t.includes("temperatura")) {
    try {
      const clima = await getWeather();
      return `🌤️ ${clima}`;
    } catch {
      return "❌ Não consegui obter o clima.";
    }
  }

  // ===== PDF Q&A =====
  if (t.includes("buscar pdf") || t.includes("pergunta no pdf")) {
    try {
      const resposta = await buscarPergunta(t.replace("buscar pdf", "").trim());
      return resposta || "📌 Nada encontrado no PDF.";
    } catch {
      return "❌ Falha leitura do PDF.";
    }
  }

  // ===== Motivação =====
  if (t.includes("motiva") || t.includes("frase motivacional")) {
    return "💡 Você consegue. Respira e começa.";
  }

  // ===== Piada =====
  if (t.includes("piada")) {
    return "😂 O Wi-Fi foi ao psicólogo… tinha problemas de conexão.";
  }

  // ===== Fuso horário =====
  if (t.includes("fuso") || t.includes("timezone")) {
    return `🌍 ${agora.zoneName}`;
  }

  // ===== Segundos desde meia-noite =====
  if (t.includes("segundos desde meia-noite")) {
    const segundos = agora.diff(agora.startOf("day"), "seconds").seconds;
    return `⏱️ ${Math.floor(segundos)}s`;
  }

  // ===== Se nada se aplica =====
  return null;
}
