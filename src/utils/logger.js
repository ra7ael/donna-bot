// src/utils/logger.js
export function logInfo(...args) {
  console.log("ℹ️", ...args);
}
export function logError(...args) {
  console.error("❌", ...args);
}
export function logWarn(...args) {
  console.warn("⚠️", ...args);
}
