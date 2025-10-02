// src/services/cacheService.js
let db;
const cache = new Map();

export function setDB(database) {
  db = database;
}

export function getDB() {
  return db;
}

export function getCached(prompt) {
  return cache.get(prompt);
}

export function setCached(prompt, resposta) {
  cache.set(prompt, resposta);
}
