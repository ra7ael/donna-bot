import mongoose from "mongoose";

const reminderSchema = new mongoose.Schema({
  from: { type: String, required: true, trim: true },
  text: { type: String, required: true, trim: true },
  date: { type: Date, required: true, index: true },
  triggered: { type: Boolean, default: false, index: true }, // evita disparos repetidos
  createdAt: { type: Date, default: Date.now }
});

// Prevenção para redeclaração da model (import circular ou reload)
const Reminder = mongoose.models.Reminder || mongoose.model("Reminder", reminderSchema);

export default Reminder;

