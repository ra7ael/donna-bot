// src/cron/reminders.js
import cron from "node-cron";
import mongoose from "mongoose";
import axios from "axios";
import { DateTime } from "luxon";

// ===== Função para enviar lembrete WhatsApp =====
async function sendWhatsAppReminder(reminder) {
  if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_ID) return;

  try {
    await axios.post(
      `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: reminder.numero,
        text: {
          body: `⏰ Lembrete: ${reminder.titulo} (agendado para ${reminder.data} ${reminder.hora})`,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log(`✅ Lembrete enviado para ${reminder.numero}: "${reminder.titulo}"`);
  } catch (err) {
    console.error("❌ Erro ao enviar lembrete WhatsApp:", err.response?.data || err.message);
  }
}

// ===== Cron para verificar lembretes a cada minuto =====
export function startReminderCron() {
  cron.schedule("* * * * *", async () => {
    try {
      if (mongoose.connection.readyState !== 1) {
        console.log("❌ Mongo não conectado. Cron aguardando...");
        return;
      }

      const now = DateTime.now().setZone("America/Sao_Paulo");
      const today = now.toFormat("yyyy-MM-dd");
      const currentTime = now.toFormat("HH:mm");

      // Busca lembretes na coleção 'donna' que ainda não foram enviados e já passaram do horário
      const events = await mongoose.connection.db.collection("donna").find({
        data: today,
        hora: { $lte: currentTime },
        sent: false
      }).toArray();

      for (const ev of events) {
        await sendWhatsAppReminder(ev);
        await mongoose.connection.db.collection("donna").updateOne(
          { _id: ev._id },
          { $set: { sent: true } }
        );
      }
    } catch (err) {
      console.error("❌ Erro no cron de lembretes:", err);
    }
  });

  console.log("⏰ Cron de lembretes iniciado...");
}
