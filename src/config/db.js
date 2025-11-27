// src/config/db.js  (ou onde você usa)
import mongoose from "mongoose";

export async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      // Estas options já vêm por padrão no mongoose atual, mas não atrapalham
      // pode remover se quiser:
      // useNewUrlParser: true,
      // useUnifiedTopology: true,
    });

    console.log("✅ Conectado ao MongoDB");
  } catch (error) {
    console.error("❌ Erro ao conectar ao MongoDB:", error.message);
    process.exit(1);
  }
}
