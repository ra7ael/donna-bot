import fs from "fs";
import path from "path";
import axios from "axios";
import FormData from "form-data";
import OpenAI from "openai";
import "../../config/env.js"; // ajustado para subir um nível


const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function falar(texto, arquivoSaida = "./audios/output.mp3") {
  const response = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: "sage",
    input: texto
  });

  const audioBuffer = Buffer.from(await response.arrayBuffer());

  const dir = path.dirname(arquivoSaida);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(arquivoSaida, audioBuffer);

  return arquivoSaida;
}

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

// ✅ Aqui só uma vez
export async function sendAudio(to, filePath) {
  if (!fs.existsSync(filePath)) throw new Error("Arquivo não encontrado: " + filePath);

  const mediaId = await uploadAudio(filePath);

  await axios.post(
    `https://graph.facebook.com/v17.0/${process.env.WHATSAPP_PHONE_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "audio",
      audio: { id: mediaId },
    },
    { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
  );

  console.log("✅ Áudio enviado com sucesso!");
}


