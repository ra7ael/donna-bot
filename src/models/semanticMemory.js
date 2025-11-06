// src/models/semanticMemory.js
import mongoose from "mongoose";

const SemanticMemorySchema = new mongoose.Schema({
  userId: { type: String, required: true },
  role: { type: String, enum: ["user", "assistant"], required: true },
  content: { type: String, required: true },
  contentType: { type: String, default: "text" },
  embedding: { type: [Number], default: [] },
  topic: { type: String, default: "geral" }, // 🧩 Novo: classifica o tipo de assunto (família, trabalho etc.)
  type: { type: String, default: "short" },  // 🧩 Novo: tipo de memória (curta ou longa)
  timestamp: { type: Date, default: Date.now } // 🧩 Novo: substitui o createdAt
});

// Indexa por usuário + data para buscas rápidas
SemanticMemorySchema.index({ userId: 1, timestamp: -1 });

// === 🔍 Busca memórias por similaridade simples (regex ou texto exato)
export async function querySemanticMemory(userMessage, userId, limit = 3) {
  const result = await SemanticMemory.find({
    userId,
    content: { $regex: userMessage, $options: "i" }
  })
    .sort({ timestamp: -1 })
    .limit(limit);

  return result.map(r => r.content);
}

// === 💾 Adiciona nova memória ao histórico do usuário
export async function addSemanticMemory(userMessage, answer, userId = "unknown", role = "assistant", topic = "geral") {
  const doc = new SemanticMemory({
    userId,
    role,
    content: role === "user" ? userMessage : answer,
    topic,
    embedding: [],
    type: "short"
  });
  await doc.save();
  return doc;
}

const SemanticMemory = mongoose.model("SemanticMemory", SemanticMemorySchema);
export default SemanticMemory;
