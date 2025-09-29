import fs from "fs";
import path from "path";
import pdf from "pdf-parse";
import { treinarDonna } from "./treinoDonna.js";

const pdfDir = path.resolve("./pdfs"); // Pasta com todos os PDFs

async function importarPDFs() {
  const arquivos = fs.readdirSync(pdfDir).filter(f => f.endsWith(".pdf"));

  for (const arquivo of arquivos) {
    const caminho = path.join(pdfDir, arquivo);
    const dataBuffer = fs.readFileSync(caminho);
    const data = await pdf(dataBuffer);
    const texto = data.text;

    // Quebrar em trechos de 50 linhas
    const linhas = texto.split("\n");
    const trechos = [];
    let trecho = "";

    for (let i = 0; i < linhas.length; i++) {
      trecho += linhas[i] + " ";
      if ((i + 1) % 50 === 0) {
        trechos.push(trecho.trim());
        trecho = "";
      }
    }
    if (trecho) trechos.push(trecho.trim());

    console.log(`📝 "${arquivo}" dividido em ${trechos.length} trechos`);

    // Treinar Donna com cada trecho
    for (let i = 0; i < trechos.length; i++) {
      const pergunta = `Trecho de "${arquivo}" nº ${i + 1}`;
      await treinarDonna(pergunta, trechos[i]);
    }

    console.log(`✅ "${arquivo}" importado com sucesso!`);
  }

  console.log("🎉 Todos os PDFs importados!");
}

// Executar
importarPDFs();
