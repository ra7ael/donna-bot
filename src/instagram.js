import axios from "axios";
import { config } from "./config.js";

// 1️⃣ Cria container do post
export async function criarContainer({ imageUrl, caption }) {
  const url = `${config.baseUrl}/${config.igBusinessId}/media`;

  const response = await axios.post(url, null, {
    params: {
      image_url: imageUrl,
      caption,
      access_token: config.token
    }
  });

  return response.data.id;
}

// 2️⃣ Publica o container
export async function publicarContainer(containerId) {
  const url = `${config.baseUrl}/${config.igBusinessId}/media_publish`;

  const response = await axios.post(url, null, {
    params: {
      creation_id: containerId,
      access_token: config.token
    }
  });

  return response.data;
}
