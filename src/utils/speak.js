import fs from "fs";
import path from "path";
import OpenAI from "openai";

// Inicialize a OpenAI com a chave da sua .env
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Gera áudio a partir de texto usando OpenAI TTS.
 * @param {string} texto - O texto que será convertido em fala
 * @param {string} arquivoSaida - Caminho do arquivo de saída (ex: "./audio.mp3")
 * @returns {Promise<Buffer>} - Retorna buffer do áudio
 */
export async function falar(texto, arquivoSaida = "./output.mp3") {
  try {
    if (!texto) throw new Error("Texto vazio para fala");

    const response = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts", // modelo TTS
      voice: "alloy",           // voz, pode mudar se quiser
      input: texto
    });

    // converte ArrayBuffer para Buffer
    const audioBuffer = Buffer.from(await response.arrayBuffer());

    // salva arquivo local
    await fs.promises.writeFile(arquivoSaida, audioBuffer);

    return audioBuffer;
  } catch (err) {
    console.error("❌ Erro no TTS OpenAI:", err);
    throw err;
  }
}

