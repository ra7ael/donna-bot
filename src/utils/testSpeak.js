import fs from 'fs';
import speak from './src/utils/speak.js';

async function testSpeak() {
  const text = "Olá, isso é um teste de áudio da Donna!";
  const audioBuffer = await speak(text);

  if (audioBuffer) {
    fs.writeFileSync('teste.mp3', audioBuffer);
    console.log('✅ Áudio gerado com sucesso: teste.mp3');
  } else {
    console.log('❌ Falha ao gerar áudio');
  }
}

testSpeak();
