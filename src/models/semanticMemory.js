// src/models/semanticMemory.js
import mongoose from "mongoose";

const SemanticMemorySchema = new mongoose.Schema({
  userId: { type: String, required: true },
  role: { type: String, enum: ["user", "assistant"], required: true },
  content: { type: String, required: true },
  contentType: { type: String, default: "text" },
  embedding: { type: [Number], default: [] },
  createdAt: { type: Date, default: Date.now }
});

SemanticMemorySchema.index({ userId: 1 });

const SemanticMemory = mongoose.model("SemanticMemory", SemanticMemorySchema);

export async function querySemanticMemory(userMessage, userId, limit = 1) {
  const result = await SemanticMemory.find({
    userId,
    content: { $regex: userMessage, $options: "i" }
  })
    .sort({ createdAt: -1 })
    .limit(limit);
  return result.length ? result[0].content : null;
}

export async function addSemanticMemory(userMessage, answer, userId = "unknown", role = "assistant") {
  const doc = new SemanticMemory({
    userId,
    role,
    content: answer,
    embedding: []
  });
  await doc.save();
  return doc;
}

export default SemanticMemory;
