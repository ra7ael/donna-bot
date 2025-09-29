// treinoDonna.js
import { MongoClient } from "mongodb";
import OpenAI from "openai";

const client = new MongoClient(process.env.MONGO_URI);
const db = client.db("donnaDB");
const respostas = db.collection("respostas");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Função principal de treino/resposta
export async function obterResposta(pergunta) {
  await client.connect();

  // 1️⃣ Tenta encontrar no banco
  const respostaExistente = await respostas.findOne({ pergunta });
  if (respostaExistente) {
    return respostaExistente.resposta;
  }

  // 2️⃣ Se não achar, consulta a OpenAI
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `
        Você é a Donna, assistente pessoal do Rafael.
        Responda de forma curta, prática e amigável.
        Só responda perguntas dentro do contexto de RH, organização, lembretes e suporte ao Rafael.
        `,
      },
      { role: "user", content: pergunta },
    ],
  });

  const respostaGerada = completion.choices[0].message.content;

  // 3️⃣ Salva a nova resposta no banco (aprendizado)
  await respostas.insertOne({
    pergunta,
    resposta: respostaGerada,
    criadoEm: new Date(),
  });

  return respostaGerada;
}
