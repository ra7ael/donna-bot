// src/utils/enviarDocumentoDonna.js
import fs from "fs";
import fetch from "node-fetch"; // ou axios se preferir
import path from "path";

const WHATSAPP_API_URL = "https://graph.facebook.com/v23.0/YOUR_PHONE_NUMBER_ID/messages";
const TOKEN = process.env.WHATSAPP_TOKEN; // seu token da API do WhatsApp

export async function enviarDocumentoWhatsApp(to, filePath, caption = "") {
  if (!fs.existsSync(filePath)) throw new Error("Arquivo não encontrado: " + filePath);

  // opcional: gerar link público do arquivo, se necessário
  // se o servidor estiver publicamente acessível, você pode apenas usar a URL
  const fileName = path.basename(filePath);
  const fileBuffer = fs.readFileSync(filePath);
  const base64File = fileBuffer.toString("base64");

  // payload de envio do documento
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "document",
    document: {
      caption,
      filename: fileName,
      // se quiser enviar como base64 diretamente:
      // media: base64File
      link: `https://meuservidor.com/generated/${fileName}` // ou use sua URL pública
    }
  };

  const response = await fetch(WHATSAPP_API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Erro ao enviar documento WhatsApp: ${response.status} ${errorText}`);
  }

  console.log(`✅ Documento enviado para ${to}: ${fileName}`);
}
