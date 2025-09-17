const SemanticMemory = require('../models/semanticMemory');
const axios = require('axios');

// Salvar memória
async function saveMemory(userId, role, content) {
  // Gerar embedding
  const embeddingRes = await axios.post(
    'https://api.openai.com/v1/embeddings',
    {
      model: 'text-embedding-3-small',
      input: content
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );

  const embedding = embeddingRes.data.data[0].embedding;

  await SemanticMemory.create({ userId, role, content, embedding });
}

// Buscar mensagens mais relevantes usando similaridade de cosseno
async function getRelevantMemory(userId, query, topK = 5) {
  const embeddingRes = await axios.post(
    'https://api.openai.com/v1/embeddings',
    {
      model: 'text-embedding-3-small',
      input: query
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );

  const queryEmbedding = embeddingRes.data.data[0].embedding;

  const memories = await SemanticMemory.find({ userId });
  
  // Calcular similaridade de cosseno
  const similarities = memories.map(m => {
    const dot = m.embedding.reduce((sum, val, i) => sum + val * queryEmbedding[i], 0);
    const magA = Math.sqrt(m.embedding.reduce((sum, val) => sum + val * val, 0));
    const magB = Math.sqrt(queryEmbedding.reduce((sum, val) => sum + val * val, 0));
    const cosine = dot / (magA * magB || 1);
    return { memory: m, score: cosine };
  });

  similarities.sort((a, b) => b.score - a.score);
  return similarities.slice(0, topK).map(s => s.memory);
}

module.exports = { saveMemory, getRelevantMemory };

