import axios from "axios";
import fs from "fs";
import FormData from "form-data";

export async function transcribeAudio(audioBuffer) {
  const tempFile = "/tmp/audio.ogg";
  fs.writeFileSync(tempFile, audioBuffer);

  const form = new FormData();
  form.append("file", fs.createReadStream(tempFile));
  form.append("model", "whisper-1");

  try {
    const response = await axios.post("https://api.openai.com/v1/audio/transcriptions", form, {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, ...form.getHeaders() },
    });
    return response.data?.text || "";
  } finally {
    try { fs.unlinkSync(tempFile); } catch(e) {}
  }
}
