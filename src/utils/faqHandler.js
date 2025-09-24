import fs from "fs";
import path from "path";

// Carregar todos os arquivos de FAQ da pasta
function carregarFAQs() {
  const faqDir = path.resolve("./src/faq");
  const arquivos = fs.readdirSync(faqDir);

  let baseFAQ = {};

  for (const arquivo of arquivos) {
    if (arquivo.endsWith(".json")) {
      const filePath = path.join(faqDir, arquivo);
      const conteudo = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      baseFAQ = { ...baseFAQ, ...conteudo };
    }
  }

  return baseFAQ;
}

const faqBase = carregarFAQs();

/**
 * Responde mensagens de usuários não autorizados
 * @param {string} mensagem - Texto do usuário
 * @returns {string|null} Resposta do FAQ ou null se não encontrado
 */
export function responderFAQ(mensagem) {
  const chave = mensagem.toLowerCase().trim();

  if (faqBase[chave]) {
    return faqBase[chave];
  }

  return null;
}
