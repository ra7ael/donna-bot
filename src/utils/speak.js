import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import dotenv from 'dotenv';

dotenv.config();

const elevenlabs = new ElevenLabsClient({
  apiKey: process.env.ELEVEN_API_KEY, // sua chave do ElevenLabs
});

const VOICE_ID = process.env.DEFAULT_VOICE_ID || 'IwYczQpZ9cL8cSLltfoT'; // Rachel

export default async function speak(text) {
  try {
    const audioBuffer = await elevenlabs.textToSpeech.convert(VOICE_ID, {
      text,
      modelId: 'eleven_multilingual_v2',
      outputFormat: 'mp3_44100_128',
    });

    return Buffer.from(await audioBuffer.arrayBuffer());
  } catch (err) {
    console.error('❌ Erro ao gerar áudio:', err);
    return null;
  }
}


