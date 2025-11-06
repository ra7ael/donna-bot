import Memory from "../models/memory.js";
import { addSemanticMemory } from "../models/semanticMemory.js";

/**
 * Adiciona uma mensagem na memória de curto prazo (histórico recente)
 */
export async function addMemory(userId, role, content) {
  if (!content || !userId) return;

  try {
    const memory = new Memory({ userId, role, content });
    await memory.save();

    // Também registra na memória semântica se for uma resposta relevante
    if (role === "assistant" && content.length > 20) {
      await addSemanticMemory("", content, userId, role);
    }

    return memory;
  } catch (err) {
    console.error("Erro ao salvar memória:", err);
  }
}

/**
 * Retorna o histórico de mensagens recentes para dar contexto à IA
 */
export async function getMemoryContext(userId, limit = 10) {
  try {
    const history = await Memory.find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select("role content -_id");

    return history.reverse();
  } catch (err) {
    console.error("Erro ao buscar memória:", err);
    return [];
  }
}

/**
 * Constrói um texto de contexto unificado com base nas memórias
 */
export async function buildContext(userId, limit = 10) {
  const memories = await getMemoryContext(userId, limit);

  if (!memories.length) return "";

  return memories
    .map(m => `${m.role === "user" ? "👤 Usuário" : "🤖 Donna"}: ${m.content}`)
    .join("\n");
}

/**
 * Limpa todo o histórico de um usuário (reset de contexto)
 */
export async function clearMemory(userId) {
  try {
    await Memory.deleteMany({ userId });
    console.log(`🧹 Memória limpa para o usuário ${userId}`);
  } catch (err) {
    console.error("Erro ao limpar memória:", err);
  }
}

/**
 * Verifica se o contexto é muito repetido e evita mensagens automáticas irritantes
 */
export async function shouldSkipResponse(userId, newMessage) {
  const recent = await getMemoryContext(userId, 3);
  const lastUserMessage = recent
    .filter(m => m.role === "user")
    .map(m => m.content)
    .pop();

  if (!lastUserMessage) return false;

  const similarity = stringSimilarity(newMessage, lastUserMessage);
  return similarity > 0.9; // se for quase igual, ignora repetição
}

/**
 * Calcula similaridade simples entre duas strings
 */
function stringSimilarity(a, b) {
  const clean = str => str.toLowerCase().replace(/[^\w\s]/g, "");
  const wordsA = clean(a).split(" ");
  const wordsB = clean(b).split(" ");
  const intersection = wordsA.filter(word => wordsB.includes(word));
  return intersection.length / Math.max(wordsA.length, wordsB.length);
}

