import Memoria from "../models/Memoria.js";

export async function salvarMemoria(userId, dados) {
  let memoria = await Memoria.findOne({ userId });

  if (!memoria) {
    memoria = new Memoria({ userId, memoria: dados });
  } else {
    memoria.memoria = { ...memoria.memoria, ...dados };
  }

  await memoria.save();
  return memoria;
}

export async function buscarMemoria(userId) {
  return await Memoria.findOne({ userId });
}
