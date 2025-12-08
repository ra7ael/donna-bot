// src/utils/enviarDocumentoDonna.js
import fs from "fs";
import axios from "axios";
import FormData from "form-data";

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN; // seu token do WhatsApp Cloud API
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID; // ID do número do WhatsApp

export async function enviarDocumentoWhatsApp(to, filePath, caption = "") {
  try {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("to", to);
    form.append("type", "document");
    form.append("document", fs.createReadStream(filePath), {
      filename: filePath.split("/").pop(),
    });
    if (caption) form.append("caption", caption);

    const response = await axios.post(
      `https://graph.facebook.com/v15.0/${WHATSAPP_PHONE_ID}/messages`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );

    console.log("✅ Documento enviado com sucesso:", response.data);
    return response.data;

  } catch (err) {
    console.error(
      "❌ Erro ao enviar documento via WhatsApp:",
      err.response?.data || err.message
    );
    throw err;
  }
}
