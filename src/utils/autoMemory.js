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

// Extrai memória automaticamente usando GPT
export async function extractAutoMemoryGPT(userId, text) {
  const prompt = `
Você é um extrator de memórias pessoais. Extraia TODAS as informações
citadas no texto abaixo e devolva em um JSON. Apenas fatos.
Exemplos de categorias:
- nome_usuario
- idade
- cidade
- profissão
- nomes_dos_filhos
- nome_da_esposa
- alergias
- metas
- preferências
- datas importantes
- gostos pessoais
- informações de saúde leves
- hábitos
- qualquer fato mencionável

Texto: "${text}"

Retorne somente um JSON e nada mais.
Se não houver informação pessoal, retorne: {}
`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
  });

  let dados;
  try {
    dados = JSON.parse(response.choices[0].message.content);
  } catch {
    dados = {};
  }

  if (!dados || Object.keys(dados).length === 0) return {};

  // salva no MongoDB
  const client = await initDB();
  const db = client.db(process.env.DONNA_DB_NAME || "donna");
  const memory = db.collection("semanticMemory");

  const items = Object.keys(dados).map(key => ({
    userId,
    role: key,
    content: dados[key],
    timestamp: new Date()
  }));

  await memory.insertMany(items);

  return dados;
}
