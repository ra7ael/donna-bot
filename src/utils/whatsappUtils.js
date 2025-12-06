// src/utils/whatsappUtils.js
import { askGPT } from "./askGPT.js";
import { sendMessage } from "./sendMessage.js";

// Função para processar comandos do tipo: envia "mensagem" para 55xxxxxxxxx
async function processarComandoWhatsApp(texto) {
  const regex = /envia\s+"(.+?)"\s+para\s+(\d+)/i;
  const match = texto.match(regex);
  if (match) {
    const mensagem = match[1];
    const numero = match[2];
    try {
      await sendMessage(numero, mensagem);
      return `✅ Mensagem enviada para ${numero}`;
    } catch (err) {
      console.error(err);
      return `❌ Não foi possível enviar para ${numero}`;
    }
  }
  return null; // não é comando
}

// Função principal para receber mensagens
export async function receberMensagemWhatsApp(mensagem, numeroOrigem) {
  const respostaComando = await processarComandoWhatsApp(mensagem);
  if (respostaComando) {
    await sendMessage(numeroOrigem, respostaComando);
    return;
  }

  const respostaDonna = await askGPT(mensagem);
  await sendMessage(numeroOrigem, respostaDonna);
}
