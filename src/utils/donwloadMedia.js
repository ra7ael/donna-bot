// src/utils/downloadMedia.js
import axios from 'axios';
import fs from 'fs';

export async function downloadMedia(mediaId) {
  if (!mediaId) return null;

  const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;

  try {
    // Pega a URL do media
    const mediaInfo = await axios.get(
      `https://graph.facebook.com/v17.0/${mediaId}`,
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
    );

    const mediaUrl = mediaInfo.data.url;
    const mediaData = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
    });

    return Buffer.from(mediaData.data);
  } catch (err) {
    console.error('❌ Erro ao baixar áudio:', err.response?.data || err);
    return null;
  }
}
