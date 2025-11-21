import SemanticMemory, { querySemanticMemory, addSemanticMemory } from "../models/semanticMemory.js";
import { getEmbedding } from "./embeddingService.js";

// Salva memória com embedding
export async function saveMemory(userId, role, content) {
  if (!content || !userId) return null;

  try {
    await addSemanticMemory(content, content, userId, role);
    return true;
  } catch (err) {
    console.error("❌ Erro ao salvar memória:", err);
    return null;
  }
}

// Busca memórias relevantes usando similaridade
export async function getRelevantMemory(userId, userMessage, limit = 3) {
  try {
    const results = await querySemanticMemory(userMessage, userId, limit);
    return results || [];
  } catch (err) {
    console.error("❌ Erro ao buscar memória relevante:", err);
    return [];
  }
}

// Recupera últimas memórias por tempo (curto prazo)
export async function getRecentMemory(userId, limit = 5) {
  try {
    const memories = await SemanticMemory.find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit);

    return memories.map(m => m.content);
  } catch (err) {
    console.error("❌ Erro ao pegar últimas memórias:", err);
    return [];
  }
}

