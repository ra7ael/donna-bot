// src/utils/translatorModule.js
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const client = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

/**
 * Gera um áudio a partir de um texto traduzido
 * @param {string} texto - O texto já traduzido
 * @returns {string|null} - Nome do arquivo gerado ou null
 */
export async function traduzirEGerarAudio(texto) {
  try {
    const audio = await client.generate({
      voice: "Amber", // Certifique-se de que este nome de voz existe no seu ElevenLabs
      text: texto,
      model_id: "eleven_multilingual_v2",
    });

    const fileName = `traducao_${uuidv4()}.mp3`;
    // Salva na pasta public/audio que o seu server.js já monitora
    const filePath = path.join(__dirname, "..", "public", "audio", fileName);

    const fileStream = fs.createWriteStream(filePath);
    audio.pipe(fileStream);

    return new Promise((resolve, reject) => {
      fileStream.on("finish", () => resolve(fileName));
      fileStream.on("error", reject);
    });
  } catch (error) {
    console.error("❌ Erro no ElevenLabs:", error);
    return null;
  }
}
