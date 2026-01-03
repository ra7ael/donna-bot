import axios from "axios";
import fs from "fs";
import path from "path";

const INSTAGRAM_BUSINESS_ID = process.env.INSTAGRAM_BUSINESS_ID;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;

export async function postarInstagram({ filename, imageUrl, caption }) {
  try {
    // Se tiver filename, cria a URL ou base64 (Instagram API aceita URL)
    let image_source = imageUrl;
    if (filename) {
      const imagePath = path.join("imagens", filename);
      if (!fs.existsSync(imagePath)) throw new Error("Arquivo não encontrado!");
      image_source = `https://meu-servidor.com/${imagePath}`; // você pode usar um servidor público ou S3
    }

    // criar mídia
    const response = await axios.post(
      `https://graph.facebook.com/v19.0/${INSTAGRAM_BUSINESS_ID}/media`,
      {
        caption,
        image_url: image_source,
        access_token: META_ACCESS_TOKEN
      }
    );

    const creationId = response.data.id;

    // publicar mídia
    const publishResponse = await axios.post(
      `https://graph.facebook.com/v19.0/${INSTAGRAM_BUSINESS_ID}/media_publish`,
      {
        creation_id: creationId,
        access_token: META_ACCESS_TOKEN
      }
    );

    // salvar log da postagem
    fs.ensureDirSync("postagens");
    const logFile = path.join("postagens", `${Date.now()}_${creationId}.json`);
    fs.writeJsonSync(logFile, { caption, filename, imageUrl, creationId, data: new Date() });

    return publishResponse.data;
  } catch (error) {
    console.error("Erro ao postar Instagram:", error.response?.data || error);
    return null;
  }
}
