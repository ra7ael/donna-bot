import mongoose from "mongoose";

const historicoSchema = new mongoose.Schema({
  numero: { type: String, required: true },   // número de quem enviou
  mensagem: { type: String },                 // o que o usuário mandou
  resposta: { type: String },                 // o que a Rafa respondeu
  timestamp: { type: Date, default: Date.now }
});

export default mongoose.model("Historico", historicoSchema);
