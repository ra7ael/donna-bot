import axios from "axios";
import fs from "fs";
import FormData from "form-data";

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

export async function enviarDocumentoWhatsApp(to, { document, caption }) {
  try {
    const fileData = fs.readFileSync(document);

    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("to", to);
    form.append("type", "document");
    form.append("document", fileData, {
      filename: document.split("/").pop(),
      contentType: "text/plain"
    });
    form.append("caption", caption || "");

    const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;

    await axios.post(url, form, {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        ...form.getHeaders()
      }
    });

    console.log("📄 Documento enviado com sucesso:", document);
  } catch (err) {
    console.error("❌ Erro ao enviar documento:", err.response?.data || err);
  }
}
