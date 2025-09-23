// src/utils/splitMessage.js
import axios from "axios";

/**
 * Envia uma mensagem dividida em blocos para WhatsApp
 * @param {string} to - Número do destinatário
 * @param {string} text - Texto a ser enviado
 * @param {string} phoneId - ID do telefone do WhatsApp
 * @param {string} token - Token de acesso da API do WhatsApp
 * @param {number} chunkSize - Tamanho máximo de cada bloco (default 400)
 */
export async function sendSplitWhatsApp(to, text, phoneId, token, chunkSize = 150) {
  if (!text) return;

  for (let i = 0; i < text.length; i += chunkSize) {
    const chunk = text.substring(i, i + chunkSize);

    try {
      await axios.post(
        `https://graph.facebook.com/v21.0/${phoneId}/messages`,
        { messaging_product: "whatsapp", to, text: { body: chunk } },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      console.log("📤 Mensagem enviada:", chunk);
    } catch (err) {
      console.error("❌ Erro ao enviar WhatsApp:", err.response?.data || err.message);
    }
  }
}
