// src/utils/speak.js
import axios from 'axios';

/**
 * Gera áudio usando Coqui TTS
 * @param {string} text - Texto a ser convertido em fala
 * @param {string} voice - Nome da voz (opcional)
 * @returns {Buffer|null} - Buffer de áudio MP3
 */
export default async function speak(text, voice = 'alloy') {
  try {
    // URL do seu servidor Coqui TTS
    const TTS_SERVER_URL = process.env.COQUI_TTS_URL || 'http://localhost:5005/api/tts';

    const response = await axios.post(
      TTS_SERVER_URL,
      {
        text,
        voice,           // Voz que você quer usar
        format: 'mp3'    // Saída em mp3
      },
      { responseType: 'arraybuffer' } // Receber como buffer
    );

    return Buffer.from(response.data);
  } catch (err) {
    console.error('❌ Erro ao gerar áudio Coqui TTS:', err.message || err);
    return null;
  }
}

