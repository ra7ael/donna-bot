// src/memorySelector.js

// níveis de memória definidos localmente
const MEMORY_LEVELS = {
  IDENTITY: "identity",
  PATTERN: "pattern",
  EVENT: "event",
  CONTEXT: "context"
};

export function selectMemoriesForPrompt(memorias = []) {
  return memorias.filter(m => {
    return (
      m.tipo === MEMORY_LEVELS.IDENTITY ||
      m.tipo === MEMORY_LEVELS.PATTERN
    );
  });
}
