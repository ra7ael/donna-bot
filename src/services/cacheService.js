let dbInstance;

export function setDB(db) {
  dbInstance = db;
}

export function getDB() {
  return dbInstance;
}

const cache = new Map();

export function getCached(key) {
  return cache.get(key);
}

export function setCached(key, value) {
  cache.set(key, value);
}

export default { setDB, getDB, getCached, setCached };
