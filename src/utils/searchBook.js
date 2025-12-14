import fs from "fs";
import path from "path";

const BOOK_PATH = path.resolve("src/data/book_embeddings.json");

function cosineSimilarity(vecA, vecB) {
  const dot = vecA.reduce((sum, val, i) => sum + val * vecB[i], 0);
  const normA = Math.sqrt(vecA.reduce((sum, val) => sum + val * val, 0));
  const normB = Math.sqrt(vecB.reduce((sum, val) => sum + val * val, 0));
  return dot / (normA * normB);
}

export function searchBook(questionEmbedding, topK = 3) {
  if (!fs.existsSync(BOOK_PATH)) return [];

  const data = JSON.parse(fs.readFileSync(BOOK_PATH, "utf8"));

  const scored = data.map(chunk => ({
    text: chunk.text,
    score: cosineSimilarity(questionEmbedding, chunk.embedding)
  }));

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
