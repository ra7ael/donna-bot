// src/cron/reminders.js
import cron from "node-cron";
import mongoose from "mongoose";
import Reminder from "../models/Reminder.js";
import axios from "axios";

// função de envio
async function sendWhatsAppReminder(reminder) { /* ... */ }

// função que inicia o cron
export function startReminderCron() {
  cron.schedule("* * * * *", async () => {
    try {
      if (mongoose.connection.readyState !== 1) return;
      const now = new Date();
      const reminders = await Reminder.find({ date: { $lte: now } });

      for (const r of reminders) {
        await sendWhatsAppReminder(r);
        await Reminder.findByIdAndDelete(r._id);
      }
    } catch (err) {
      console.error("❌ Erro no cron job de lembretes:", err);
    }
  });
}
