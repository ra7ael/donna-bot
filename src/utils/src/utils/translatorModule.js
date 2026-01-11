import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import fs from "fs-extra";
import path from "path";
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });

export async function traduzirEGerarAudio(textoOriginal, idiomaDestino = "inglês") {
  try {
    // 1. Usamos o GPT (via seu askGPT) para traduzir com contexto natural
    // (Essa parte faremos no server.js para aproveitar sua função askGPT)
    
    // 2. Gerar o áudio com ElevenLabs
    const audioStream = await client.generate({
      voice: "Jessica", // Ou uma voz de sua preferência
      model_id: "eleven_multilingual_v2",
      text: textoOriginal,
    });

    const fileName = `trans_${uuidv4()}.mp3`;
    const filePath = path.join(__dirname, "../public/audio", fileName);
    
    const writableStream = fs.createWriteStream(filePath);
    audioStream.pipe(writableStream);

    return new Promise((resolve, reject) => {
      writableStream.on("finish", () => resolve(fileName));
      writableStream.on("error", reject);
    });
  } catch (error) {
    console.error("❌ Erro ElevenLabs:", error);
    return null;
  }
}
