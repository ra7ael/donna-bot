import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const uri = process.env.MONGO_URI;
const dbName = process.env.DONNA_DB_NAME || "donna";

async function corrigirCampos() {
  await mongoose.connect(uri);
  const db = mongoose.connection.useDb(dbName);
  const colecao = db.collection("semanticMemory");

  const documentos = await colecao.find({}).toArray();
  let corrigidos = 0;

  for (const doc of documentos) {
    const atualizacoes = {};

    if (doc.número) {
      atualizacoes.userId = doc.número;
    }
    if (doc.função) {
      atualizacoes.role = doc.função.toLowerCase() === "usuário" ? "user" : "assistant";
    }
    if (doc.conteúdo) {
      atualizacoes.content = doc.conteúdo;
    }

    const precisaAtualizar = Object.keys(atualizacoes).length > 0;

    if (precisaAtualizar) {
      await colecao.updateOne(
        { _id: doc._id },
        {
          $set: atualizacoes,
          $unset: { número: "", função: "", conteúdo: "" }
        }
      );
      corrigidos++;
    }
  }

  console.log(`✅ Corrigidos ${corrigidos} documentos com campos fora do padrão.`);
  await mongoose.disconnect();
}

corrigirCampos();
