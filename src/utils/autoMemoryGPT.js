// src/utils/autoMemoryGPT.js
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
 * Extrai memórias automaticamente usando GPT
 */
export async function extractAutoMemoryGPT(userId, text) {
  const client = await initDB();
  const db = client.db(process.env.DONNA_DB_NAME || "donna");
  const semanticMemory = db.collection("semanticMemory");

  // GPT identifica chave/valor de forma natural
  const response = await openai.chat.completions.create({
    model: "gpt-5-mini",
    messages: [
      {
        role: "system",
        content: "Extraia informações importantes do texto e retorne no formato JSON com chaves e valores."
      },
      {
        role: "user",
        content: `Texto: "${text}"`
      }
    ]
  });

  const content = response.choices[0].message.content;

  // tenta transformar em objeto
  let mems = {};
  try {
    mems = JSON.parse(content);
  } catch (e) {
    console.warn("Não foi possível parsear JSON do GPT:", content);
  }

  // salva cada chave/valor no MongoDB
  for (const key in mems) {
    const value = mems[key];
    if (!value) continue;

    await semanticMemory.updateOne(
      { userId, role: key },
      { $set: { content: value, timestamp: new Date() } },
      { upsert: true }
    );
  }

  return mems;
}
