// speak.js
import fs from "fs";
import path from "path";
import axios from "axios";
import FormData from "form-data";
import OpenAI from "openai";

// Inicializa OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Gera áudio a partir de texto usando OpenAI TTS
 * @param {string} texto - Texto para converter em fala
 * @param {string} arquivoSaida - Caminho opcional para salvar arquivo local
 * @returns {Promise<string>} - Caminho do arquivo salvo
 */
export async function falar(texto, arquivoSaida = "./audios/output.mp3") {
  try {
    if (!texto) throw new Error("Texto vazio para fala");

    const response = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "shimmer",
      input: texto
    });

    const audioBuffer = Buffer.from(await response.arrayBuffer());

    // garante pasta audios
    const dir = path.dirname(arquivoSaida);
    await fs.promises.mkdir(dir, { recursive: true });

    // salva localmente
    await fs.promises.writeFile(arquivoSaida, audioBuffer);

    return arquivoSaida;
  } catch (err) {
    console.error("❌ Erro no TTS OpenAI:", err);
    throw err;
  }
}

/**
 * Faz upload do arquivo de áudio para o WhatsApp e retorna media_id
 * @param {string} filePath - Caminho do arquivo local
 * @returns {Promise<string>} - media_id do WhatsApp
 */
async function uploadAudio(filePath) {
  const formData = new FormData();
  formData.append("file", fs.createReadStream(filePath));
  formData.append("type", "audio/mpeg");
  formData.append("messaging_product", "whatsapp");

  const res = await axios.post(
    `https://graph.facebook.com/v17.0/${process.env.WHATSAPP_PHONE_ID}/media`,
    formData,
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        ...formData.getHeaders(),
      },
    }
  );

  return res.data.id;
}

/**
 * Envia áudio via WhatsApp Cloud API
 * @param {string} to - Número do destinatário (ex: "5541999999999")
 * @param {string} filePath - Caminho do arquivo local salvo
 */
export async function sendAudio(to, filePath) {
  try {
    if (!fs.existsSync(filePath)) throw new Error("Arquivo não encontrado: " + filePath);

    // 1. sobe pro WhatsApp
    const mediaId = await uploadAudio(filePath);

    // 2. envia mensagem referenciando o media_id
    await axios.post(
      `https://graph.facebook.com/v17.0/${process.env.WHATSAPP_PHONE_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "audio",
        audio: { id: mediaId },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ Áudio enviado com sucesso!");
  } catch (err) {
    console.error("❌ Erro ao enviar áudio:", err.response?.data || err.message);
    throw err;
  }
}
