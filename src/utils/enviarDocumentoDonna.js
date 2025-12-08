// src/utils/enviarDocumentoDonna.js
import fs from "fs";
import axios from "axios";

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN; // seu token do WhatsApp Cloud API
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID; // ID do número do WhatsApp

export async function enviarDocumentoWhatsApp(to, filePath, caption = "") {
  try {
    // lê arquivo como base64
    const fileData = fs.readFileSync(filePath, { encoding: "base64" });
    const fileName = filePath.split("/").pop();

    const payload = {
      messaging_product: "whatsapp",
      to,
      type: "document",
      document: {
        caption,
        filename: fileName,
        data: fileData
      }
    };

    const response = await axios.post(
      `https://graph.facebook.com/v15.0/${WHATSAPP_PHONE_ID}/messages`,
      payload,
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
    );

    console.log("✅ Documento enviado com sucesso:", response.data);
    return response.data;

  } catch (err) {
    console.error("❌ Erro ao enviar documento via WhatsApp:", err.response?.data || err.message);
    throw err;
  }
}
