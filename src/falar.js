import fs from "fs";
import path from "path";
import OpenAI from "openai";
import { askGPT } from '../server.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Função para gerar e salvar o áudio
export async function falar(texto) {
  try {
    const response = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "alloy",   // pode trocar: "verse", "aria", etc.
      input: texto
    });

    // Caminho onde o áudio será salvo
    const audioPath = path.resolve("src/public/audio/output.mp3");

    // Salvar em arquivo binário
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(audioPath, buffer);

    console.log("🎤 Áudio gerado e salvo em:", audioPath);

    // Retornar apenas o link público
    return "/audio/output.mp3";
  } catch (err) {
    console.error("❌ Erro ao gerar áudio:", err);
    throw err;
  }
}
