// src/utils/downloadMedia.js
import axios from 'axios';

export async function downloadMedia(mediaId) {
  if (!mediaId) return null;
  const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;

  try {
    // Tente usar v19.0 que é mais estável para Vision
    const mediaInfo = await axios.get(
      `https://graph.facebook.com/v19.0/${mediaId}`,
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
    );

    const mediaUrl = mediaInfo.data.url;
    const mediaData = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
    });

    return Buffer.from(mediaData.data);
  } catch (err) {
    // Importante: Adicione este log para vermos o erro real se falhar
    console.error('❌ Erro no downloadMedia:', err.response?.data || err.message);
    return null;
  }
}
