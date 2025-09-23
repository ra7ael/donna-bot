const fs = require("fs");
const path = require("path");

const datasetPath = path.join(__dirname, "../dataset/dataset.jsonl");

// Carrega dataset em memória
const dataset = fs.readFileSync(datasetPath, "utf8")
  .split("\n")
  .filter(Boolean)
  .map(line => JSON.parse(line));

// Busca uma resposta parecida no dataset
function buscarRespostaDataset(mensagem) {
  for (const entry of dataset) {
    const userMsg = entry.messages.find(m => m.role === "user");
    if (userMsg && mensagem.toLowerCase().includes(userMsg.content.toLowerCase())) {
      const assistantMsg = entry.messages.find(m => m.role === "assistant");
      return assistantMsg ? assistantMsg.content : null;
    }
  }
  return null;
}

module.exports = { buscarRespostaDataset };
