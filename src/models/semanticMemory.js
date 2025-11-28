import mongoose from "mongoose";
import { embedding } from "../utils/embeddingService.js";

// Definição do Schema para as Memórias Semânticas
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

// 🧠 Função para salvar memória semântica com o embedding
export async function addSemanticMemory(prompt, answer, userId, role) {
  try {
    const vector = await embedding(`${prompt} ${answer}`);

    // Atualiza ou insere a memória semântica com o vetor de embedding
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

// 🧠 Função para calcular a Similaridade de Coseno
function cosineSimilarity(vecA, vecB) {
  const dotProduct = vecA.reduce((sum, val, i) => sum + val * vecB[i], 0);
  const magnitudeA = Math.sqrt(vecA.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(vecB.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (magnitudeA * magnitudeB);
}

// 🧠 Função para buscar memória por similaridade de coseno
export async function querySemanticMemory(query, userId, limit = 1) {
  try {
    // Gera o vetor de embedding para a consulta
    const queryVector = await embedding(query);

    // Busca as memórias armazenadas no banco
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
                },
                magnitudeQuery: {
                  $sqrt: {
                    $reduce: {
                      input: { $range: [0, { $size: "$$queryVector" }] },
                      initialValue: 0,
                      in: { $add: ["$$value", { $pow: ["$$this", 2] }] }
                    }
                  }
                },
                magnitudeMemory: {
                  $sqrt: {
                    $reduce: {
                      input: { $range: [0, { $size: "$vector" }] },
                      initialValue: 0,
                      in: { $add: ["$$value", { $pow: ["$$this", 2] }] }
                    }
                  }
                }
              },
              in: {
                $divide: [
                  "$$dot",
                  { $multiply: ["$$magnitudeQuery", "$$magnitudeMemory"] }
                ]
              }
            }
          }
        }
      },
      { $sort: { similarity: -1, createdAt: -1 } },
      { $limit: limit }
    ]);

    // Se não encontrar nenhum resultado, retorna null
    if (results.length === 0) return null;

    // Retorna as respostas mais relevantes com base na similaridade
    return results.map(r => r.answer);
  } catch (err) {
    console.error("❌ Erro ao buscar memória semântica:", err.message);
    return null;
  }
}

export default SemanticMemory;
