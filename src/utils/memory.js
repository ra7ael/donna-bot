// utils/memory.js
import SemanticMemory from '../models/semanticMemory.js';
import axios from 'axios';

/**
 * Salvar memória do usuário com embedding
 * @param {String} userId - ID ou número do usuário
 * @param {String} role - "user" ou "assistant"
 * @param {String} content - conteúdo da memória
 * @param {String} type - "short", "medium" ou "long" (opcional)
 */
export async function saveMemory(userId, role, content, type = "short") {
  if (!content || !content.trim()) return;

  try {
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

    await SemanticMemory.create({
      userId,
      role,
      content,
      embedding,
      type,
      timestamp: new Date()
    });

    console.log(`💾 Memória salva para ${userId} (${type})`);
  } catch (err) {
    console.error('❌ Erro ao salvar memória:', err.response?.data || err.message);
  }
}

/**
 * Buscar memórias mais relevantes por similaridade de cosseno
 * @param {String} userId - ID ou número do usuário
 * @param {String} query - texto para busca
 * @param {Number} topK - número máximo de memórias retornadas
 */
export async function getRelevantMemory(userId, query, topK = 5) {
  if (!query || !query.trim()) return [];

  try {
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

    const similarities = memories.map(m => {
      const dot = m.embedding.reduce((sum, val, i) => sum + val * queryEmbedding[i], 0);
      const magA = Math.sqrt(m.embedding.reduce((sum, val) => sum + val * val, 0));
      const magB = Math.sqrt(queryEmbedding.reduce((sum, val) => sum + val * val, 0));
      const cosine = dot / (magA * magB || 1);
      return { memory: m, score: cosine };
    });

    similarities.sort((a, b) => b.score - a.score);

    return similarities.slice(0, topK).map(s => s.memory);
  } catch (err) {
    console.error('❌ Erro ao buscar memórias:', err.response?.data || err.message);
    return [];
  }
}
