import mongoose from "mongoose";

const reminderSchema = new mongoose.Schema({
  from: { type: String, required: true },     // número do usuário
  text: { type: String, required: true },     // mensagem do lembrete
  date: { type: Date, required: true },       // quando deve disparar
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model("Reminder", reminderSchema);
