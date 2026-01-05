// src/memory/memoryClassifier.js
import { MEMORY_LEVELS } from "./memoryLevels.js";

export function classifyMemory(texto) {
  const t = texto.toLowerCase();

  if (
    t.includes("minha esposa") ||
    t.includes("meu filho") ||
    t.includes("sou ") ||
    t.includes("trabalho como")
  ) {
    return MEMORY_LEVELS.IDENTITY;
  }

  if (
    t.includes("decidi") ||
    t.includes("a partir de agora") ||
    t.includes("não quero mais")
  ) {
    return MEMORY_LEVELS.PATTERN;
  }

  if (
    t.includes("estou cansado") ||
    t.includes("essa semana") ||
    t.includes("hoje estou")
  ) {
    return MEMORY_LEVELS.CONTEXT;
  }

  return MEMORY_LEVELS.TRANSIENT;
}
