// src/models/Memoria.js
const memory = new Map();

export function findInMemory(userMessage) {
  return memory.get(userMessage.toLowerCase()) || null;
}

export function learnMemory(userMessage, answer) {
  memory.set(userMessage.toLowerCase(), { answer });
}
