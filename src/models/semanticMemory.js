import mongoose from "mongoose";
import { embedding } from "../utils/embeddingService.js";

// Definição do Schema
const semanticSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  prompt: { type: String, required: true },
  answer: { type: String, required: true },
  role: { type: String, enum: ["user", "assistant"], required: true },
  vector: { type: [Number], required: true },
  createdAt: { type: Date, default: Date.now }
});

semanticSchema.index({ userId: 1, prompt: 1 }, { unique: true });

const SemanticMemory = mongoose.model("SemanticMemory", semanticSchema);

// Salvar memória semântica
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

// Função de similaridade de coseno
function cosineSimilarity(vecA, vecB) {
  const dotProduct = vecA.reduce((sum, val, i) => sum + val * vecB[i], 0);
  const magnitudeA = Math.sqrt(vecA.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(vecB.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (magnitudeA * magnitudeB);
}

// Buscar memória por similaridade (Node.js, não MongoDB)
export async function querySemanticMemory(query, userId, limit = 3) {
  try {
    const queryVector = await embedding(query);
    const memories = await SemanticMemory.find({ userId }).limit(50); // pega as 50 mais recentes

    if (!memories || memories.length === 0) return [];

    const results = memories
      .map(m => ({
        answer: m.answer,
        similarity: cosineSimilarity(m.vector, queryVector)
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return results.map(r => r.answer);
  } catch (err) {
    console.error("❌ Erro ao buscar memória semântica:", err.message);
    return [];
  }
}

export default SemanticMemory;
