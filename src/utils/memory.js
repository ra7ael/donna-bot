import Memoria from "../models/memory.js";
import { MongoClient } from "mongodb";

const MONGO_URI = process.env.MONGO_URI;
let db = null;

/**
 * Conecta ao MongoDB (versão correta)
 */
export async function connectDB() {
  if (db) return db;

  try {
    console.log("🔹 Tentando conectar ao MongoDB...");

    const client = new MongoClient(MONGO_URI);
    await client.connect();

    db = client.db("donna");
    console.log("✅ Conectado ao MongoDB (memória estruturada)");

    return db;
  } catch (err) {
    console.error("❌ Erro ao conectar ao MongoDB (memória estruturada):", err);
    throw err;
  }
}

/**
 * Salvar dados na memória estruturada do usuário
 * @param {String} userId
 * @param {Object} dados - dados a serem armazenados (ex.: { nome, empresa, papeis })
 */
export async function salvarMemoria(userId, dados) {
  await connectDB();

  let memoria = await Memoria.findOne({ userId });

  if (!memoria) {
    memoria = new Memoria({ userId, memoria: dados });
  } else {
    memoria.memoria = { ...memoria.memoria, ...dados };
  }

  await memoria.save();
  console.log(`💾 Memória estruturada atualizada para ${userId}`);

  return memoria;
}

/**
 * Buscar memória estruturada do usuário
 * @param {String} userId
 * @returns {Object|null} - memória armazenada
 */
export async function buscarMemoria(userId) {
  await connectDB();
  return await Memoria.findOne({ userId });
}

/**
 * Apagar memória do usuário
 * @param {String} userId
 */
export async function limparMemoria(userId) {
  await connectDB();
  await Memoria.deleteOne({ userId });

  console.log(`🗑️ Memória do usuário ${userId} apagada`);
}
