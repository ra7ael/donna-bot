import mongoose from "mongoose";
import { embedding } from "../utils/embeddingService.js";

// Definição do Schema para as Memórias Semânticas
const semanticSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  prompt: { type: String, required: true },
  answer: { type: String, required: true },
  role: { type: String, enum: ["user", "assistant"], required: true },
  vector: { type: [Number], required: true },
  createdAt: { type: Date, default: Date.now }
});

// 🔍 Evita memórias repetidas (mesmo prompt, mesmo usuário)
semanticSchema.index({ userId: 1, prompt: 1 }, { unique: true });

const SemanticMemory = mongoose.model("SemanticMemory", semanticSchema);

// 🧠 Função para salvar memória semântica com o embedding
export async function addSemanticMemory(prompt, answer, userId, role) {
  try {
    const vector = await embedding(`${prompt} ${answer}`);
    await SemanticMemory.findOneAndUpdate(
      { userId, prompt },
      { userId, prompt, answer, role, vector },
      { upsert: true, new: true }
    );
    console.log("🧠 Memória semântica salva:", prompt);
  } catch (err) {
    console.error("❌ Erro ao salvar memória semântica:", err.message);
  }
}

// 🧠 Função para calcular a Similaridade de Coseno
function cosineSimilarity(vecA, vecB) {
  const dotProduct = vecA.reduce((sum, val, i) => sum + val * vecB[i], 0);
  const magnitudeA = Math.sqrt(vecA.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(vecB.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (magnitudeA * magnitudeB);
}

// 🧠 Função para buscar memória por similaridade de coseno
export async function querySemanticMemory(query, userId, limit = 1, recentLimit = 50) {
  try {
    const queryVector = await embedding(query);

    // Busca os N registros mais recentes do usuário
    const memories = await SemanticMemory.find({ userId })
      .sort({ createdAt: -1 })
      .limit(50);

    if (!Array.isArray(memories) || memories.length === 0) return null;

    // Calcula similaridade de coseno
    const scored = memories.map(m => ({
      answer: m.answer,
      similarity: cosineSimilarity(queryVector, m.vector)
    }));

    // Ordena por similaridade decrescente
    scored.sort((a, b) => b.similarity - a.similarity);

    // Retorna as respostas mais relevantes
    return scored.slice(0, limit).map(m => m.answer);

  } catch (err) {
    console.error("❌ Erro ao buscar memória semântica:", err.message);
    return null;
  }
}

export default SemanticMemory;
