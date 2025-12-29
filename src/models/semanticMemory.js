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

// ⚠️ Removido índice único para evitar erro de duplicação
// semanticSchema.index({ userId: 1, prompt: 1 }, { unique: true });

const SemanticMemory = mongoose.model("SemanticMemory", semanticSchema);

/* ========================= SALVAR OU ATUALIZAR MEMÓRIA SEMÂNTICA ========================= */
export async function addSemanticMemory(prompt, answer, userId, role) {
  try {
    const texto = `${prompt} ${answer}`;
    const vector = await embedding(texto);
    const resposta = typeof answer === "string" ? answer : JSON.stringify(answer);

    // Salva ou atualiza memória existente
    await SemanticMemory.findOneAndUpdate(
      { userId, prompt },                        // procura pelo prompt do usuário
      { answer: resposta, role, vector, createdAt: new Date() }, // atualiza campos
      { upsert: true, new: true }                // cria se não existir
    );

    console.log("🧠 Memória semântica salva/atualizada com sucesso");
  } catch (err) {
    console.error("❌ Erro ao salvar memória semântica:", err.message);
  }
}

/* ========================= BUSCAR MEMÓRIA SEMÂNTICA ========================= */
export async function querySemanticMemory(query, userId, limit = 1) {
  try {
    const queryVector = await embedding(query);

    const results = await SemanticMemory.aggregate([
      { $match: { userId } },
      { $addFields: { queryVector } },
      {
        $addFields: {
          dotProduct: {
            $reduce: {
              input: { $range: [0, { $size: "$vector" }] },
              initialValue: 0,
              in: {
                $add: [
                  "$$value",
                  { $multiply: [{ $arrayElemAt: ["$vector", "$$this"] }, { $arrayElemAt: ["$queryVector", "$$this"] }] }
                ]
              }
            }
          },
          magnitudeQuery: {
            $sqrt: {
              $reduce: {
                input: "$queryVector",
                initialValue: 0,
                in: { $add: ["$$value", { $pow: ["$$this", 2] }] }
              }
            }
          },
          magnitudeDoc: {
            $sqrt: {
              $reduce: {
                input: "$vector",
                initialValue: 0,
                in: { $add: ["$$value", { $pow: ["$$this", 2] }] }
              }
            }
          }
        }
      },
      {
        $addFields: {
          similarity: {
            $cond: {
              if: { $eq: [{ $multiply: ["$magnitudeQuery", "$magnitudeDoc"] }, 0] },
              then: 0,
              else: { $divide: ["$dotProduct", { $multiply: ["$magnitudeQuery", "$magnitudeDoc"] }] }
            }
          }
        }
      },
      { $match: { similarity: { $gt: 0.75 } } }, // filtro de similaridade
      { $sort: { similarity: -1, createdAt: -1 } },
      { $limit: limit },
      { $project: { answer: 1, similarity: 1, _id: 0 } }
    ]).option({ maxTimeMS: 60000 });

    if (!results.length) return null;
    return results.map(r => r.answer);
  } catch (err) {
    console.error("❌ Erro ao buscar memória semântica:", err.message);
    return null;
  }
}

export default SemanticMemory;
