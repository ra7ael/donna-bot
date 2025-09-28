import say from 'say';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export default async function speak(text) {
  return new Promise((resolve, reject) => {
    const fileName = `audio_${uuidv4()}.wav`;
    const filePath = path.join('./temp', fileName);

    if (!fs.existsSync('./temp')) fs.mkdirSync('./temp');

    say.export(text, null, 1.0, filePath, (err) => {
      if (err) return reject(err);
      const buffer = fs.readFileSync(filePath);
      fs.unlinkSync(filePath);
      resolve(buffer);
    });
  });
}
