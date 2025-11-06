import mongoose from "mongoose";

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

/**
 * Consulta a memória semântica com base em uma mensagem do usuário.
 * Retorna o conteúdo mais recente que contenha partes semelhantes da mensagem.
 */
export async function querySemanticMemory(userMessage, userId, limit = 1) {
  if (!userMessage || !userId) return null;

  const results = await SemanticMemory.find({
    userId,
    content: { $regex: new RegExp(userMessage, "i") }
  })
    .sort({ createdAt: -1 })
    .limit(limit);

  return results.length ? results[0].content : null;
}

/**
 * Adiciona nova lembrança semântica da conversa.
 */
export async function addSemanticMemory(userMessage, answer, userId = "unknown", role = "assistant") {
  if (!answer || !userId) return null;

  const memory = new SemanticMemory({
    userId,
    role,
    content: answer,
    embedding: [] // pode integrar futuramente com vetores OpenAI se quiser
  });

  await memory.save();
  return memory;
}

/**
 * Recupera as últimas memórias registradas para um usuário.
 */
export async function getRecentMemories(userId, limit = 5) {
  return await SemanticMemory.find({ userId }).sort({ createdAt: -1 }).limit(limit);
}

export default SemanticMemory;
