// src/memory/memorySelector.js
import { MEMORY_LEVELS } from "./memoryLevels.js";

export function selectMemoriesForPrompt(memorias) {
  return memorias.filter(m => {
    return (
      m.tipo === MEMORY_LEVELS.IDENTITY ||
      m.tipo === MEMORY_LEVELS.PATTERN
    );
  });
}
