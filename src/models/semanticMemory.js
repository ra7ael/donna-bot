import mongoose from "mongoose";
import { getEmbedding } from "../utils/embeddingService.js"; // função que gera embedding (mostro abaixo)

// ===== Schema =====
const SemanticMemorySchema = new mongoose.Schema({
  userId: { type: String, required: true },
  role: { type: String, enum: ["user", "assistant"], required: true },
  content: { type: String, required: true },
  contentType: { type: String, default: "text" },
  embedding: { type: [Number], default: [] },
  createdAt: { type: Date, default: Date.now }
});

SemanticMemorySchema.index({ userId: 1, createdAt: -1 });
const SemanticMemory = mongoose.model("SemanticMemory", SemanticMemorySchema);

// ===== Função de Similaridade =====
function cosineSimilarity(vecA, vecB) {
  if (!vecA.length || !vecB.length) return 0;
  const dot = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const normA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const normB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  return dot / (normA * normB);
}

// ===== Consulta Inteligente =====
export async function querySemanticMemory(userMessage, userId, limit = 1) {
  if (!userMessage || !userId) return null;

  const queryEmbedding = await getEmbedding(userMessage);
  const memories = await SemanticMemory.find({ userId });

  // Calcula similaridade de cada memória
  const ranked = memories
    .map(m => ({
      content: m.content,
      similarity: cosineSimilarity(queryEmbedding, m.embedding || [])
    }))
    .sort((a, b) => b.similarity - a.similarity);

  return ranked.length ? ranked.slice(0, limit).map(r => r.content) : null;
}

// ===== Adiciona Memória =====
export async function addSemanticMemory(userMessage, answer, userId = "unknown", role = "assistant") {
  if (!answer || !userId) return null;

  const embedding = await getEmbedding(answer);
  const memory = new SemanticMemory({
    userId,
    role,
    content: answer,
    embedding
  });

  await memory.save();
  return memory;
}

// ===== Recupera últimas memórias =====
export async function getRecentMemories(userId, limit = 5) {
  return await SemanticMemory.find({ userId }).sort({ createdAt: -1 }).limit(limit);
}

export default SemanticMemory;
