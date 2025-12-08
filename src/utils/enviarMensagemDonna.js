// src/utils/enviarMensagemDonna.js
import fs from "fs";
import path from "path";

// Função para enviar documento pelo WhatsApp
export async function enviarDocumentoWhatsApp(to, filePath, caption = "") {
  try {
    // valida se filePath foi passado
    if (!filePath || typeof filePath !== "string") {
      throw new Error("Parâmetro 'filePath' inválido ou não informado");
    }

    // transforma em caminho absoluto se não for
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(process.cwd(), filePath);

    // verifica se o arquivo existe
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Arquivo não encontrado: ${absolutePath}`);
    }

    // lê o arquivo
    const fileBuffer = fs.readFileSync(absolutePath);

    console.log(`✅ Enviando documento para ${to}: ${absolutePath}`);

    // AQUI entra a lógica real de envio para WhatsApp
    // exemplo fictício:
    // await whatsappAPI.sendDocument(to, fileBuffer, caption);

    return true;

  } catch (err) {
    console.error("❌ Erro ao enviar documento WhatsApp:", err.message);
    throw err; // relança para o webhook tratar
  }
}
