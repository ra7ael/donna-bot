// src/utils/searchBook.js
import { getDB } from "./memory.js";

export async function searchBook(query, limit = 3, userId) {
  const db = getDB();

  if (!db) return [];

  // busca simples por palavra
  const results = await db.collection("books")
    .find({
      userId,
      content: { $regex: query.split(" ")[0], $options: "i" }
    })
    .limit(limit)
    .toArray();

  return results.map(r => r.content);
}
