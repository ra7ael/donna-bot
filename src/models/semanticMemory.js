// src/models/semanticMemory.js
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

// Evita duplicação real (mesmo userId + mesmo prompt)
semanticSchema.index({ userId: 1, prompt: 1 }, { unique: true });

const SemanticMemory = mongoose.model("SemanticMemory", semanticSchema);

// 🧠 Cria embedding + salva memória semântica
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

// 🧠 Busca memória pelo embedding mais similar (Cosine Similarity via aggregation)
export async function querySemanticMemory(query, userId, limit = 1) {
  try {
    const queryVector = await embedding(query);

    const results = await SemanticMemory.aggregate([
      { $match: { userId } },

      // Calcula similaridade do vetor da query com o vetor salvo
      {
        $addFields: {
          similarity: {
            $divide: [
              {
                $reduce: {
                  input: { $range: [0, { $size: "$vector" }] },
                  initialValue: 0,
                  in: {
                    $add: [
                      "$$value",
                      {
                        $multiply: [
                          { $arrayElemAt: queryVector["$$this"], 0 },
                          { $arrayElemAt: ["$vector", "$$this"] }
                        ]
                      }
                    ]
                  }
                }
              },
              {
                $multiply: [
                  {
                    $sqrt: {
                      $reduce: {
                        input: "$vector",
                        initialValue: 0,
                        in: { $add: ["$$value", { $pow: ["$$this", 2] }] }
                      }
                    }
                  },
                  {
                    $sqrt: {
                      $reduce: {
                        input: queryVector,
                        initialValue: 0,
                        in: { $add: ["$$value", { $pow: ["$$this", 2] }] }
                      }
                    }
                  }
                ]
              }
            ]
          }
        }
      },

      { $sort: { similarity: -1, createdAt: -1 } },
      { $limit: limit },

      { $project: { answer: 1, similarity: 1, _id: 0 } }
    ]);

    if (!results.length) return null;

    return results.map(r => r.answer);
  } catch (err) {
    console.error("❌ Erro ao buscar memória semântica:", err.message);
    return null;
  }
}

export default SemanticMemory;
