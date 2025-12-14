import fs from "fs";
import path from "path";
import pdf from "pdf-parse";
import OpenAI from "openai";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const client = new MongoClient(process.env.MONGO_URI);
const dbName = "donna";
const colecao = "pdfEmbeddings";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 🔧 Configurações ajustáveis
const TAMANHO_TRECHO = 1200;
const TAMANHO_MINIMO = 200;

async function importarPDFs() {
  await client.connect();
  const db = client.db(dbName);
  const collection = db.collection(colecao);

  const pdfDir = path.resolve("./pdfs");
  const arquivos = fs.readdirSync(pdfDir).filter(f => f.endsWith(".pdf"));

  for (const arquivo of arquivos) {
    console.log(`📖 Processando: ${arquivo}`);

    const caminho = path.join(pdfDir, arquivo);
    const dataBuffer = fs.readFileSync(caminho);
    const data = await pdf(dataBuffer);

    const texto = data.text
      .replace(/\s+/g, " ")
      .trim();

    console.log("📄 Tamanho do texto extraído:", texto.length);
    

    const trechos = [];

    for (let i = 0; i < texto.length; i += TAMANHO_TRECHO) {
      const trecho = texto.slice(i, i + TAMANHO_TRECHO).trim();
      if (trecho.length >= TAMANHO_MINIMO) {
        trechos.push(trecho);
      }
    }

    console.log(`📚 ${trechos.length} trechos válidos gerados`);

    for (const trecho of trechos) {
      const embeddingRes = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: trecho
      });

      await collection.insertOne({
        arquivo,
        trecho,
        embedding: embeddingRes.data[0].embedding,
        criadoEm: new Date()
      });
    }

    console.log(`✅ "${arquivo}" importado com sucesso!\n`);
  }

  console.log("🎉 Todos os PDFs importados com embeddings!");
  await client.close();
}

// 👉 Exportação correta
export { importarPDFs as processarPdf };
