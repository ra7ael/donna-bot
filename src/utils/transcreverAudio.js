import axios from "axios";
import fs from "fs";
import path from "path";
import FormData from "form-data";

/**
 * Baixa o áudio do WhatsApp e transcreve usando OpenAI
 * @param {string} mediaId
 * @returns {Promise<string>} texto transcrito
 */
export async function transcreverAudio(mediaId) {
  try {
    // 1️⃣ Buscar URL do áudio no WhatsApp
    const mediaRes = await axios.get(
      `https://graph.facebook.com/v17.0/${mediaId}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`
        }
      }
    );

    const audioUrl = mediaRes.data.url;

    // 2️⃣ Baixar o áudio
    const audioRes = await axios.get(audioUrl, {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`
      },
      responseType: "arraybuffer"
    });

    const tempDir = "./tmp";
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

    const filePath = path.join(tempDir, `${mediaId}.ogg`);
    fs.writeFileSync(filePath, audioRes.data);

    // 3️⃣ Enviar para OpenAI (Whisper)
    const form = new FormData();
    form.append("file", fs.createReadStream(filePath));
    form.append("model", "gpt-4o-mini-transcribe");

    const openaiRes = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      form,
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          ...form.getHeaders()
        }
      }
    );

    return openaiRes.data.text || "";
  } catch (err) {
    console.error("❌ Erro ao transcrever áudio:", err.response?.data || err.message);
    return "";
  }
}
