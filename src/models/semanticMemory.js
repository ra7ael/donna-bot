// src/models/semanticMemory.js
import mongoose from "mongoose";
import { embedding } from "../utils/embeddingService.js";
import dotenv from "dotenv";
dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
const MONGOOSE_CONNECT_TIMEOUT_MS = 3000; // tempo curto para tentar conectar quando necessário

// ----------------------
// 📌 Schema do MongoDB (mongoose)
// ----------------------
const semanticSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  prompt: { type: String, required: true },
  answer: { type: String, required: true },
  role: { type: String, enum: ["user", "assistant"], required: true },
  vector: { type: [Number], required: true },
  createdAt: { type: Date, default: Date.now }
});

// índice para evitar duplicação (mantém sua intenção)
semanticSchema.index({ userId: 1, prompt: 1 }, { unique: true });

let SemanticMemoryModel = null;
// inicializa o model somente quando mongoose estiver pronto
function ensureModel() {
  if (!SemanticMemoryModel) {
    try {
      SemanticMemoryModel = mongoose.model("SemanticMemory", semanticSchema);
    } catch (err) {
      // se já foi registrado, pega o existente (evita erro em hot-reload)
      SemanticMemoryModel = mongoose.models.SemanticMemory || null;
    }
  }
  return SemanticMemoryModel;
}

// ----------------------
// 🔧 Util: tenta conectar o mongoose se não estiver conectado
// ----------------------
async function ensureMongooseConnected() {
  // readyState: 0 = disconnected, 1 = connected
  if (mongoose.connection.readyState === 1) return true;

  if (!MONGO_URI) {
    console.warn("⚠️ semanticMemory: MONGO_URI não configurado. Embeddings desativados.");
    return false;
  }

  try {
    // tenta conectar rapidamente; se falhar, não bloqueia o app
    const connectPromise = mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: MONGOOSE_CONNECT_TIMEOUT_MS
    });

    // aguarda por um tempo curto
    await Promise.race([
      connectPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout mongoose connect")), MONGOOSE_CONNECT_TIMEOUT_MS))
    ]);
    console.log("✅ mongoose conectado em semanticMemory.");
    ensureModel();
    return true;
  } catch (err) {
    console.warn("⚠️ Não foi possível conectar mongoose em semanticMemory (fallback para sem memória):", err.message || err);
    return false;
  }
}

// ----------------------
// 🧠 Salvar memória (com guards)
// ----------------------
export async function addSemanticMemory(prompt, answer, userId, role = "assistant") {
  try {
    if (!userId) {
      console.warn("⚠️ addSemanticMemory: userId inválido. Ignorando.");
      return;
    }
    // se embeddings desligados via env, não calcule
    const useEmbeddings = (process.env.USE_EMBEDDINGS || "false").toLowerCase() === "true";
    if (!useEmbeddings) {
      // opcional: salvar versão sem vetor? aqui evitamos salvar para não poluir DB
      console.log("🧠 Embeddings estão desativados (USE_EMBEDDINGS=false). Memória não persistida.");
      return;
    }

    const connected = await ensureMongooseConnected();
    if (!connected) return;

    ensureModel();

    const vector = await embedding(`${prompt} ${answer}`);
    if (!Array.isArray(vector) || vector.length === 0) {
      console.warn("⚠️ embedding retornou inválido, memória não salva.");
      return;
    }

    await SemanticMemoryModel.findOneAndUpdate(
      { userId, prompt },
      { userId, prompt, answer, role, vector, createdAt: new Date() },
      { upsert: true, new: true }
    );

    console.log("🧠 Memória semântica salva:", prompt);
  } catch (err) {
    console.error("❌ Erro ao salvar memória semântica:", err?.message || err);
  }
}

// ----------------------
// 🧮 Similaridade Coseno (proteções)
// ----------------------
function cosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length === 0 || vecA.length !== vecB.length) {
    return -1; // sinaliza incompatibilidade
  }
  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < vecA.length; i++) {
    const a = Number(vecA[i]) || 0;
    const b = Number(vecB[i]) || 0;
    dot += a * b;
    magA += a * a;
    magB += b * b;
  }
  if (magA === 0 || magB === 0) return -1;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// ----------------------
// 🔎 Buscar memória por similaridade (seguro, com guard)
// assinatura: querySemanticMemory(query, userId, limit = 1, fromDate = null)
// ----------------------
export async function querySemanticMemory(query, userId, limit = 1, fromDate = null) {
  try {
    // validações básicas
    if (!query || !userId) return [];

    const useEmbeddings = (process.env.USE_EMBEDDINGS || "false").toLowerCase() === "true";
    if (!useEmbeddings) {
      // embeddings desativados explicitamente
      return [];
    }

    const connected = await ensureMongooseConnected();
    if (!connected) return [];

    ensureModel();

    // cria vector da query; se falhar, retorna vazio
    const queryVector = await embedding(query);
    if (!Array.isArray(queryVector) || queryVector.length === 0) {
      console.warn("⚠️ querySemanticMemory: embedding da query inválido.");
      return [];
    }

    // restrição por data se fornecida (aceita Date ou string) — opcional
    const filter = { userId };
    if (fromDate) {
      const dt = new Date(fromDate);
      if (!isNaN(dt.getTime())) filter.createdAt = { $gte: dt };
    }

    // busca leve: só vetores e texto
    const docs = await SemanticMemoryModel.find(filter, { prompt: 1, answer: 1, vector: 1, createdAt: 1 }).lean().exec();
    if (!docs || docs.length === 0) return [];

    // calcula scores localmente
    const scored = [];
    for (const d of docs) {
      const score = cosineSimilarity(queryVector, d.vector);
      if (score > -1) {
        scored.push({ answer: d.answer, score, createdAt: d.createdAt });
      }
    }

    if (scored.length === 0) return [];

    // ordena por score (desc) e por mais recente
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    return scored.slice(0, limit).map(s => s.answer);
  } catch (err) {
    console.error("❌ Erro ao buscar memória semântica:", err?.message || err);
    return [];
  }
}

// mantém export default do model caso alguém importe default (compatibilidade)
try {
  ensureModel();
} catch (e) {
  // nada
}

export default mongoose.models?.SemanticMemory || mongoose.model?.("SemanticMemory", semanticSchema);
