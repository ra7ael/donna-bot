// src/cron/reminders.js
import cron from "node-cron";
import { DateTime } from "luxon";
import { numerosAutorizados } from "../config/autorizados.js";
import { sendMessage } from "../server.js"; // importa a função de envio

export function startReminderCron(db) {
  // Roda a cada minuto (você pode ajustar)
  cron.schedule("* * * * *", async () => {
    try {
      if (!db) {
        console.log("❌ Mongo não conectado. Cron aguardando...");
        return;
      }

      const today = DateTime.now().toFormat("yyyy-MM-dd");

      // Pega lembretes não enviados para hoje
      const reminders = await db.collection("donna")
        .find({ data: today, sent: false })
        .toArray();

      for (const reminder of reminders) {
        // Ignora números não autorizados
        if (!numerosAutorizados.includes(reminder.numero)) {
          console.log(`⚠️ Ignorando número não autorizado: ${reminder.numero}`);
          continue;
        }

        // Envia a mensagem
        await sendMessage(reminder.numero, `🔔 Lembrete: ${reminder.titulo}`);

        // Marca como enviado
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
