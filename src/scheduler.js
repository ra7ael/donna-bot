import cron from "node-cron";
import { criarContainer, publicarContainer } from "./instagram.js";

cron.schedule("0 10 * * 1-5", async () => {
  try {
    const post = {
      imageUrl: "https://SEU_DOMINIO/imagem.jpg",
      caption: "Bom dia. A Amber trouxe um insight rápido de RH ☕📋"
    };

    const containerId = await criarContainer(post);
    await publicarContainer(containerId);

    console.log("✅ Post publicado com sucesso");
  } catch (error) {
    console.error("❌ Erro ao publicar:", error.response?.data || error.message);
  }
});
