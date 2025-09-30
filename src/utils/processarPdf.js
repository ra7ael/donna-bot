// src/utils/processarPdf.js

import fs from "fs";
import path from "path";
import pdfParse from "pdf-parse";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
const PASTA_PDFS = path.resolve("./pdfs"); // pasta com PDFs

let db;

// Conectar ao MongoDB
async function connectDB() {
  if (!db) {
    try {
      const client = await MongoClient.connect(MONGO_URI, { useUnifiedTopology: true });
      db = client.db();
      console.log("✅ Conectado ao MongoDB");
    } catch (err) {
      console.error("❌ Erro ao conectar ao MongoDB:", err.message);
    }
  }
  return db;
}

// Processar um PDF individual
async function processarPdf(caminhoArquivo) {
  try {
    await connectDB();

    if (!fs.existsSync(caminhoArquivo)) {
      console.warn(`⚠️ Arquivo não encontrado: ${caminhoArquivo}`);
      return false; // não processou
    }

    const dataBuffer = fs.readFileSync(caminhoArquivo);
    const pdfData = await pdfParse(dataBuffer);
    const textoExtraido = pdfData.text || "";

    await db.collection("pdfs").insertOne({
      nomeArquivo: path.basename(caminhoArquivo),
      texto: textoExtraido,
      timestamp: new Date(),
    });

    console.log(`✅ PDF processado: ${path.basename(caminhoArquivo)}`);
    return true;
  } catch (err) {
    console.error(`❌ Erro ao processar PDF "${path.basename(caminhoArquivo)}":`, err.message);
    return false;
  }
}

// Processar todos os PDFs da pasta
export async function processarTodosPDFs() {
  if (!fs.existsSync(PASTA_PDFS)) {
    console.warn(`⚠️ Pasta de PDFs não encontrada: ${PASTA_PDFS}`);
    return;
  }

  const arquivos = fs.readdirSync(PASTA_PDFS).filter(f => f.endsWith(".pdf"));

  if (arquivos.length === 0) {
    console.log("ℹ️ Nenhum PDF encontrado na pasta.");
    return;
  }

  for (const arquivo of arquivos) {
    const caminho = path.join(PASTA_PDFS, arquivo);
    await processarPdf(caminho);
  }

  console.log("🎉 Todos os PDFs foram processados!");
}

// Executar automaticamente se rodar diretamente
if (import.meta.url === `file://${process.argv[1]}`) {
  processarTodosPDFs();
}

