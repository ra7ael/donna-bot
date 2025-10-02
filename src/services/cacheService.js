// src/services/cacheService.js
let dbInstance;

export function setDB(db) {
  dbInstance = db;
}

export function getDB() {
  return dbInstance;
}

const cache = new Map();

export function cacheGet(key) {
  return cache.get(key);
}

export function cacheSet(key, value) {
  cache.set(key, value);
}

export default { setDB, getDB, cacheGet, cacheSet };
