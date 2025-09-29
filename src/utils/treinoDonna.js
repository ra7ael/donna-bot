// src/utils/treinoDonna.js
import { MongoClient } from "mongodb";
import OpenAI from "openai";

const client = new MongoClient(process.env.MONGO_URI);
const db = client.db("donnaDB");
const respostas = db.collection("respostas");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Variáveis globais para papéis (compartilhadas com server.js)
let papeisCombinados = [];

// Função para definir papéis dinamicamente
export function setPapeis(papeis) {
  papeisCombinados = papeis;
}

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
${papeisCombinados.length > 0 
  ? `Atualmente você está assumindo os papéis de: ${papeisCombinados.join(", ")}.`
  : "Atue como o usuario desejar."}
Responda de forma curta, prática e amigável.
Se não souber, diga isso de forma educada.
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

// Função opcional para treinar manualmente
export async function treinarDonna(pergunta, resposta) {
  await client.connect();
  const exist = await respostas.findOne({ pergunta });
  if (exist) {
    await respostas.updateOne(
      { pergunta },
      { $set: { resposta, atualizadoEm: new Date() } }
    );
  } else {
    await respostas.insertOne({
      pergunta,
      resposta,
      criadoEm: new Date(),
    });
  }
  console.log(`📝 Donna treinada: "${pergunta}" => "${resposta}"`);
}



