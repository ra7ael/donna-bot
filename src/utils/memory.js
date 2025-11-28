// src/utils/memory.js
import mongoose from "mongoose";
import { MongoClient } from "mongodb";
import Memoria from "../models/memory.js";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;

// Driver nativo
let dbInstance = null;
let mongoClient = null;

/**
 * Conecta ao MongoDB (driver nativo) + tenta conectar mongoose sem travar o app
 */
export async function connectDB() {
  if (dbInstance) return dbInstance;

  if (!MONGO_URI) {
    console.error("❌ MONGO_URI não definida no env.");
    process.exit(1);
  }

  try {
    console.log("🔹 Conectando ao MongoDB...");
    mongoClient = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 4000 });
    await mongoClient.connect();
    dbInstance = mongoClient.db("donna");
    console.log("✅ MongoDB conectado.");
  } catch (err) {
    console.error("❌ Erro ao conectar ao MongoDB:", err?.message || err);
    process.exit(1);
  }

  try {
    if (mongoose.connection.readyState !== 1) {
      console.log("🔹 Tentando conectar Mongoose...");
      await Promise.race([
        mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 4000 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout mongoose")), 3500)),
      ]);
      console.log("✅ Mongoose conectado.");
    }
  } catch (err) {
    console.warn("⚠️ Mongoose não conectou a tempo, seguindo sem bloquear:", err?.message || err);
  }

  return dbInstance;
}

/**
 * Salva dados na memória estruturada via Mongoose (somente se conectado)
 */
export async function salvarMemoria(userId, dados) {
  if (!userId || !dados || typeof dados !== "object") {
    console.warn("⚠️ Dados inválidos para salvarMemoria.");
    return null;
  }

  await connectDB();

  if (mongoose.connection.readyState !== 1) {
    console.warn("⚠️ Mongoose offline, não foi possível salvar memória.");
    return null;
  }

  try {
    let registro = await Memoria.findOne({ userId }).lean();

    if (!registro) {
      registro = new Memoria({ userId, memoria: dados });
    } else {
      await Memoria.updateOne({ userId }, { $set: { memoria: { ...registro.memoria, ...dados } } });
    }

    const salvo = await Memoria.findOne({ userId }).lean();
    console.log(`💾 Memória salva para: ${userId}`);
    return salvo;
  } catch (err) {
    console.error("❌ Falha ao salvar memória:", err?.message || err);
    return null;
  }
}

/**
 * Busca memória estruturada
 */
export async function buscarMemoria(userId) {
  if (!userId) return null;
  await connectDB();

  if (mongoose.connection.readyState !== 1) {
    console.warn("⚠️ Mongoose offline, não foi possível buscar memória.");
    return null;
  }

  try {
    return await Memoria.findOne({ userId }).lean();
  } catch (err) {
    console.error("❌ Erro ao buscar memória:", err?.message || err);
    return null;
  }
}

/**
 * Remove a memória estruturada
 */
export async function limparMemoria(userId) {
  if (!userId) return false;
  await connectDB();

  if (mongoose.connection.readyState !== 1) {
    console.warn("⚠️ Mongoose offline, não foi possível limpar memória.");
    return false;
  }

  try {
    await Memoria.deleteOne({ userId });
    console.log(`🗑️ Memória removida para: ${userId}`);
    return true;
  } catch (err) {
    console.error("❌ Erro ao limpar memória:", err?.message || err);
    return false;
  }
}

/**
 * Retorna a instância do banco do driver nativo caso precise fora daqui
 */
export function getDB() {
  return dbInstance;
}
