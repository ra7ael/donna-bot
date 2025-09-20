import cron from "node-cron";
import mongoose from "mongoose";
import axios from "axios";
import Reminder from "../models/Reminder.js";

export function startReminderCron() {
  cron.schedule("* * * * *", async () => {
    if (mongoose.connection.readyState !== 1) return; // só roda se conectado
    try {
      const now = new Date();
      const reminders = await Reminder.find({ date: { $lte: now } });
      for (const r of reminders) {
        try {
          await axios.post(
            `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_ID}/messages`,
            { messaging_product: "whatsapp", to: r.from, text: { body: `⏰ Lembrete: ${r.text}` } },
            { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
          );
          await Reminder.findByIdAndDelete(r._id);
        } catch (e) {
          console.error("Erro enviando lembrete:", e.message);
        }
      }
    } catch (err) {
      console.error("Erro no cron de lembretes:", err.message);
    }
  });
}
