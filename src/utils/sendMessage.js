// utils/sendMessage.js
import axios from "axios";
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;

function dividirMensagem(texto, limite = 300) {
  const partes = [];
  let inicio = 0;

  while (inicio < texto.length) {
    let fim = inicio + limite;
    if (fim < texto.length) {
      fim = texto.lastIndexOf(" ", fim);
      if (fim === -1) fim = inicio + limite;
    }
    partes.push(texto.slice(inicio, fim).trim());
    inicio = fim + 1;
  }
  return partes;
}

export async function sendMessage(to, text) {
  try {
    const partes = dividirMensagem(text);
    for (const parte of partes) {
      await axios.post(
        `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_ID}/messages`,
        {
          messaging_product: "whatsapp",
          to,
          text: { body: parte }
        },
        {
          headers: {
            Authorization: `Bearer ${WHATSAPP_TOKEN}`,
            "Content-Type": "application/json"
          }
        }
      );
    }
  } catch (err) {
    console.error("❌ Erro enviar WhatsApp:", err.message);
  }
}
