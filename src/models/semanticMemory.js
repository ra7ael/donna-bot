// src/models/semanticMemory.js
import mongoose from "mongoose";

const SemanticMemorySchema = new mongoose.Schema({
  userId: { type: String, required: true },
  role: { type: String, enum: ["user", "assistant"], required: true },
  content: { type: String, required: true },
  embedding: { type: [Number], required: true }, // vetor do OpenAI
  createdAt: { type: Date, default: Date.now }
});

// Índice para buscar mais rápido por usuário
SemanticMemorySchema.index({ userId: 1 });

export default mongoose.model("SemanticMemory", SemanticMemorySchema);
