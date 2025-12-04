import { addSemanticMemory } from "../models/semanticMemory.js";

const queue = [];
let processing = false;

export default async function enqueueSemanticMemory(category, content, userId, role) {
  const item = {
    category: category.toString(),
    content: content.toString(),
    userId: userId.toString(),
    role: role.toString()
  };

  queue.push(item);
  processQueue();
}

async function processQueue() {
  if (processing) return;
  processing = true;

  while (queue.length > 0) {
    const item = queue.shift();
    try {
      await addSemanticMemory(item.category, item.content, item.userId, item.role);
    } catch (err) {
      console.error("❌ Erro ao processar memória:", err.message);
      queue.push(item);
      await new Promise(res => setTimeout(res, 5000));
    }
  }

  processing = false;
}
