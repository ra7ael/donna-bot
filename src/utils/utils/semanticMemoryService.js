// utils/semanticMemoryService.js
import SemanticMemory from "../models/semanticMemory.js";
import axios from "axios";

// Função para gerar embedding usando OpenAI
async function createEmbedding(text) {
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/embeddings",
      {
        model: "text-embedding-3-small",
        input: text,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
    return response.data.data[0].embedding;
  } catch (error) {
    console.error("❌ Erro ao criar embedding:", error.response?.data || error.message);
    return null;
  }
}

// Função para adicionar memória semântica
export async function addMemory(userId, content, role = "assistant") {
  const embedding = await createEmbedding(content);
  if (!embedding) return null;

  const memory = new SemanticMemory({
    userId,
    role,
    content,
    embedding,
  });

  return memory.save();
}

// Função para calcular similaridade (cosseno)
function cosineSimilarity(vecA, vecB) {
  const dot = vecA.reduce((sum, val, i) => sum + val * vecB[i], 0);
  const normA = Math.sqrt(vecA.reduce((sum, val) => sum + val * val, 0));
  const normB = Math.sqrt(vecB.reduce((sum, val) => sum + val * val, 0));
  return dot / (normA * normB);
}

// Função para buscar memórias relevantes
export async function getRelevantMemories(userId, query, topK = 5) {
  const queryEmbedding = await createEmbedding(query);
  if (!queryEmbedding) return [];

  const memories = await SemanticMemory.find({ userId });
  const scored = memories.map(mem => ({
    memory: mem,
    score: cosineSimilarity(queryEmbedding, mem.embedding),
  }));

  // Ordena por similaridade decrescente e pega os topK
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map(s => s.memory);
}
