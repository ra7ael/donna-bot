import fs from "fs";
import FormData from "form-data";
import fetch from "node-fetch";

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

export async function enviarDocumentoWhatsApp(to, filePath, caption = "") {
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = filePath.split("/").pop();

  // 1️⃣ Upload da mídia
  const form = new FormData();
  form.append("file", fileBuffer, { filename: fileName });
  form.append("type", "document"); // isso é crucial!

  const uploadRes = await fetch(`https://graph.facebook.com/v23.0/${WHATSAPP_PHONE_ID}/media`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`
    },
    body: form
  });

  const uploadData = await uploadRes.json();
  if (!uploadData.id) throw new Error("Upload falhou: " + JSON.stringify(uploadData));

  // 2️⃣ Envio do documento
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "document",
    document: {
      id: uploadData.id,
      filename: fileName,
      caption
    }
  };

  const sendRes = await fetch(`https://graph.facebook.com/v23.0/${WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const sendData = await sendRes.json();
  if (!sendRes.ok) throw new Error("Erro ao enviar documento: " + JSON.stringify(sendData));

  console.log(`✅ Documento enviado para ${to}: ${fileName}`);
  return sendData;
}
