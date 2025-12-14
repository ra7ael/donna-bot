// src/utils/buscarPdf.js

import OpenAI from "openai";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const client = new MongoClient(process.env.MONGO_URI);
const dbName = "donna";
const colecao = "pdfEmbeddings";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function buscarPergunta(pergunta, topK = 6) {
  await client.connect();
  const db = client.db(dbName);
  const collection = db.collection(colecao);

  // 🔹 Embedding da pergunta
  const embeddingRes = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: pergunta
  });

  const perguntaEmbedding = embeddingRes.data[0].embedding;

  // 🔹 Buscar trechos do livro
  const trechos = await collection.find().toArray();

  // 🔹 Similaridade cosseno
  const similaridade = (a, b) => {
    const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    return dot / (magA * magB);
  };

  const scored = trechos.map(t => ({
    ...t,
    score: similaridade(perguntaEmbedding, t.embedding)
  }));

  scored.sort((a, b) => b.score - a.score);

  // 🔍 DEBUG CRÍTICO
  console.log(
    "📊 Top similaridades:",
    scored.slice(0, 6).map(s => ({
      score: s.score.toFixed(3),
      trecho: s.trecho.slice(0, 120) + "..."
    }))
  );

const topTrechos = scored.slice(0, topK);

// 🔍 LOG DE DIAGNÓSTICO
console.log(
  "📊 TOP TRECHOS:",
  topTrechos.map(t => ({
    score: t.score.toFixed(3),
    trecho: t.trecho.slice(0, 120) + "..."
  }))
);

await client.close();

// 👉 AGORA DEVOLVE OBJETO, NÃO STRING
return topTrechos.map(t => ({
  trecho: t.trecho,
  score: t.score
}));

