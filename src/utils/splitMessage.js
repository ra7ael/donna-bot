// utils/splitMessage.js
export function splitMessage(text, limit = 400) {
  const parts = [];
  let chunk = "";

  const sentences = text.split(/(?<=[.!?])\s+/); // divide por frases

  for (let sentence of sentences) {
    if ((chunk + " " + sentence).trim().length <= limit) {
      chunk += " " + sentence;
    } else {
      parts.push(chunk.trim());
      chunk = sentence;
    }
  }

  if (chunk) parts.push(chunk.trim());

  return parts;
}
