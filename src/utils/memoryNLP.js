// src/utils/memoryNLP.js
import mongoose from "mongoose";

/* ========================= SCHEMA MEMÓRIA NLP ========================= */

const memoryNLPSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  key: { type: String, required: true },
  value: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const MemoryNLP = mongoose.model("MemoryNLP", memoryNLPSchema);

/* ========================= FUNÇÃO SALVAR ========================= */
export async function salvarMemoriaNLP(userId, text) {
  try {
    const lower = text.toLowerCase();

    // NLP simples: detecta chave/valor
    const pares = [];

    // nome
    if (lower.includes("meu nome é")) {
      pares.push({ key: "nome", value: text.replace(/meu nome é/i, "").trim() });
    }

    // filhos
    if (lower.includes("tenho filhos") || lower.includes("filhos")) {
      const match = text.match(/\d+/);
      if (match) pares.push({ key: "filhos", value: match[0] });
    }

    // gatas
    if (lower.includes("gatas") || lower.includes("gato") || lower.includes("gata")) {
      const match = text.match(/\d+/);
      if (match) pares.push({ key: "gatas", value: match[0] });
    }

    // outros fatos simples (armazenado inteiro)
    if (!pares.length) {
      pares.push({ key: text.slice(0, 30), value: text });
    }

    for (const p of pares) {
      const exists = await MemoryNLP.findOne({ userId, key: p.key });
      if (exists) {
        exists.value = p.value;
        await exists.save();
      } else {
        await MemoryNLP.create({ userId, key: p.key, value: p.value });
      }
    }

    return true;
  } catch (err) {
    console.error("❌ Erro ao salvar memória NLP:", err.message);
    return false;
  }
}

/* ========================= FUNÇÃO CONSULTAR ========================= */
export async function consultarFatosNLP(userId) {
  try {
    const registros = await MemoryNLP.find({ userId });
    const memoria = {};
    registros.forEach(r => { memoria[r.key] = r.value; });
    return memoria;
  } catch (err) {
    console.error("❌ Erro ao consultar memória NLP:", err.message);
    return {};
  }
}

export default MemoryNLP;
