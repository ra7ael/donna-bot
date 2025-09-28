import fs from "fs";
import axios from "axios";
import FormData from "form-data";
import path from "path";

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN; // teu token de acesso
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID; // ID do número do WhatsApp Business

// 1) Faz upload do áudio para o Graph
async function uploadAudio(filePath) {
  try {
    const formData = new FormData();
    formData.append("file", fs.createReadStream(filePath));
    formData.append("type", "audio/ogg");

    const response = await axios.post(
      `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/media`,
      formData,
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          ...formData.getHeaders(),
        },
      }
    );

    return response.data.id; // retorna o media_id
  } catch (err) {
    console.error("Erro no upload do áudio:", err.response?.data || err.message);
    throw err;
  }
}

// 2) Envia mensagem de áudio usando o media_id
async function sendAudio(to, filePath) {
  try {
    const mediaId = await uploadAudio(filePath);

    const response = await axios.post(
      `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "audio",
        audio: { id: mediaId },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("Áudio enviado com sucesso:", response.data);
    return response.data;
  } catch (err) {
    console.error("Erro ao enviar áudio:", err.response?.data || err.message);
    throw err;
  }
}

// Exemplo de uso
(async () => {
  const audioPath = path.join("src", "public", "audio", "resposta.ogg"); // caminho do arquivo gerado
  await sendAudio("554195194485", audioPath); // teu número de teste
})();
