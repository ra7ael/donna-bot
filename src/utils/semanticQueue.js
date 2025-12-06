import { addSemanticMemory } from "../models/semanticMemory.js";

const queue = [];
let processing = false;

// Evita salvar spam de memória repetida
let lastSaved = {
  content: "",
  timestamp: 0
};

const MIN_INTERVAL = 1200; // 1.2s entre salvamentos

export async function enqueueSemanticMemory(category, content, userId, role) {
  try {
    if (!category || !content || !userId || !role) return;

    // Garante string válida
    const text = typeof content === "string" ? content.trim() : "";

    // IGNORA mensagens vazias ou objetos
    if (!text || text === "[object Object]") return;

    // Evita salvar conteúdo repetido
    const now = Date.now();
    if (text === lastSaved.content && now - lastSaved.timestamp < MIN_INTERVAL) {
      return; // Ignora spam repetido
    }

    // Atualiza última memória salva
    lastSaved = { content: text, timestamp: now };

    queue.push({
      category: category.toString(),
      content: text,
      userId: userId.toString(),
      role: role.toString()
    });

    processQueue();
  } catch (err) {
    console.error("❌ Erro enqueueSemanticMemory:", err.message);
  }
}

async function processQueue() {
  if (processing) return;
  processing = true;

  while (queue.length > 0) {
    const item = queue.shift();

    try {
      await addSemanticMemory(
        item.category,
        item.content,
        item.userId,
        item.role
      );

      console.log("🧠 Memória semântica salva:", item.category);

      // Aguarda um intervalo para evitar spam
      await new Promise(res => setTimeout(res, 250));
    } catch (err) {
      console.error("❌ Erro ao salvar memória semântica:", err.message);
    }
  }

  processing = false;
}

export default enqueueSemanticMemory;
