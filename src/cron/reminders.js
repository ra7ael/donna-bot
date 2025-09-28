// src/cron/reminders.js
import cron from "node-cron";

/**
 * Inicia o cron de lembretes
 * @param {import('mongodb').Db} db - instância do MongoDB
 * @param {Function} sendMessage - função para enviar WhatsApp
 */
export function startReminderCron(db, sendMessage) {
  console.log("⏰ Cron de lembretes iniciado...");

  // Executa a cada minuto (ajuste conforme necessário)
  cron.schedule("* * * * *", async () => {
    if (!db) {
      console.log("❌ Mongo não conectado. Cron aguardando...");
      return;
    }

    try {
      const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
      const reminders = await db
        .collection("donna")
        .find({ data: today, sent: false })
        .toArray();

      for (const reminder of reminders) {
        const { numero, titulo, hora } = reminder;
        await sendMessage(numero, `⏰ Lembrete: ${titulo} às ${hora}`);
        await db.collection("donna").updateOne(
          { _id: reminder._id },
          { $set: { sent: true } }
        );
      }
    } catch (err) {
      console.error("❌ Erro no cron:", err.message);
    }
  });
}
