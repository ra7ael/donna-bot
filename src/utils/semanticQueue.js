import { addSemanticMemory } from "../models/semanticMemory.js";

const queue = [];
let processing = false;

// Adiciona item na fila sem quebrar lógica
export async function enqueueSemanticMemory(category, content, userId, role) {
  if (!category || !content || !userId || !role) {
    console.log("⚠ Item inválido, não enfileirado.");
    return;
  }

  // Converte tudo para string corretamente
  const item = {
    category: category.toString().trim(),
    content: content.toString().trim(),
    userId: userId.toString(),
    role: role.toString()
  };

  queue.push(item);
  processQueue();
}

// Processa a fila sem quebrar resto do sistema
async function processQueue() {
  if (processing) return;
  processing = true;

  while (queue.length > 0) {
    const item = queue.shift();
    try {
      await addSemanticMemory(item.category, item.content, item.userId, item.role);
      console.log("🧠 Memória semântica salva:", item.category);
    } catch (err) {
      console.error("❌ Erro ao processar fila de memória semântica:", err.message);
      // Mantém a lógica de reenfileirar sem quebrar fluxo
      queue.push(item);
      await new Promise(res => setTimeout(res, 5000));
    }
  }

  processing = false;
}



export default enqueueSemanticMemory;
