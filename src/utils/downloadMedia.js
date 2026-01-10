// src/utils/downloadMedia.js
import axios from 'axios';

export async function downloadMedia(mediaId) {
  if (!mediaId) {
    console.error("❌ downloadMedia: mediaId não fornecido.");
    return null;
  }

  const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;

  try {
    console.log(`[DOWNLOAD] Obtendo URL para mediaId: ${mediaId}...`);
    
    // 1. Pega a URL do media (Usando v19.0 que é a mais estável para mídias)
    const mediaInfo = await axios.get(
      `https://graph.facebook.com/v19.0/${mediaId}`,
      { 
        headers: { 
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`
        } 
      }
    );

    const mediaUrl = mediaInfo.data.url;
    if (!mediaUrl) {
      console.error("❌ downloadMedia: URL de mídia não encontrada na resposta da Meta.");
      return null;
    }

    console.log(`[DOWNLOAD] Baixando binário da URL: ${mediaUrl.slice(0, 50)}...`);

    // 2. Baixa o binário com headers de segurança
    const mediaData = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      headers: { 
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
        'User-Agent': 'curl/7.64.1' // Simula um cliente padrão para evitar bloqueio
      }
    });

    console.log(`[DOWNLOAD] ✅ Sucesso! Buffer gerado. Tamanho: ${mediaData.data.byteLength} bytes`);
    return Buffer.from(mediaData.data);

  } catch (err) {
    console.error('❌ Erro no downloadMedia:', err.response?.data || err.message);
    return null;
  }
}
