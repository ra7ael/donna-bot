// models/Contact.js
import mongoose from "mongoose";

const contactSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true }, // número do WhatsApp
  name: { type: String }, // nome do usuário
  waitingName: { type: Boolean, default: false } // flag se está aguardando nome
});

export default mongoose.model("Contact", contactSchema);
