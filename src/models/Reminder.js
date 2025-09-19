// src/models/Reminder.js
import mongoose from "mongoose";
import axios from "axios";
import cron from "node-cron";

const ReminderSchema = new mongoose.Schema({
  from: { type: String, required: true },
  text: { type: String, required: true },
  date: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now }
});

const Reminder = mongoose.model("Reminder", ReminderSchema);

// ===== Cron job para verificar lembretes a cada minuto =====
cron.schedule("* * * * *", async () => {
  try {
    const now = new Date();
    const reminders = await Reminder.find({ date: { $lte: now } });

    for (const r of reminders) {
      // Enviar WhatsApp
      if (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID) {
        try {
          await axios.post(
            `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_ID}/messages`,
            {
              messaging_product: "whatsapp",
              to: r.from,
              text: { body: `⏰ Lembrete: ${r.text} (agendado para ${r.date.toLocaleString("pt-BR")})` }
            },
            { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } }
          );
          console.log(`✅ Lembrete enviado para ${r.from}: ${r.text}`);
        } catch (err) {
          console.error("❌ Erro ao enviar lembrete WhatsApp:", err.response?.data || err.message);
        }
      }
      // Remover lembrete enviado
      await Reminder.findByIdAndDelete(r._id);
    }
  } catch (err) {
    console.error("❌ Erro no cron job de lembretes:", err);
  }
});

export default Reminder;
