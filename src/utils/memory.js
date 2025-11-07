// src/utils/memory.js
import Memory from "../models/Memory.js";
import { addSemanticMemory } from "../models/semanticMemory.js";

/**
 * Adiciona uma mensagem na memória de curto prazo (histórico recente)
 */
export async function addMemory(userId, role, content) {
  if (!content || !userId) return null;
  try {
    const doc = new Memory({ userId, role, content });
    await doc.save();

    // Também registra na memória semântica se for uma resposta relevante (opcional)
    if (role === "assistant" && content.length > 20) {
      try {
        await addSemanticMemory("", content, userId, role);
      } catch (err) {
        console.warn("Falha ao adicionar na memória semântica:", err);
      }
    }

    return doc;
  } catch (err) {
    console.error("Erro ao salvar memória:", err);
    return null;
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
      .select("role content createdAt -_id")
      .lean();

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
    .map(m => `${m.role === "user" ? "Usuário" : "Donna"}: ${m.content}`)
    .join("\n");
}

/**
 * Limpa todo o histórico de um usuário (reset de contexto)
 */
export async function clearMemory(userId) {
  try {
    await Memory.deleteMany({ userId });
    console.log(`Memória curta apagada para ${userId}`);
  } catch (err) {
    console.error("Erro ao limpar memória:", err);
  }
}

/**
 * Similaridade simples para evitar respostas repetidas irritantes
 */
function stringSimilarity(a = "", b = "") {
  const clean = str => (str || "").toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter(Boolean);
  const wordsA = clean(a);
  const wordsB = clean(b);
  if (!wordsA.length || !wordsB.length) return 0;
  const inter = wordsA.filter(w => wordsB.includes(w));
  return inter.length / Math.max(wordsA.length, wordsB.length);
}

export async function shouldSkipResponse(userId, newMessage) {
  const recent = await getMemoryContext(userId, 3);
  const lastUserMessage = recent.filter(m => m.role === "user").map(m => m.content).pop();
  if (!lastUserMessage) return false;
  const similarity = stringSimilarity(newMessage, lastUserMessage);
  return similarity > 0.9;
}
