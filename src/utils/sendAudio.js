import FormData from "form-data";

export async function sendAudio(to, audioPath) {
  try {
    // 1️⃣ Faz upload do arquivo pro WhatsApp
    const formData = new FormData();
    formData.append("file", fs.createReadStream(audioPath));
    formData.append("type", "audio/ogg");
    formData.append("messaging_product", "whatsapp");

    const uploadRes = await axios.post(
      `https://graph.facebook.com/v17.0/${process.env.WHATSAPP_PHONE_ID}/media`,
      formData,
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          ...formData.getHeaders()
        }
      }
    );

    const mediaId = uploadRes.data.id;

    // 2️⃣ Envia mensagem usando o mediaId
    await axios.post(
      `https://graph.facebook.com/v17.0/${process.env.WHATSAPP_PHONE_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "audio",
        audio: { id: mediaId }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("✅ Áudio enviado com sucesso!");
  } catch (err) {
    console.error("❌ Erro ao enviar áudio:", err.response?.data || err.message);
    throw err;
  }
}

