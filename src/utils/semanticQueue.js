import { addSemanticMemory } from "../models/semanticMemory.js";

const queue = [];
let processing = false;
let retryCount = 0;
const MAX_RETRIES = 5;

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

// Processa a fila sem quebrar o resto do sistema
async function processQueue() {
  if (processing) return;
  processing = true;

  while (queue.length > 0) {
    const item = queue.shift();
    retryCount = 0; // Reinicia o contador de tentativas para cada item

    try {
      await addSemanticMemory(item.category, item.content, item.userId, item.role);
      console.log("🧠 Memória semântica salva:", item.category);
    } catch (err) {
      console.error("❌ Erro ao processar fila de memória semântica:", err.message);

      // Incrementa o número de tentativas
      retryCount++;

      // Se o número de tentativas for menor que o máximo, reenfileira o item
      if (retryCount <= MAX_RETRIES) {
        console.log(`🔁 Tentando novamente: tentativa ${retryCount}/${MAX_RETRIES}`);
        queue.push(item); // Reenvia o item para a fila
        await new Promise(res => setTimeout(res, 5000)); // Espera 5 segundos antes de tentar novamente
      } else {
        console.log("❌ Máximo de tentativas atingido para este item:", item);
      }
    }
  }

  processing = false;
}

export default enqueueSemanticMemory;
