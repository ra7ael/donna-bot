// semanticMemory.js
import mongoose from "mongoose";
import { embedding } from "../utils/embeddingService.js";

// ----------------------
// 📌 Schema do MongoDB
// ----------------------
const semanticSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  prompt: { type: String, required: true },
  answer: { type: String, required: true },
  role: { type: String, enum: ["user", "assistant"], required: true },
  vector: { type: [Number], required: true }, // Embedding
  createdAt: { type: Date, default: Date.now }
});

// 🔍 Evita salvar memórias repetidas
semanticSchema.index({ userId: 1, prompt: 1 }, { unique: true });

const SemanticMemory = mongoose.model("SemanticMemory", semanticSchema);

// ----------------------
// 🧠 Salvar memória
// ----------------------
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

// ----------------------
// 🧮 Similaridade Coseno (rápido)
// ----------------------
function cosineSimilarity(vecA, vecB) {
  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    magA += vecA[i] * vecA[i];
    magB += vecB[i] * vecB[i];
  }

  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// ----------------------
// 🔎 Buscar memória por similaridade (SEM AGGREGATE!)
// ----------------------
export async function querySemanticMemory(query, userId, limit = 1) {
  try {
    const queryVector = await embedding(query);

    // Busca apenas vetores (leve e rápido)
    const memories = await SemanticMemory.find(
      { userId },
      { prompt: 1, answer: 1, vector: 1, createdAt: 1 }
    ).lean();

    if (!memories || memories.length === 0) {
      return [];
    }

    // Calcula similaridade localmente
    const scored = memories.map(m => ({
      answer: m.answer,
      score: cosineSimilarity(queryVector, m.vector),
      createdAt: m.createdAt
    }));

    // Ordena por similaridade + mais recente
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    // Retorna somente as respostas
    return scored.slice(0, limit).map(s => s.answer);

  } catch (err) {
    console.error("❌ Erro ao buscar memória semântica:", err.message);
    return [];
  }
}

export default SemanticMemory;
