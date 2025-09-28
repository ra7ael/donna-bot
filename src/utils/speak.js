import fs from "fs";
import path from "path";
import axios from "axios";
import OpenAI from "openai";
import { askGPT } from '../server.js';

// Inicializa OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Gera áudio a partir de texto usando OpenAI TTS
 * @param {string} texto - Texto para converter em fala
 * @param {string} arquivoSaida - Caminho opcional para salvar arquivo local (default: "./output.mp3")
 * @returns {Promise<Buffer>} - Buffer do áudio gerado
 */
export async function falar(texto, arquivoSaida = "./output.mp3") {
  try {
    if (!texto) throw new Error("Texto vazio para fala");

    const response = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      input: texto
    });

    const audioBuffer = Buffer.from(await response.arrayBuffer());

    // salva localmente
    await fs.promises.writeFile(arquivoSaida, audioBuffer);

    return audioBuffer;
  } catch (err) {
    console.error("❌ Erro no TTS OpenAI:", err);
    throw err;
  }
}

/**
 * Envia áudio via WhatsApp Cloud API
 * @param {string} to - Número do destinatário (ex: "5541999999999")
 * @param {Buffer} audioBuffer - Buffer do áudio gerado pelo OpenAI TTS
 */
export async function sendAudio(to, audioBuffer) {
  try {
    if (!audioBuffer) throw new Error("Audio buffer vazio");

    const audioBase64 = audioBuffer.toString("base64");

    await axios.post(
      `https://graph.facebook.com/v17.0/${process.env.WHATSAPP_PHONE_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "audio",
        audio: {
          data: audioBase64
        }
      },
      {
        headers: {
          "Authorization": `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("✅ Áudio enviado com sucesso!");
  } catch (err) {
    console.error("❌ Erro ao enviar áudio:", err.response?.data || err.message);
    throw err;
  }
}

