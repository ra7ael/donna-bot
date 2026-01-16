import axios from "axios";
import fs from "fs-extra"; // fs-extra é melhor para garantir diretórios
import path from "path";

const INSTAGRAM_BUSINESS_ID = process.env.INSTAGRAM_BUSINESS_ID;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const SERVER_URL = (process.env.SERVER_URL || "").replace(/\/$/, "");

export async function postarInstagram({ filename, caption }) {
  try {
    // 1. Verificar se o arquivo existe na pasta temporária do Google Cloud
    const imagePath = path.join("/tmp", filename);
    
    if (!fs.existsSync(imagePath)) {
      console.error(`❌ Arquivo não localizado em: ${imagePath}`);
      throw new Error("Arquivo não encontrado!");
    }

    // 2. Gerar a URL pública que o Instagram vai usar para baixar a foto
    const image_source = `${SERVER_URL}/images/${filename}`;
    console.log(`🔗 Enviando URL para o Instagram: ${image_source}`);

    // 3. Criar o container de mídia no Instagram
    const response = await axios.post(
      `https://graph.facebook.com/v21.0/${INSTAGRAM_BUSINESS_ID}/media`,
      {
        caption: caption,
        image_url: image_source,
        access_token: META_ACCESS_TOKEN
      }
    );

    const creationId = response.data.id;
    console.log(`✅ Container de mídia criado. ID: ${creationId}`);

    // 4. Publicar a mídia oficialmente no feed
    const publishResponse = await axios.post(
      `https://graph.facebook.com/v21.0/${INSTAGRAM_BUSINESS_ID}/media_publish`,
      {
        creation_id: creationId,
        access_token: META_ACCESS_TOKEN
      }
    );

    console.log("🚀 Postagem publicada com sucesso no Instagram!");
    return publishResponse.data;

  } catch (error) {
    // Log detalhado para capturar erros da Meta (Token, ID, etc)
    const erroMeta = error.response?.data || error.message;
    console.error("❌ Erro detalhado no módulo Instagram:", JSON.stringify(erroMeta, null, 2));
    
    return { error: true, details: erroMeta };
  }
}
