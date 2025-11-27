// src/utils/memory.js
import mongoose from "mongoose";
import { MongoClient } from "mongodb";
import Memoria from "../models/memory.js";
import dotenv from "dotenv";
dotenv.config();

const MONGO_URI = process.env.MONGO_URI;

// driver nativo
let db = null;
let client = null;

/**
 * Conecta ao MongoDB (driver nativo) + mongoose (1 tentativa rápida, sem buffering infinito)
 */
export async function connectDB() {
  // 1. Se já existe conexão do driver, retorna
  if (db) return db;

  if (!MONGO_URI) {
    console.error("❌ connectDB: MONGO_URI não definida no env.");
    process.exit(1);
  }

  try {
    console.log("🔹 Conectando driver nativo Mongo...");

    client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 4000 });
    await client.connect();

    db = client.db("donna"); // seu banco
    console.log("✅ Driver nativo Mongo conectado");

  } catch (err) {
    console.error("❌ Erro ao conectar driver nativo Mongo:", err.message);
    process.exit(1);
  }

  try {
    // 2. Tenta conectar mongoose rapidamente se ainda não estiver conectado
    if (mongoose.connection.readyState !== 1) {
      console.log("🔹 Conectando mongoose...");
      await Promise.race([
        mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 4000 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout mongoose")), 3500))
      ]);
      console.log("✅ Mongoose conectado");
    }
  } catch (err) {
    console.warn("⚠️ Mongoose não conectou rápido, seguindo sem bloquear o app:", err.message);
  }

  return db;
}

/**
 * Salva dados na memória estruturada (usando Mongoose, mas só se conectado)
 */
export async function salvarMemoria(userId, dados) {
  if (!userId || !dados || typeof dados !== "object") {
    console.warn("⚠️ salvarMemoria: userId ou dados inválidos.");
    return null;
  }

  await connectDB();

  // Se mongoose não conectou, evita usar a model (evita timeout)
  if (mongoose.connection.readyState !== 1) {
    console.warn("⚠️ salvarMemoria: Mongoose offline, memória não persistida.");
    return null;
  }

  let memoria = await Memoria.findOne({ userId });

  if (!memoria) {
    memoria = new Memoria({ userId, memoria: dados });
  } else {
    memoria.memoria = { ...memoria.memoria, ...dados };
  }

  await memoria.save();
  console.log(`💾 Memória atualizada para ${userId}`);
  return memoria;
}

/**
 * Busca memória estruturada (guard contra offline)
 */
export async function buscarMemoria(userId) {
  if (!userId) return null;
  await connectDB();

  if (mongoose.connection.readyState !== 1) {
    console.warn("⚠️ buscarMemoria: Mongoose offline.");
    return null;
  }

  return await Memoria.findOne({ userId }).lean().exec();
}

/**
 * Apaga memória estruturada
 */
export async function limparMemoria(userId) {
  if (!userId) return false;
  await connectDB();

  if (mongoose.connection.readyState === 1) {
    await Memoria.deleteOne({ userId });
    console.log(`🗑️ Memória apagada: ${userId}`);
    return true;
  }

  console.warn("⚠️ limparMemoria: Mongoose offline.");
  return false;
}
