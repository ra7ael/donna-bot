import SemanticMemory from '../models/semanticMemory.js';
import axios from 'axios';

function detectarTopico(texto) {
  if (/fam[ií]lia|pai|m[ãa]e|filho|filha|irm[ãa]o|irm[ãa]|sobrinho|tia|tio/i.test(texto)) return "família";
  if (/trabalho|emprego|carreira|empresa|profiss[aã]o|chefe|colega/i.test(texto)) return "trabalho";
  if (/sono|ins[oô]nia|dormir|cansa[cç]o|acordar/i.test(texto)) return "sono";
  if (/relacionamento|namoro|amor|casamento|parceir[oa]/i.test(texto)) return "relacionamento";
  if (/sa[úu]de|doen[cç]a|m[eé]dico|terapia|ansiedade|emocional/i.test(texto)) return "saúde";
  return "geral";
}

/**
 * Salvar memória do usuário com embedding e tópico
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
    const topic = detectarTopico(content);

    await SemanticMemory.create({
      userId,
      role,
      content,
      embedding,
      topic,
      type,
      timestamp: new Date()
    });

    console.log(`💾 Memória salva para ${userId} (${type}) [${topic}]`);
  } catch (err) {
    console.error('❌ Erro ao salvar memória:', err.response?.data || err.message);
  }
}

/**
 * Buscar memórias mais relevantes por similaridade de cosseno
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
