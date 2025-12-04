// src/utils/semanticQueue.js
import { addSemanticMemory } from "../models/semanticMemory.js";

const queue = [];
let processing = false;

// Adiciona item na fila
export async function enqueueSemanticMemory(category, content, userId, role) {
  const item = { 
    category: category.toString(),
    content: typeof content === "string" ? content : JSON.stringify(content),
    userId: userId.toString(),
    role: role.toString()
  };

  queue.push(item);
  processQueue();
}

// Processa fila em background
async function processQueue() {
  if (processing) return;
  processing = true;

  while (queue.length > 0) {
    const item = queue.shift();
    try {
      await addSemanticMemory(item.category, item.content, item.userId, item.role);
    } catch (err) {
      console.error("❌ Erro ao processar fila de memória semântica:", err.message);
      queue.push(item); // Reenfileirar
      await new Promise(res => setTimeout(res, 5000));
    }
  }

  processing = false;
}
