// src/utils/processarPdf.js
import fs from "fs";
import path from "path";
import pdfParse from "pdf-parse";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = "donnaDB";

let db;

// Conecta ao MongoDB (reusa conexão se já existir)
async function connectDB() {
  if (!db) {
    try {
      const client = await MongoClient.connect(MONGO_URI, { useUnifiedTopology: true });
      db = client.db(DB_NAME);
      console.log("✅ Conectado ao MongoDB");
    } catch (err) {
      console.error("❌ Erro ao conectar ao MongoDB:", err.message);
      throw err;
    }
  }
  return db;
}

// Processa um PDF seguro
export async function processarPdf(caminhoArquivo) {
  try {
    await connectDB();

    if (!fs.existsSync(caminhoArquivo)) {
      console.warn(`⚠️ Arquivo não encontrado: ${caminhoArquivo}`);
      return; // sai sem lançar erro
    }

    const dataBuffer = fs.readFileSync(caminhoArquivo);
    const pdfData = await pdfParse(dataBuffer);
    const textoExtraido = pdfData.text || "";

    await db.collection("pdfs").insertOne({
      nomeArquivo: path.basename(caminhoArquivo),
      texto: textoExtraido,
      timestamp: new Date(),
    });

    console.log(`✅ PDF processado e salvo: ${caminhoArquivo}`);
  } catch (err) {
    console.error("❌ Erro ao processar PDF:", err.message);
  }
}

// Função para processar todos os PDFs de uma pasta
export async function processarTodosPDFs(pasta = "./pdfs") {
  try {
    if (!fs.existsSync(pasta)) {
      console.warn(`⚠️ Pasta de PDFs não encontrada: ${pasta}`);
      return;
    }

    const arquivos = fs.readdirSync(pasta).filter(f => f.endsWith(".pdf"));
    if (arquivos.length === 0) {
      console.log("📂 Nenhum PDF encontrado para processar");
      return;
    }

    for (const arquivo of arquivos) {
      const caminho = path.join(pasta, arquivo);
      await processarPdf(caminho);
    }

    console.log("🎉 Todos os PDFs processados!");
  } catch (err) {
    console.error("❌ Erro ao processar PDFs da pasta:", err.message);
  }
}

