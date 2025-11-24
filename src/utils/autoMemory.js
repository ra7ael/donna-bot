import OpenAI from "openai";
import { MongoClient } from "mongodb";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

let client;
async function initDB() {
  if (client) return client;
  client = new MongoClient(process.env.MONGO_URI, { useUnifiedTopology: true });
  await client.connect();
  return client;
}

/**
 * Gera embedding usando OpenAI
 */
export async function createEmbedding(text) {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text
  });
  return response.data[0].embedding;
}

/**
 * Analisa texto e retorna memória automática, com chave e valor.
 * Ex: "O nome dos meus filhos é Miguel e Nicolli" => { key: "nomes_dos_filhos", value: "Miguel e Nicolli" }
 */
export async function extractAutoMemory(text) {
  const lower = text.toLowerCase();

  let key, value;

  // exemplos de padrões
  if (lower.includes("meus filhos") || lower.includes("meu filho") || lower.includes("minha filha")) {
    const match = text.match(/meus filhos? é[s]? (.+)/i);
    if (match) {
      key = "nomes_dos_filhos";
      value = match[1].trim();
    }
  } else if (lower.includes("meu nome é")) {
    const match = text.match(/meu nome é (.+)/i);
    if (match) {
      key = "nome_usuario";
      value = match[1].trim();
    }
  }

  if (!key) return null;

  // cria embedding
  const embedding = await createEmbedding(value);

  // salva direto no MongoDB
  const client = await initDB();
  const db = client.db(process.env.DONNA_DB_NAME || "donna");
  const semanticMemory = db.collection("semanticMemory");

  await semanticMemory.insertOne({
    userId: "pending", // substituir pelo userId na chamada do webhook
    role: key,
    content: value,
    embedding,
    timestamp: new Date()
  });

  return { key, value, embedding };
}

/**
 * Busca memórias mais relevantes por embedding
 */
export async function findRelevantMemory(userId, query, topK = 3) {
  const client = await initDB();
  const db = client.db(process.env.DONNA_DB_NAME || "donna");
  const semanticMemory = db.collection("semanticMemory");

  const queryEmbedding = await createEmbedding(query);

  // busca todas memórias do usuário
  const allMemory = await semanticMemory.find({ userId }).toArray();

  // calcula similaridade (cosine)
  const similarities = allMemory.map(m => {
    const dot = m.embedding.reduce((sum, val, i) => sum + val * queryEmbedding[i], 0);
    const magA = Math.sqrt(m.embedding.reduce((sum, val) => sum + val * val, 0));
    const magB = Math.sqrt(queryEmbedding.reduce((sum, val) => sum + val * val, 0));
    const cosine = dot / (magA * magB);
    return { ...m, similarity: cosine };
  });

  // retorna topK mais relevantes
  similarities.sort((a, b) => b.similarity - a.similarity);
  return similarities.slice(0, topK);
}
