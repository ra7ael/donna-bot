// src/utils/messageHelper.js

/**
 * 1️⃣ Normaliza a mensagem do WhatsApp
 * Transforma qualquer mensagem em um formato simples
 */
export function normalizeMessage(messageObj) {
  if (!messageObj) return null;

  let body = "";
  let type = messageObj.type || "unknown";

  if (type === "text") {
    body = messageObj.text?.body || "";
  }

  if (type === "audio") {
    body = "[ÁUDIO]";
  }

  if (type === "document") {
    body = messageObj.document?.filename || "[DOCUMENTO]";
  }

  return {
    body,
    bodyLower: body.toLowerCase(),
    type
  };
}

/**
 * 2️⃣ Porteiro: decide se a mensagem deve ser ignorada
 */
export function shouldIgnoreMessage(messageObj, from) {
  if (!messageObj) return true;

  // Ignorar mensagens enviadas pela própria Donna
  if (from && process.env.BOT_PHONE_NUMBER_ID && from.includes(process.env.BOT_PHONE_NUMBER_ID)) {
    return true;
  }

  // Tipos que não usamos
  const allowedTypes = ["text", "audio", "document"];
  if (!allowedTypes.includes(messageObj.type)) {
    return true;
  }

  return false;
}
