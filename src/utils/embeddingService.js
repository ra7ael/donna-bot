import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function embedding(text) {
  try {
    const response = await client.embeddings.create({
      model: "text-embedding-3-small",
      input: text
    });

    let vector = response.data[0].embedding;

    return vector;
  } catch (err) {
    console.error("❌ Erro ao gerar embedding:", err.response?.data || err.message);
    return Array(1536).fill(0);
  }
}

