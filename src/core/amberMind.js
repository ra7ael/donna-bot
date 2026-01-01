// src/core/amberMind.js

import { salvarMemoria, consultarFatos } from "../utils/memory.js";
import { addSemanticMemory, querySemanticMemory } from "../models/semanticMemory.js";

/* ========================= CONFIG ========================= */
const PALAVRAS_DECISAO = [
  "decidi", "a partir de agora", "não quero mais", "vou passar a",
  "não faço mais", "sempre faço", "nunca faço", "não vou mais"
];

const incoerenciasAvisadas = new Set();

/* ========================= DETECTORES ========================= */
function pareceImportante(texto) {
  const t = texto.toLowerCase();
  return PALAVRAS_DECISAO.some(p => t.includes(p));
}

function extrairResumo(texto) {
  return texto.length > 180 ? texto.slice(0, 180) + "…" : texto;
}

function detectarIncoerencia(texto, fatos = []) {
  const t = texto.toLowerCase();
  for (const f of fatos) {
    const fato = typeof f === "string" ? f : f.content;
    if (!fato) continue;

    const fl = fato.toLowerCase();

    if (
      (fl.includes("não") && !t.includes("não") && t.includes(fl.replace("não", "").trim())) ||
      (t.includes("não") && fl.includes(t.replace("não", "").trim()))
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

  /* ===== MEMÓRIA AUTOMÁTICA ===== */
  if (pareceImportante(mensagem)) {
    const resumo = extrairResumo(mensagem);
    if (!fatos.find(f => (f.content || f) === resumo)) {
      await salvarMemoria(from, {
        tipo: "decisao",
        content: resumo,
        createdAt: new Date()
      });

      await addSemanticMemory(
        resumo,
        "decisão ou padrão importante do usuário",
        from,
        "user"
      );
    }
  }

  /* ===== INCOERÊNCIA (AVISA UMA VEZ) ===== */
  const conflito = detectarIncoerencia(mensagem, fatos);

  if (conflito) {
    const chave = `${from}:${conflito}`;
    if (!incoerenciasAvisadas.has(chave)) {
      incoerenciasAvisadas.add(chave);

      return {
        override: true,
        resposta: `Antes de seguir: isso entra em conflito com algo que você já me disse. Talvez seja uma mudança, só quis sinalizar.`
      };
    }
  }

  /* ===== MEMÓRIA SEMÂNTICA DA CONVERSA ===== */
  if (respostaIA) {
    await addSemanticMemory(
      mensagem,
      respostaIA,
      from,
      "assistant"
    );
  }

  return { override: false };
}
