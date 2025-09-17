import mongoose from "mongoose";

const memoriaSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  memoria: {
    nome: String,
    idade: Number,
    projetos: [String],
    preferencias: {
      aprendizado: String,
      plano: String,
    },
    eventos: [
      {
        data: String,
        descricao: String,
      },
    ],
  },
});

export default mongoose.model("Memoria", memoriaSchema);
