import cron from "node-cron";
import { criarContainer, publicarContainer } from "./instagram.js";
import { gerarPostAmber } from "./amber/amberContent.js";

cron.schedule("0 10 * * 1-5", async () => {
  try {
    // 🧠 Amber pensa o conteúdo
    const caption = await gerarPostAmber({
      plataforma: "Instagram",
      persona: "corporativa",
      objetivo: "conteúdo educativo e estratégico de RH"
    });

    // 📸 Post final
    const post = {
      imageUrl: "https://SEU_DOMINIO/imagem.jpg",
      caption
    };

    // 🚀 Publicação
    const containerId = await criarContainer(post);
    await publicarContainer(containerId);

    console.log("✅ Post da Amber publicado com sucesso");

  } catch (error) {
    console.error(
      "❌ Erro ao publicar:",
      error.response?.data || error.message
    );
  }
});
