import Memoria from "../models/Memoria.js";

/**
 * Salvar dados na memória estruturada do usuário
 * @param {String} userId
 * @param {Object} dados - dados a serem armazenados (ex.: { nome, empresa, papeis })
 */
export async function salvarMemoria(userId, dados) {
  let memoria = await Memoria.findOne({ userId });

  if (!memoria) {
    memoria = new Memoria({ userId, memoria: dados });
  } else {
    memoria.memoria = { ...memoria.memoria, ...dados };
  }

  await memoria.save();
  console.log(`💾 Memória estruturada atualizada para ${userId}`);
  return memoria;
}

/**
 * Buscar memória estruturada do usuário
 * @param {String} userId
 * @returns {Object|null} - memória armazenada
 */
export async function buscarMemoria(userId) {
  return await Memoria.findOne({ userId });
}

/**
 * Apagar memória do usuário
 * @param {String} userId
 */
export async function limparMemoria(userId) {
  await Memoria.deleteOne({ userId });
  console.log(`🗑️ Memória do usuário ${userId} apagada`);
}
