// src/utils/speak.js
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const ELEVEN_API_KEY = process.env.ELEVEN_API_KEY;
const VOICE_ID = process.env.DEFAULT_VOICE_ID || "pNInz6obpgDQGcFmaJgB";

async function speak(text) {
  try {
    const response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
      { text },
      {
        headers: {
          "xi-api-key": ELEVEN_API_KEY,
          "Content-Type": "application/json"
        },
        responseType: "arraybuffer"
      }
    );
    return response.data;
  } catch (err) {
    // Debug detalhado do erro
    if (err.response) {
      console.error("❌ Erro ao gerar áudio (resposta da API):", JSON.stringify(err.response.data, null, 2));
    } else {
      console.error("❌ Erro ao gerar áudio:", err.message);
    }
    return null;
  }
}

// Export correto para ES Modules
export default speak;

