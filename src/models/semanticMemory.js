// src/models/semanticMemory.js  (atualize a função existente)
import mongoose from "mongoose";
import { getEmbedding } from "../utils/embeddingService.js";

const SemanticMemorySchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  role: { type: String, enum: ["user", "assistant"], required: true },
  content: { type: String, required: true },
  contentType: { type: String, default: "text" },
  embedding: { type: [Number], default: [] },
  // createdAt já gera automat.
  createdAt: { type: Date, default: Date.now, index: true }
});

SemanticMemorySchema.index({ userId: 1, createdAt: -1 });
const SemanticMemory = mongoose.model("SemanticMemory", SemanticMemorySchema);

function cosineSimilarity(vecA, vecB) {
  if (!vecA?.length || !vecB?.length || vecA.length !== vecB.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * userMessage: texto da query
 * userId: id do usuário (telefone)
 * limit: número de resultados desejados
 * retorna: string (se limit=1) ou array de strings (se limit>1) — ou null
 */
export async function querySemanticMemory(userMessage, userId, limit = 1) {
  if (!userMessage || !userId) return null;

  // Gera embedding da query
  const queryEmbedding = await getEmbedding(userMessage);

  // Busca memórias do usuário que tenham embedding (pré-filtragem)
  // Para performance: busque apenas últimas N memórias (ex: 1000) ou use uma flag para memórias sem embedding
  const memories = await SemanticMemory.find({ userId, embedding: { $exists: true, $ne: [] } }).lean().limit(2000);

  if (!memories || memories.length === 0) return null;

  // Calcula score
  const scored = memories.map(m => {
    const sim = cosineSimilarity(queryEmbedding, m.embedding || []);
    return { content: m.content, score: sim, _id: m._id };
  });

  scored.sort((a, b) => b.score - a.score);

  const top = scored.slice(0, limit).filter(s => s.score > 0); // opcional: só retornar >0
  if (top.length === 0) return null;

  const contents = top.map(t => t.content);
  return limit === 1 ? contents[0] : contents;
}

export async function addSemanticMemory(userMessage, answer, userId = "unknown", role = "assistant") {
  if (!answer || !userId) return null;
  const embedding = await getEmbedding(answer);
  const memory = new SemanticMemory({
    userId,
    role,
    content: answer,
    embedding,
    createdAt: new Date()
  });
  await memory.save();
  return memory;
}

export async function getRecentMemories(userId, limit = 5) {
  return await SemanticMemory.find({ userId }).sort({ createdAt: -1 }).limit(limit).lean();
}

export default SemanticMemory;

