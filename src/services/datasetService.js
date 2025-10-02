// src/services/datasetService.js
import fs from "fs";
import path from "path";

// Carrega dataset (ajuste o caminho se necessário)
const datasetPath = path.resolve("./src/dataset/dataset.jsonl");
const dataset = fs.existsSync(datasetPath)
  ? fs.readFileSync(datasetPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map(line => JSON.parse(line))
  : [];

export function getDatasetAnswer(userMessage) {
  for (const entry of dataset) {
    const userMsg = entry.messages.find(m => m.role === "user");
    if (userMsg && userMessage.toLowerCase().includes(userMsg.content.toLowerCase())) {
      const assistantMsg = entry.messages.find(m => m.role === "assistant");
      return assistantMsg ? assistantMsg.content : null;
    }
  }
  return null;
}

