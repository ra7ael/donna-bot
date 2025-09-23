// src/cron/reminders.js
import cron from "node-cron";
import mongoose from "mongoose";
import Reminder from "../models/Reminder.js";
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
        to: reminder.from,
        text: {
          body: `⏰ Lembrete: ${reminder.text} (agendado para ${DateTime.fromJSDate(reminder.date)
            .setZone("America/Sao_Paulo")
            .toFormat("dd/MM/yyyy HH:mm")})`,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log(
      `✅ Lembrete enviado para ${reminder.from}: "${reminder.text}" às ${DateTime.now()
        .setZone("America/Sao_Paulo")
        .toFormat("HH:mm:ss")}`
    );
  } catch (err) {
    console.error(
      "❌ Erro ao enviar lembrete WhatsApp:",
      err.response?.data || err.message
    );
  }
}

// ===== Função para iniciar cron de lembretes =====
export function startReminderCron() {
  // Executa a cada minuto
  cron.schedule("* * * * *", async () => {
    try {
      if (mongoose.connection.readyState !== 1) {
        console.log("❌ Mongo não conectado. Cron aguardando...");
        return;
      }

      const now = DateTime.now().setZone("America/Sao_Paulo");
      const oneMinuteAgo = now.minus({ minutes: 1 }).toJSDate();
      const nowDate = now.toJSDate();

      // Busca apenas lembretes entre um minuto atrás e agora que ainda não foram enviados
      const reminders = await Reminder.find({
        date: { $gte: oneMinuteAgo, $lte: nowDate },
        sent: { $ne: true },
      }).sort({ date: 1 }); // Ordena pelo horário do lembrete

      for (const r of reminders) {
        await sendWhatsAppReminder(r);
        // Marca como enviado
        r.sent = true;
        await r.save();
      }
    } catch (err) {
      console.error("❌ Erro no cron job de lembretes:", err);
    }
  });

  console.log("⏰ Cron de lembretes iniciado...");
}
