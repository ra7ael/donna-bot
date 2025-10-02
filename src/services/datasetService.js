import fs from "fs";
import path from "path";

const datasetPath = path.join(new URL('../dataset/dataset.jsonl', import.meta.url).pathname);

// Carrega dataset em memória
const dataset = fs.readFileSync(datasetPath, "utf8")
  .split("\n")
  .filter(Boolean)
  .map(line => JSON.parse(line));

// Busca uma resposta parecida no dataset
export function buscarRespostaDataset(mensagem) {
  for (const entry of dataset) {
    const userMsg = entry.messages.find(m => m.role === "user");
    if (userMsg && mensagem.toLowerCase().includes(userMsg.content.toLowerCase())) {
      const assistantMsg = entry.messages.find(m => m.role === "assistant");
      return assistantMsg ? assistantMsg.content : null;
    }
  }
  return null;
}
