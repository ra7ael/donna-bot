const Memory = require("../models/Memory");
const axios = require("axios");

async function getEmbedding(text) {
  try {
    const res = await axios.post(
      "https://api.openai.com/v1/embeddings",
      { model: "text-embedding-3-small", input: text },
      { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
    );
    return res.data.data[0].embedding;
  } catch (err) {
    console.error("Erro ao gerar embedding:", err.response?.data || err.message);
    return [];
  }
}

// Salvar mensagem com embedding
async function saveMemory(userId, role, content) {
  const embedding = await getEmbedding(content);
  const memory = new Memory({ userId, role, content, embedding });
  await memory.save();
}

// Busca semântica por similaridade
async function getRelevantMemory(userId, query, topK = 5) {
  const queryEmbedding = await getEmbedding(query);
  const allMemories = await Memory.find({ userId });
  
  // Calcular similaridade (cosine similarity)
  const similarity = (a, b) => {
    const dot = a.reduce((sum, v, i) => sum + v * b[i], 0);
    const magA = Math.sqrt(a.reduce((sum, v) => sum + v*v, 0));
    const magB = Math.sqrt(b.reduce((sum, v) => sum + v*v, 0));
    return dot / (magA * magB);
  };

  const scored = allMemories.map(m => ({ memory: m, score: similarity(queryEmbedding, m.embedding) || 0 }));
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topK).map(s => s.memory);
}

module.exports = { saveMemory, getRelevantMemory };
