// src/cron/reminders.js
import cron from "node-cron";
import { DateTime } from "luxon";
import { numerosAutorizados } from "../config/autorizados.js";

export function startReminderCron(db, sendMessage) {
  cron.schedule("* * * * *", async () => {
    try {
      if (!db) {
        console.log("❌ Mongo não conectado. Cron aguardando...");
        return;
      }

      const today = DateTime.now().toFormat("yyyy-MM-dd");
      const reminders = await db.collection("donna")
        .find({ data: today, sent: false })
        .toArray();

      for (const reminder of reminders) {
        if (!numerosAutorizados.includes(reminder.numero)) {
          console.log(`⚠️ Ignorando número não autorizado: ${reminder.numero}`);
          continue;
        }

        await sendMessage(reminder.numero, `🔔 Lembrete: ${reminder.titulo}`);

        await db.collection("donna").updateOne(
          { _id: reminder._id },
          { $set: { sent: true } }
        );

        console.log(`✅ Lembrete enviado para ${reminder.numero}: ${reminder.titulo}`);
      }
    } catch (err) {
      console.error("❌ Erro no cron de lembretes:", err);
    }
  });

  console.log("⏰ Cron de lembretes iniciado...");
}
