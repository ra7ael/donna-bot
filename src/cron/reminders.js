// src/cron/reminders.js
import cron from "node-cron";
import mongoose from "mongoose";
import Reminder from "../models/Reminder.js";
import axios from "axios";

// ===== Função para enviar lembrete WhatsApp =====
async function sendWhatsAppReminder(reminder) {
  if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_ID) return;

  try {
    await axios.post(
      `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: reminder.from,
        text: {
          body: `⏰ Lembrete: ${reminder.text} (agendado para ${reminder.date.toLocaleString(
            "pt-BR"
          )})`
        }
      },
      { 
        headers: { 
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 
          "Content-Type": "application/json" 
        } 
      }
    );
    console.log(`✅ Lembrete enviado para ${reminder.from}: ${reminder.text}`);
  } catch (err) {
    console.error("❌ Erro ao enviar lembrete WhatsApp:", err.response?.data || err.message);
  }
}

// ===== Exportar função para rodar cron =====
export function startReminderCron() {
  // roda a cada minuto
  cron.schedule("* * * * *", async () => {
    try {
      if (mongoose.connection.readyState !== 1) {
        console.log("❌ Mongo não conectado. Cron aguardando...");
        return;
      }

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

  console.log("⏰ Cron de lembretes iniciado...");
}
