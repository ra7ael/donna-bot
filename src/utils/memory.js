// src/utils/memory.js
import Memory from "../models/Memory.js";
import { addSemanticMemory } from "../models/semanticMemory.js";

/**
 * Adiciona memória curta e, opcionalmente, memória semântica
 */
export async function addMemory(userId, role, content) {
  if (!userId || !content) return null;
  try {
    const doc = new Memory({ userId, role, content });
    await doc.save();

    // Também registra na memória semântica (com embeddings)
    if (role === "assistant" && content.length > 20) {
      try {
        await addSemanticMemory("", content, userId, role);
      } catch (err) {
        console.warn("Erro ao adicionar memória semântica:", err);
      }
    }

    return doc;
  } catch (err) {
    console.error("Erro ao salvar memória curta:", err);
    return null;
  }
}

/**
 * Recupera o histórico recente (memória curta)
 */
export async function getMemoryContext(userId, limit = 10) {
  try {
    const memories = await Memory.find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return memories.reverse();
  } catch (err) {
    console.error("Erro ao buscar memória:", err);
    return [];
  }
}

/**
 * Constrói um texto de contexto concatenando o histórico
 */
export async function buildContext(userId, limit = 10) {
  const memories = await getMemoryContext(userId, limit);
  if (!memories.length) return "";
  return memories
    .map(m => `${m.role === "user" ? "Usuário" : "Donna"}: ${m.content}`)
    .join("\n");
}

/**
 * Apaga todo o histórico curto de um usuário
 */
export async function clearMemory(userId) {
  try {
    await Memory.deleteMany({ userId });
    console.log(`🧠 Memória curta limpa para ${userId}`);
  } catch (err) {
    console.error("Erro ao limpar memória:", err);
  }
}

/**
 * Previne repetições — compara a mensagem nova com a última
 */
function stringSimilarity(a = "", b = "") {
  const clean = str => (str || "").toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter(Boolean);
  const wordsA = clean(a);
  const wordsB = clean(b);
  if (!wordsA.length || !wordsB.length) return 0;
  const intersection = wordsA.filter(w => wordsB.includes(w));
  return intersection.length / Math.max(wordsA.length, wordsB.length);
}

export async function shouldSkipResponse(userId, newMessage) {
  const recent = await getMemoryContext(userId, 3);
  const lastUserMessage = recent.filter(m => m.role === "user").map(m => m.content).pop();
  if (!lastUserMessage) return false;
  const similarity = stringSimilarity(newMessage, lastUserMessage);
  return similarity > 0.9;
}
