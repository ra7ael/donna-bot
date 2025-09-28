import fs from "fs";
import path from "path";
import ElevenLabs from "@elevenlabs/elevenlabs-js";

const eleven = new ElevenLabs({
  apiKey: process.env.ELEVEN_API_KEY, // sua chave da ElevenLabs
});

// Função para falar e salvar áudio
export async function falar(texto, nomeArquivo = "saida.mp3") {
  try {
    const response = await eleven.textToSpeech({
      voice: "alloy", // ou outro voice disponível
      input: texto,
    });

    // Converte para buffer e salva como MP3
    const buffer = Buffer.from(await response.arrayBuffer());
    const filePath = path.join(process.cwd(), nomeArquivo);
    fs.writeFileSync(filePath, buffer);

    console.log(`Áudio gerado em: ${filePath}`);
    return filePath;
  } catch (err) {
    console.error("Erro no TTS:", err);
    throw err;
  }
}

