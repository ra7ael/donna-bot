import axios from "axios";

// 🚀 Ajuste aqui a URL da sua API de WhatsApp
const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL || "http://localhost:3000/whatsapp/send";

export async function sendMessage(to, message) {
  try {
    const payload = {
      number: to,
      message: message
    };

    const response = await axios.post(WHATSAPP_API_URL, payload);

    console.log(`📨 Mensagem enviada para ${to}`);
    return response.data;

  } catch (error) {
    console.error("❌ Erro ao enviar mensagem:", error.response?.data || error.message);
    throw error;
  }
}
