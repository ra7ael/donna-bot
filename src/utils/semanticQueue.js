// src/utils/semanticQueue.js
import { addSemanticMemory } from "../models/semanticMemory.js";

const queue = [];
let processing = false;

// Adiciona item na fila
export async function enqueueSemanticMemory(category, content, userId, role) {
  // 🔹 Força tudo virar string antes de ir pra fila
  const item = { 
    prompt: prompt.toString(),
    answer: typeof answer === "string" ? answer : JSON.stringify(answer),
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
      await addSemanticMemory(item.prompt, item.answer, item.userId, item.role);
    } catch (err) {
      console.error("❌ Erro ao processar fila de memória semântica:", err.message);
      // Reenfileirar para tentar novamente depois
      queue.push(item);
      await new Promise(res => setTimeout(res, 5000)); // espera 5s antes de tentar de novo
    }
  }

  processing = false;
}
