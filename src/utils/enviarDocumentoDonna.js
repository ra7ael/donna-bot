// src/utils/enviarDocumentoDonna.js
import fs from "fs";
import fetch from "node-fetch";

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

// 1️⃣ Função para enviar documento
export async function enviarDocumentoWhatsApp(to, filePath, caption = "") {
  if (!fs.existsSync(filePath)) throw new Error("Arquivo não encontrado: " + filePath);

  // lê o arquivo
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = filePath.split("/").pop();

  try {
    // 2️⃣ Primeiro faz upload do arquivo para o WhatsApp
    const uploadResponse = await fetch(`https://graph.facebook.com/v23.0/${WHATSAPP_PHONE_ID}/media`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${WHATSAPP_TOKEN}`
      },
      body: new URLSearchParams({
        "file": fileBuffer.toString("base64"),
        "type": "text/plain",
        "filename": fileName
      })
    });
    const uploadData = await uploadResponse.json();
    if (!uploadData.id) throw new Error("Upload falhou: " + JSON.stringify(uploadData));

    // 3️⃣ Envia a mensagem com o documento usando o mediaId retornado
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
