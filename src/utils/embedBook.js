import OpenAI from "openai";
import { loadBook, splitIntoChunks } from "./loadBook.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function embedBook() {
  const text = loadBook();
  const chunks = splitIntoChunks(text);

  const embeddings = [];

  for (const chunk of chunks) {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-large",
      input: chunk
    });

    embeddings.push({
      text: chunk,
      embedding: response.data[0].embedding
    });
  }

  return embeddings;
}
