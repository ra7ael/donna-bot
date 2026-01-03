import cron from "node-cron";
import fs from "fs-extra";
import path from "path";
import { postarInstagram } from "../instagram.js";
import { askGPT } from "../openai.js"; // ajuste se o nome for outro

const IMAGENS_DIR = path.join(process.cwd(), "imagens");

// função para pegar imagem aleatória
function escolherImagemAleatoria() {
  if (!fs.existsSync(IMAGENS_DIR)) return null;

  const arquivos = fs
    .readdirSync(IMAGENS_DIR)
    .filter(f => /\.(jpg|jpeg|png)$/i.test(f));

  if (arquivos.length === 0) return null;

  return arquivos[Math.floor(Math.random() * arquivos.length)];
}

// ⏰ SEG–SEX às 10h
cron.schedule("0 10 * * 1-5", async () => {
  try {
    console.log("📸 Cron Instagram iniciado");

    const filename = escolherImagemAleatoria();
    if (!filename) {
      console.log("⚠️ Nenhuma imagem encontrada na pasta imagens/");
      return;
    }

    // 🧠 GPT cria a legenda
    const prompt = `
Você é Amber, especialista em RH e comunicação corporativa.

Crie uma legenda para Instagram:
- Tom profissional e humano
- Conteúdo educativo sobre RH
- Texto curto, organizado e bonito
- Use emojis com moderação
- Finalize com CTA suave
`;

    const caption = await askGPT(prompt);

    // 🚀 Publicar
    const resultado = await postarInstagram({
      filename,
      caption
    });

    if (resultado?.id) {
      console.log(`✅ Post publicado com sucesso | ID: ${resultado.id}`);
    } else {
      console.log("❌ Falha ao publicar post");
    }

  } catch (error) {
    console.error("❌ Erro no cron do Instagram:", error);
  }
});
