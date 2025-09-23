// src/cron/reminders.js
import cron from "node-cron";
import { DateTime } from "luxon";
import { MongoClient } from "mongodb";
import axios from "axios";

const MONGO_URI = process.env.MONGO_URI;
let db;

// Conecta ao Mongo
async function connectDB() {
  const client = await MongoClient.connect(MONGO_URI, { useUnifiedTopology: true });
  db = client.db();
}
connectDB();

// Envia lembrete WhatsApp
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

// Cron que roda a cada minuto
export function startReminderCron() {
  cron.schedule("* * * * *", async () => {
    try {
      if (!db) return;

      const now = DateTime.now().setZone("America/Sao_Paulo");
      const today = now.toFormat("yyyy-MM-dd");
      const currentTime = now.toFormat("HH:mm");

      // Busca lembretes de hoje que ainda não foram enviados e que já passaram do horário
      const events = await db.collection("agenda").find({
        data: today,
        hora: { $lte: currentTime },
        sent: false
      }).toArray();

      for (const ev of events) {
        await sendWhatsAppReminder(ev);
        await db.collection("agenda").updateOne({ _id: ev._id }, { $set: { sent: true } });
      }
    } catch (err) {
      console.error("❌ Erro no cron de lembretes:", err);
    }
  });

  console.log("⏰ Cron de lembretes iniciado...");
}
