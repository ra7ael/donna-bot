import readline from "readline";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function perguntar(texto) {
  return new Promise((resolve) => rl.question(texto, resolve));
}

async function run() {
  const numero = await perguntar("📱 Qual número do usuário? ");
  const função = await perguntar("👤 Qual função? ");
  const conteúdo = await perguntar("🧠 Qual conteúdo da memória? ");

  const client = new MongoClient(process.env.MONGO_URI);
  await client.connect();
  const db = client.db("donna");

  await db.collection("semanticMemory").insertOne({
    numero,
    função,
    conteúdo,
    criadoEm: new Date(),
  });

  console.log("✅ Memória salva com sucesso!");
  rl.close();
  await client.close();
}

run();