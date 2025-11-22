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

async function importarPDFs() {
  await client.connect();
  const db = client.db(dbName);
  const collection = db.collection(colecao);

  const pdfDir = path.resolve("./pdfs");
  const arquivos = fs.readdirSync(pdfDir).filter(f => f.endsWith(".pdf"));

  for (const arquivo of arquivos) {
    const caminho = path.join(pdfDir, arquivo);
    const dataBuffer = fs.readFileSync(caminho);
    const data = await pdf(dataBuffer);
    const texto = data.text.replace(/\s+/g, " ").trim();

    const trechos = [];
    for (let i = 0; i < texto.length; i += 500) {
      trechos.push(texto.slice(i, i + 500));
    }

    for (const trecho of trechos) {
      const embeddingRes = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: trecho
      });

      const embedding = embeddingRes.data[0].embedding;

      await collection.insertOne({
        arquivo,
        trecho,
        embedding,
        criadoEm: new Date()
      });
    }

    console.log(`✅ "${arquivo}" importado com ${trechos.length} trechos!`);
  }

  console.log("🎉 Todos os PDFs importados com embeddings!");
  await client.close();
}

// 👉 AQUI (exportação correta!)
export { importarPDFs as processarPdf };
