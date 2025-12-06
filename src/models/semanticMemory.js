// src/models/semanticMemory.js
import mongoose from "mongoose";
import { embedding } from "../utils/embeddingService.js";

const semanticSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  prompt: { type: String, required: true },
  answer: { type: String, required: true },
  role: { type: String, enum: ["user", "assistant"], required: true },
  vector: { type: [Number], required: true, index: '2dsphere' },
  createdAt: { type: Date, default: Date.now }
});

// Evita duplicação real (mesmo userId + mesmo prompt)
semanticSchema.index({ userId: 1, prompt: 1 }, { unique: true });

const SemanticMemory = mongoose.model("SemanticMemory", semanticSchema);

// 🧠 Cria embedding + salva memória semântica
export async function addSemanticMemory(prompt, answer, userId, role) {
  try {
    const vector = await embedding(`${prompt} ${answer}`);
    const resposta = typeof answer === "string" ? answer : JSON.stringify(answer);

    await SemanticMemory.findOneAndUpdate(
      { userId, prompt },
      { userId, prompt, answer: resposta, role, vector },
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

      // Injeta o vetor da query no pipeline
      {
        $addFields: {
          queryVector: queryVector
        }
      },

      // Calcula similaridade (cosine similarity)
      {
        $addFields: {
          dotProduct: {
            $reduce: {
              input: { $range: [0, { $size: { $ifNull: ["$vector", []] } }] },
              initialValue: 0,
              in: {
                $add: [
                  "$$value",
                  {
                    $multiply: [
                      { $arrayElemAt: [{ $ifNull: ["$queryVector", []] }, "$$this"] },
                      { $arrayElemAt: [{ $ifNull: ["$vector", []] }, "$$this"] }
                    ]
                  }
                ]
              }
            }
          },

          magnitudeQuery: {
            $sqrt: {
              $reduce: {
                input: { $ifNull: ["$queryVector", []] },
                initialValue: 0,
                in: { $add: ["$$value", { $pow: ["$$this", 2] }] }
              }
            }
          },

          magnitudeDoc: {
            $sqrt: {
              $reduce: {
                input: { $ifNull: ["$vector", []] },
                initialValue: 0,
                in: { $add: ["$$value", { $pow: ["$$this", 2] }] }
              }
            }
          }
        }
      },

      // Similaridade final = dotProduct / (|A| * |B|)
      {
        $addFields: {
          similarity: {
            $cond: {
              if: { 
                $eq: [
                  { 
                    $multiply: [
                      "$magnitudeQuery",
                      "$magnitudeDoc"
                    ] 
                  }, 
                  0 
                ] 
              },
              then: 0,
              else: { 
                $divide: [
                  "$dotProduct",
                  { $multiply: ["$magnitudeQuery", "$magnitudeDoc"] }
                ] 
              }
            }
          }
        }
      },

      { $sort: { similarity: -1, createdAt: -1 } },
      { $limit: limit },

      // Garante que answer é string
      {
        $project: {
          answer: { $toString: "$answer" },
          similarity: 1,
          _id: 0
        }
      }
    ]).option({ maxTimeMS: 60000 });

    if (!results.length) return null;

    return results.map(r => r.answer);

  } catch (err) {
    console.error("❌ Erro ao buscar memória semântica:", err.message);
    return null;
  }
}

export default SemanticMemory;
