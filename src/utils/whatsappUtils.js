// src/utils/whatsappUtils.js
import { sendMessage } from "./sendMessage.js";

/**
 * Processa comandos do tipo: envia "mensagem" para 55xxxxxxxxx
 * @param {string} texto 
 * @returns {string|null} mensagem de status ou null se não for comando
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
 * @param {string} mensagem - texto ou comando recebido
 * @param {string} numeroOrigem - número do remetente
 */
export async function receberMensagemWhatsApp(mensagem, numeroOrigem) {
  try {
    // 1️⃣ Verifica se é um comando de envio
    const respostaComando = await processarComandoWhatsApp(mensagem);
    if (respostaComando) {
      await sendMessage(numeroOrigem, respostaComando);
      return;
    }

    // 2️⃣ Resposta via GPT
    const respostaDonna = await global.apiExports.askGPT(mensagem);
    await sendMessage(numeroOrigem, respostaDonna);

  } catch (err) {
    console.error("❌ Erro no receberMensagemWhatsApp:", err.message);
    await sendMessage(numeroOrigem, "❌ Ocorreu um erro ao processar sua mensagem.");
  }
}
