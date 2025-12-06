// src/utils/whatsappUtils.js
import { sendMessage } from "./sendMessage.js";

/**
 * Processa comandos do tipo: envia "mensagem" para 55xxxxxxxxx
 */
async function processarComandoWhatsApp(texto) {
  const regex = /envia\s+"(.+?)"\s+para\s+(\d+)/i;
  const match = texto.match(regex);
  if (!match) return null;

  const mensagem = match[1];
  const numero = match[2];

  try {
    await sendMessage(numero, mensagem);
    return `✅ Mensagem enviada para ${numero}`;
  } catch (err) {
    console.error("❌ Erro enviar comando WhatsApp:", err.message);
    return `❌ Não foi possível enviar para ${numero}`;
  }
}

/**
 * Função principal para receber mensagens do WhatsApp
 */
export async function receberMensagemWhatsApp(mensagem, numeroOrigem) {
  try {
    const respostaComando = await processarComandoWhatsApp(mensagem);
    if (respostaComando) {
      await sendMessage(numeroOrigem, respostaComando);
      return;
    }

    // ⚡ Usando apenas global.apiExports.askGPT
    const respostaDonna = await global.apiExports.askGPT(mensagem);
    await sendMessage(numeroOrigem, respostaDonna);

  } catch (err) {
    console.error("❌ Erro no receberMensagemWhatsApp:", err.message);
    await sendMessage(numeroOrigem, "❌ Ocorreu um erro ao processar sua mensagem.");
  }
}
