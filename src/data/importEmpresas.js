import { MongoClient } from "mongodb";
import fs from "fs";

// URL de conexão com seu MongoDB (pega do Render ou Mongo Atlas)
const uri = "mongodb+srv://<usuario>:<senha>@<cluster>.mongodb.net/<dbname>?retryWrites=true&w=majority";
const client = new MongoClient(uri);

async function importarEmpresas() {
  try {
    // Conecta ao MongoDB
    await client.connect();
    const db = client.db("donna-bot");       // seu nome do DB
    const collection = db.collection("empresas"); // nome da coleção

    // Lê o JSON
    const data = fs.readFileSync("./data/empresas.json", "utf-8");
    const empresas = JSON.parse(data);

    // Insere no MongoDB
    const resultado = await collection.insertMany(empresas);
    console.log(`✅ Inseridas ${resultado.insertedCount} empresas!`);

  } catch (error) {
    console.error("Erro ao importar empresas:", error);
  } finally {
    await client.close();
  }
}

importarEmpresas();
