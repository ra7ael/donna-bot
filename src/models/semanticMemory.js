import mongoose from "mongoose";
import { embedding } from "../utils/embeddingService.js";

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

// 🧠 Cria embedding + salva memória
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

// 🧠 Busca memória por similaridade
export async function querySemanticMemory(query, userId, limit = 1) {
  try {
    const queryVector = await embedding(query);

    const results = await SemanticMemory.aggregate([
      { $match: { userId } },
      {
        $addFields: {
          similarity: {
            $let: {
              vars: {
                dot: {
                  $reduce: {
                    input: { $range: [0, { $size: "$vector" }] },
                    initialValue: 0,
                    in: {
                      $add: [
                        "$$value",
                        {
                          $multiply: [
                            queryVector["$$this"],
                            { $arrayElemAt: ["$vector", "$$this"] }
                          ]
                        }
                      ]
                    }
                  }
                }
              },
              in: "$$dot"
            }
          }
        }
      },
      { $sort: { similarity: -1, createdAt: -1 } },
      { $limit: limit }
    ]);

    if (results.length === 0) return null;

    return results.map(r => r.answer);
  } catch (err) {
    console.error("❌ Erro ao buscar memória semântica:", err.message);
    return null;
  }
}

export default SemanticMemory;
