// src/models/semanticMemory.js
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
const MONGOOSE_CONNECT_TIMEOUT_MS = 3000;

// ----------------------
// 📌 Schema (ajustado e coerente)
// ----------------------
const semanticSchema = new mongoose.Schema({
  userId: { type: String, required: true, trim: true },
  prompt: { type: String, required: true, trim: true },
  answer: { type: String, required: true, trim: true },
  numero: { type: String, required: true, trim: true }, // compatível com envio Cron/WPP
  date: { type: Date, required: true, index: true },    // usado na query do cron
  sent: { type: Boolean, default: false, index: true }, // controle igual ao cron
  vector: { type: [Number], required: true },
  createdAt: { type: Date, default: Date.now }
});

// índice único pra não duplicar memória
semanticSchema.index({ userId: 1, prompt: 1 }, { unique: true });

// ----------------------
// 🔧 Garante model única no sistema
// ----------------------
const SemanticMemory = mongoose.models.SemanticMemory || mongoose.model("SemanticMemory", semanticSchema);

// ----------------------
// 🔌 Conexão com timeout seguro
// ----------------------
async function ensureMongooseConnected() {
  if (mongoose.connection.readyState === 1) return true;

  if (!MONGO_URI) {
    console.warn("⚠️ semanticMemory: URI do Mongo não definida.");
    return false;
  }

  try {
    await Promise.race([
      mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: MONGOOSE_CONNECT_TIMEOUT_MS }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), MONGOOSE_CONNECT_TIMEOUT_MS))
    ]);

    console.log("✅ mongoose conectado (semanticMemory)");
    return true;
  } catch (err) {
    console.warn("⚠️ Falha ao conectar mongoose (semanticMemory):", err.message);
    return false;
  }
}

// Loga se desconectar no deploy
mongoose.connection.on("disconnected", () => console.log("⚠️ mongoose desconectado"));

// ----------------------
// 🧠 Salvar memória com guard
// ----------------------
export async function addSemanticMemory(prompt, answer, numero, date, userId, role = "assistant") {
  try {
    if (!numero || !date || !userId) return;

    const embeddingsOn = (process.env.USE_EMBEDDINGS || "false") === "true";
    if (!embeddingsOn) {
      console.log("🧠 Embeddings OFF → memória ignorada");
      return;
    }

    const connected = await ensureMongooseConnected();
    if (!connected) return;

    const vector = await embedding(prompt + " " + answer);
    if (!vector?.length) return;

    await SemanticMemory.findOneAndUpdate(
      { userId, prompt },
      { prompt, answer, numero, date, role, vector, sent: false, createdAt: new Date() },
      { upsert: true, new: true }
    );

    console.log("🧠 salvo:", prompt);
  } catch (err) {
    console.error("❌ erro salvar memória:", err.message);
  }
}

// ----------------------
// 🔍 Consultar pelo vector mais próximo
// ----------------------
export async function querySemanticMemory(query, userId, limit = 1, fromDate = null) {
  try {
    if (!query || !userId) return [];

    const embeddingsOn = (process.env.USE_EMBEDDINGS || "false") === "true";
    if (!embeddingsOn) return [];

    const connected = await ensureMongooseConnected();
    if (!connected) return [];

    const qVector = await embedding(query);
    if (!qVector?.length) return [];

    const filter = { userId };
    if (fromDate && !isNaN(new Date(fromDate))) {
      filter.createdAt = { $gte: new Date(fromDate) };
    }

    const docs = await SemanticMemory.find(filter, { prompt: 1, answer: 1, vector: 1, createdAt: 1 }).lean().exec();
    if (!docs?.length) return [];

    const scored = docs.map(d => ({
      answer: d.answer,
      score: cosineSimilarity(qVector, d.vector),
      time: d.createdAt
    })).filter(d => d.score > -1);

    if (!scored.length) return [];

    scored.sort((a, b) => b.score - a.score || b.time - a.time);

    return scored.slice(0, limit).map(d => d.answer);
  } catch (err) {
    console.error("❌ erro query memória:", err.message);
    return [];
  }
}

// ----------------------
// 🧮 Similaridade Coseno (fica aqui, mas agnóstica)
// ----------------------
function cosineSimilarity(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return -1;
  const dot = a.reduce((s, v, i) => s + v * b[i], 0);
  const ma = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
  const mb = Math.sqrt(b.reduce((s, v) => s + v * v,, 0));
  return ma && mb ? dot / (ma * mb) : -1;
}

export default SemanticMemory;
