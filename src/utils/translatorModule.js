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

export async function traduzirEGerarAudio(texto) {
  try {
    // A MUDANÇA ESTÁ AQUI: client.textToSpeech.convert
    const response = await client.textToSpeech.convert("21m00Tcm4TlvDq8ikWAM", { // ID da voz (Rachel/Amber)
      text: texto,
      model_id: "eleven_multilingual_v2",
      output_format: "mp3_44100_128",
    });

    const fileName = `traducao_${uuidv4()}.mp3`;
    const filePath = path.join(__dirname, "..", "public", "audio", fileName);

    // Na versão nova, a resposta pode ser tratada como stream assim:
    const fileStream = fs.createWriteStream(filePath);
    
    // Se a resposta for um stream direto:
    if (response.pipe) {
        response.pipe(fileStream);
    } else {
        // Caso a biblioteca retorne o buffer direto (depende da subversão)
        await fs.writeFile(filePath, response);
    }

    return new Promise((resolve, reject) => {
      fileStream.on("finish", () => resolve(fileName));
      fileStream.on("error", reject);
      // Caso não seja stream, resolvemos direto
      if (!response.pipe) resolve(fileName);
    });

  } catch (error) {
    console.error("❌ Erro no ElevenLabs:", error);
    return null;
  }
}
