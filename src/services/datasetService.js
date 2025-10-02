import fs from "fs";
import path from "path";

let dbInstance;

export function setDB(db) {
  dbInstance = db;
}

export function getDB() {
  return dbInstance;
}

const datasetPath = path.join(new URL('../dataset/dataset.jsonl', import.meta.url).pathname);
const dataset = fs.readFileSync(datasetPath, "utf8")
  .split("\n")
  .filter(Boolean)
  .map(line => JSON.parse(line));

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

export default { setDB, getDB, buscarRespostaDataset };
