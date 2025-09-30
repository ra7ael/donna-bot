// src/utils/processarPdf.js

import fs from "fs";
import pdfParse from "pdf-parse";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;

let db;

// Função para conectar ao MongoDB
async function connectDB() {
  if (!db) {
    try {
      const client = await MongoClient.connect(MONGO_URI, { useUnifiedTopology: true });
      db = client.db();
      console.log("✅ Conectado ao MongoDB (processarPdf.js)");
    } catch (err) {
      console.error("❌ Erro ao conectar ao MongoDB (processarPdf.js):", err.message);
    }
  }
  return db;
}

// Função principal para processar PDF
export async function processarPdf(caminhoArquivo) {
  try {
    await connectDB();

    const dataBuffer = fs.readFileSync(caminhoArquivo);
    const pdfData = await pdfParse(dataBuffer);

    const textoExtraido = pdfData.text || "";

    // Salva no MongoDB
    await db.collection("pdfs").insertOne({
      nomeArquivo: caminhoArquivo.split("/").pop(),
      texto: textoExtraido,
      timestamp: new Date(),
    });

    console.log(`✅ PDF processado e salvo: ${caminhoArquivo}`);
  } catch (err) {
    console.error("❌ Erro ao processar PDF:", err);
    throw err;
  }
}
