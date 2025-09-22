// src/utils/speak.js
import fs from "fs";
import path from "path";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function speakMessage(text, userId) {
  try {
    const outputDir = "./tmp";
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

    const filePath = path.join(outputDir, `reply_${userId}.mp3`);

    const mp3 = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "alloy", // 🔊 voz feminina padrão
      input: text,
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());
    fs.writeFileSync(filePath, buffer);

    return filePath;
  } catch (err) {
    console.error("❌ Erro ao gerar fala:", err.response?.data || err);
    return null;
  }
}
