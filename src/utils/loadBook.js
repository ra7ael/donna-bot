import fs from "fs";
import path from "path";

export function loadBook() {
  const filePath = path.resolve("data/manual_rh_teste.txt");
  const text = fs.readFileSync(filePath, "utf-8");
  return text;
}

export function splitIntoChunks(text, chunkSize = 800) {
  const paragraphs = text.split("\n\n");
  const chunks = [];
  let current = "";

  for (const p of paragraphs) {
    if ((current + p).length > chunkSize) {
      chunks.push(current.trim());
      current = p;
    } else {
      current += "\n\n" + p;
    }
  }

  if (current.trim()) chunks.push(current.trim());

  return chunks;
}
