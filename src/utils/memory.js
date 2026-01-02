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


// Perfil completo com fatos + memória semântica
export async function consultarPerfil(from) {
  if (!from) return {};

  // 1️⃣ Fatos explícitos
  const fatos = await consultarFatos(from);

  // 2️⃣ Memória semântica mais relevante
  const memoriaSemantica = await querySemanticMemory("resumir perfil do usuário", from, 5);

  // 3️⃣ Monta o perfil dinâmico
  const perfil = {
    nome: null,
    filhos: null,
    trabalho: null,
    outros: [],
  };

  // Extrair informações dos fatos
  fatos.forEach(f => {
    const texto = f.toLowerCase();
    if (texto.includes("meu nome é")) perfil.nome = f.replace(/meu nome é/i, "").trim();
    else if (texto.includes("tenho") && texto.includes("filho")) perfil.filhos = f;
    else if (texto.includes("trabalho") || texto.includes("empresa")) perfil.trabalho = f;
    else perfil.outros.push(f);
  });

  // Adiciona insights da memória semântica
  if (memoriaSemantica?.length) {
    memoriaSemantica.forEach(m => {
      if (!perfil.outros.includes(m)) perfil.outros.push(m);
    });
  }

  return perfil;
}



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
 * Salva dados na memória estruturada via Mongoose
 */
export async function salvarMemoria(userId, role, content) {
  await connectDB();
  if (!content || !content.toString().trim()) return;

  // Normaliza string simples para objeto
  const dados = typeof content === "string" ? { text: content.toString(), timestamp: new Date() } : { ...content, timestamp: new Date() };

  let memoria = await Memoria.findOne({ userId });

  if (!memoria) {
    memoria = new Memoria({
      userId,
      memoria: { [role]: [dados] },
    });
  } else {
    if (!memoria.memoria[role]) memoria.memoria[role] = [];
    memoria.memoria[role].push(dados);
  }

  await memoria.save();
  console.log(`💾 Memória estruturada atualizada para ${userId}`);
  return memoria;
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



/**
 * Retorna apenas os fatos conscientes do usuário (role = "fato")
 */
export async function consultarFatos(userId) {
  if (!userId) return [];

  await connectDB();

  if (mongoose.connection.readyState !== 1) {
    console.warn("⚠️ Mongoose offline, não foi possível consultar fatos.");
    return [];
  }

  try {
    const memoria = await Memoria.findOne({ userId }).lean();
    if (!memoria?.memoria?.fato) return [];

    return memoria.memoria.fato.map(f => f.text);
  } catch (err) {
    console.error("❌ Erro ao consultar fatos:", err?.message || err);
    return [];
  }
}
