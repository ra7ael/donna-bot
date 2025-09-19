import mongoose from "mongoose";

const reminderSchema = new mongoose.Schema({
  from: { type: String, required: true },
  text: { type: String, required: true },
  date: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model("Reminder", reminderSchema);
