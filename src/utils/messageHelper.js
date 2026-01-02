// src/utils/messageHelper.js

/**
 * 1️⃣ Normaliza a mensagem do WhatsApp
 * Transforma qualquer mensagem em um formato simples
 */
export function normalizeMessage(messageObj) {
  if (!messageObj) return null;

  const type = messageObj.type || "unknown";

  // TEXTO
  if (type === "text") {
    const body = messageObj.text?.body || "";
    return {
      type: "text",
      body,
      bodyLower: body.toLowerCase()
    };
  }

  // ÁUDIO
  if (type === "audio") {
    return {
      type: "audio",
      audioId: messageObj.audio?.id, // ID necessário para transcrição
      body: "",                       // corpo vazio, será preenchido pela transcrição
      bodyLower: ""
    };
  }

  // DOCUMENTO
  if (type === "document") {
    const body = messageObj.document?.filename || "[DOCUMENTO]";
    return {
      type: "document",
      body,
      bodyLower: body.toLowerCase()
    };
  }

  return null;
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
