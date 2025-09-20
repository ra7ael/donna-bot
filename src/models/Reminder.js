// src/models/Reminder.js
import mongoose from "mongoose";

const ReminderSchema = new mongoose.Schema({
  from: { type: String, required: true },
  text: { type: String, required: true },
  date: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now }
});

const Reminder = mongoose.model("Reminder", ReminderSchema);

export default Reminder;
