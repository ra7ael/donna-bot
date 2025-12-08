import fs from "fs";
import fetch from "node-fetch";

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

export async function enviarDocumentoWhatsApp(to, filePath, caption = "") {
  if (!fs.existsSync(filePath)) throw new Error("Arquivo não encontrado: " + filePath);

  const fileBuffer = fs.readFileSync(filePath);
  const fileName = filePath.split("/").pop();

  try {
    // Upload do arquivo
    const formData = new FormData();
    formData.append("file", new Blob([fileBuffer], { type: "text/plain" }), fileName);
    formData.append("messaging_product", "whatsapp"); // ❗ ESSENCIAL

    const uploadResponse = await fetch(`https://graph.facebook.com/v23.0/${WHATSAPP_PHONE_ID}/media`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${WHATSAPP_TOKEN}`
      },
      body: formData
    });

    const uploadData = await uploadResponse.json();
    if (!uploadData.id) throw new Error("Upload falhou: " + JSON.stringify(uploadData));

    // Envia documento via WhatsApp
    const payload = {
      messaging_product: "whatsapp",
      to,
      type: "document",
      document: {
        id: uploadData.id,
        caption,
        filename: fileName
      }
    };

    const response = await fetch(`https://graph.facebook.com/v23.0/${WHATSAPP_PHONE_ID}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const sendData = await response.json();
    if (!response.ok) throw new Error(`Erro ao enviar documento: ${JSON.stringify(sendData)}`);

    console.log(`✅ Documento enviado para ${to}: ${fileName}`);
    return sendData;

  } catch (err) {
    console.error("❌ Erro enviarDocumentoWhatsApp:", err.message || err);
    throw err;
  }
}
