// src/models/Memoria.js
const localMemory = [];

export function findInMemory(userMessage) {
  return localMemory.find(item => item.message.toLowerCase() === userMessage.toLowerCase());
}

export function learnMemory(userMessage, answer) {
  localMemory.push({ message: userMessage, answer });
}

export default { findInMemory, learnMemory };
