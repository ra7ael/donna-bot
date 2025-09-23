// Armazena respostas em memória (pode evoluir para DB depois)
const cache = new Map();

// Buscar resposta no cache
function getCached(prompt) {
  return cache.get(prompt);
}

// Salvar resposta no cache
function setCached(prompt, resposta) {
  cache.set(prompt, resposta);
}

module.exports = { getCached, setCached };
