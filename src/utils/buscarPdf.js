// src/utils/buscarPdf.js

import OpenAI from "openai";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const client = new MongoClient(process.env.MONGO_URI);
const dbName = "donnaDB";
const colecao = "pdfEmbeddings";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function buscarPergunta(pergunta, topK = 3) {
  await client.connect();
  const db = client.db(dbName);
  const collection = db.collection(colecao);

  // Criar embedding da pergunta
  const embeddingRes = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: pergunta
  });

  const perguntaEmbedding = embeddingRes.data[0].embedding;

  // Recuperar todos os trechos
  const trechos = await collection.find().toArray();

  // Calcular similaridade (cosseno)
  const similaridade = (a, b) => {
    const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const magA = Math.sqrt(a.reduce((sum, val) => sum + val*val, 0));
    const magB = Math.sqrt(b.reduce((sum, val) => sum + val*val, 0));
    return dot / (magA * magB);
  };

  const scored = trechos.map(t => ({ ...t, score: similaridade(perguntaEmbedding, t.embedding) }));
  scored.sort((a, b) => b.score - a.score);

  const topTrechos = scored.slice(0, topK);

  await client.close();

  // Junta os trechos com a fonte dinâmica
  return topTrechos
    .map(t => `${t.trecho}\n\n[Fonte: ${t.fonte || "Desconhecida"}]`)
    .join("\n\n");
}

// Exemplo de uso local (opcional)
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    const resposta = await buscarPergunta("O que Freud dizia sobre o inconsciente?");
    console.log(resposta);
  })();
}
