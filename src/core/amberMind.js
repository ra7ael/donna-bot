// src/core/amberMind.js

import { salvarMemoria, consultarFatos } from "../utils/memory.js";
import { addSemanticMemory } from "../models/semanticMemory.js";

/* ========================= CONFIG ========================= */

// Frases que indicam decisão ou mudança de padrão
const PALAVRAS_DECISAO = [
  "decidi",
  "a partir de agora",
  "não quero mais",
  "vou passar a",
  "não faço mais",
  "sempre faço",
  "nunca faço",
  "não vou mais"
];

// Evita avisar a mesma incoerência várias vezes
const incoerenciasAvisadas = new Set();

/* ========================= UTILITÁRIOS ========================= */

function pareceDecisao(texto) {
  const t = texto.toLowerCase();
  return PALAVRAS_DECISAO.some(p => t.includes(p));
}

// Evita salvar decisões impulsivas/emocionais
function pareceEstavel(texto) {
  const t = texto.toLowerCase();
  if (texto.length < 25) return false;
  if (["acho", "talvez", "quem sabe", "por enquanto"].some(p => t.includes(p))) {
    return false;
  }
  return true;
}

function resumir(texto, limite = 160) {
  return texto.length > limite ? texto.slice(0, limite) + "…" : texto;
}

// Detecta contradição simples entre fala atual e fatos salvos
function detectarIncoerencia(texto, fatos = []) {
  const t = texto.toLowerCase();

  for (const f of fatos) {
    const fato = typeof f === "string" ? f : f.content;
    if (!fato) continue;

    const fl = fato.toLowerCase();

    // heurística simples e segura
    if (
      fl.includes("não") &&
      !t.includes("não") &&
      t.includes(fl.replace("não", "").trim())
    ) {
      return fato;
    }

    if (
      t.includes("não") &&
      fl.includes(t.replace("não", "").trim())
    ) {
      return fato;
    }
  }

  return null;
}

/* ========================= MOTOR PRINCIPAL ========================= */

export async function amberMind({
  from,
  mensagem,
  respostaIA
}) {
  const fatos = await consultarFatos(from);

  /* ===== 1. DETECTA E SALVA DECISÕES REAIS ===== */
  if (pareceDecisao(mensagem) && pareceEstavel(mensagem)) {
    const resumo = resumir(mensagem);

    const jaExiste = fatos.some(f => {
      const content = typeof f === "string" ? f : f.content;
      return content === resumo;
    });

    if (!jaExiste) {
      await salvarMemoria(from, {
        tipo: "decisao",
        content: resumo,
        createdAt: new Date()
      });

      await addSemanticMemory(
        resumo,
        "decisão ou padrão consolidado do usuário",
        from,
        "user"
      );
    }
  }

  /* ===== 2. DETECTA INCOERÊNCIA (CONFIRMA, NÃO EXPLICA) ===== */
  const conflito = detectarIncoerencia(mensagem, fatos);

  if (conflito) {
    const chave = `${from}:${conflito}`;

    if (!incoerenciasAvisadas.has(chave)) {
      incoerenciasAvisadas.add(chave);

      return {
        override: true,
        resposta: "Só confirmando: isso é uma mudança em relação ao que você fazia antes?"
      };
    }
  }


  /* ===== MEMÓRIA DE FAMÍLIA ===== */
const pessoa = detectarFamilia(mensagem);

if (pessoa) {
  const resumo = extrairResumo(mensagem);

  if (!fatos.find(f => (f.content || f) === resumo)) {
    await salvarMemoria(from, {
      tipo: "familia",
      pessoa: pessoa.nome,
      content: resumo,
      createdAt: new Date()
    });

    await addSemanticMemory(
      resumo,
      `Informação sobre ${pessoa.nome} (família do usuário)`,
      from,
      "user"
    );
  }
}

  /* ===== 3. NUNCA SALVA O QUE A AMBER FALA COMO FATO ===== */
  // respostaIA NÃO é memória
  // conversa de curto prazo já existe no sessionMemory

  return { override: false };
}
