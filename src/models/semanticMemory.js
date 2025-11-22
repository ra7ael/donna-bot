import mongoose from "mongoose";
import { getEmbedding } from "../utils/embeddingService.js";

const SemanticMemorySchema = new mongoose.Schema({
  userId: { type: String, required: true },
  role: { type: String, enum: ["user", "assistant"], required: true },
  content: { type: String, required: true },
  contentType: { type: String, default: "text" },
  embedding: { type: [Number], default: [] },
  createdAt: { type: Date, default: Date.now }
});

SemanticMemorySchema.index({ userId: 1, createdAt: -1 });

const SemanticMemory =
  mongoose.models.SemanticMemory ||
  mongoose.model("SemanticMemory", SemanticMemorySchema);


// =============================
//  SIMILARIDADE COSENO
// =============================
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || !vecA.length || !vecB.length) return 0;

  const len = Math.min(vecA.length, vecB.length);
  let dot = 0,
    normA = 0,
    normB = 0;

  for (let i = 0; i < len; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) return 0;

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}


// =============================
//  CONSULTA SEMÂNTICA
// =============================
export async function querySemanticMemory(userMessage, userId, limit = 1) {
  if (!userMessage || !userId) return null;

  const queryEmbedding = await getEmbedding(userMessage);
  const memories = await SemanticMemory.find({ userId }).lean();

  if (!memories || memories.length === 0) return null;

  const ranked = memories
    .map((m) => ({
      _id: m._id,
      content: m.content,
      role: m.role,
      score: cosineSimilarity(queryEmbedding, m.embedding || [])
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return ranked.length
    ? limit === 1
      ? ranked[0].content
      : ranked.map((r) => r.content)
    : null;
}


// =============================
//  GRAVAÇÃO DE MEMÓRIA (CORRIGIDO)
// =============================
export async function addSemanticMemory(userMessage, userId) {
  if (!userMessage || !userId) return null;

  // Embedding gerado do conteúdo do usuário
  const embedding = await getEmbedding(userMessage);

  const memory = new SemanticMemory({
    userId,
    role: "user", // sempre user
    content: userMessage,
    embedding
  });

  await memory.save();
  return memory;
}


// =============================
//  MEMÓRIAS RECENTES
// =============================
export async function getRecentMemories(userId, limit = 5) {
  return await SemanticMemory.find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

export default SemanticMemory;
