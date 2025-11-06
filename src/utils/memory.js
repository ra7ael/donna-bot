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

function cosineSimilaritySafe(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0)) || 1;
  const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0)) || 1;
  return dot / (magA * magB);
}

/**
 * 💾 Salva memória semântica otimizada
 */
export async function saveMemory(userId, role, content, type = "short") {
  if (!content || content.trim().split(/\s+/).length < 5) return;

  try {
    const existente = await SemanticMemory.findOne({ userId, content });
    if (existente) return;

    const embeddingRes = await axios.post(
      'https://api.openai.com/v1/embeddings',
      { model: 'text-embedding-3-small', input: content },
      { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
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

    console.log(`💾 [Memória salva] ${userId} | ${topic} | ${content.slice(0, 50)}...`);
  } catch (err) {
    console.error('❌ Erro ao salvar memória:', err.response?.data || err.message);
  }
}

/**
 * 🔍 Busca memórias relevantes (contexto inteligente)
 */
export async function getRelevantMemory(userId, query, topK = 5) {
  if (!query || !query.trim()) return [];

  try {
    const embeddingRes = await axios.post(
      'https://api.openai.com/v1/embeddings',
      { model: 'text-embedding-3-small', input: query },
      { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
    );

    const queryEmbedding = embeddingRes.data.data[0].embedding;
    const memories = await SemanticMemory.find({ userId })
      .sort({ timestamp: -1 })
      .limit(200);

    const ranked = memories
      .map(m => ({
        memory: m,
        score: cosineSimilaritySafe(m.embedding, queryEmbedding)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    console.log(`🧠 Memórias relevantes para ${userId}:`, ranked.map(r => r.score.toFixed(3)));

    return ranked.map(r => r.memory);
  } catch (err) {
    console.error('❌ Erro ao buscar memórias:', err.response?.data || err.message);
    return [];
  }
}

