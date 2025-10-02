import { db } from "../server.js"; // ou ajuste o caminho conforme sua estrutura

// Busca o nome do usuário pelo número
export async function getUserName(number) {
  try {
    const doc = await db.collection("users").findOne({ numero: number });
    return doc?.nome || null;
  } catch (err) {
    console.error("❌ Erro ao buscar nome do usuário:", err);
    return null;
  }
}

// Define ou atualiza o nome do usuário
export async function setUserName(number, name) {
  try {
    await db.collection("users").updateOne(
      { numero: number },
      { $set: { nome: name } },
      { upsert: true }
    );
  } catch (err) {
    console.error("❌ Erro ao salvar nome do usuário:", err);
  }
}
