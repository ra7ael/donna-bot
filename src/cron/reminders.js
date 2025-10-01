import cron from "node-cron";
import { DateTime } from "luxon";

/**
 * Inicia o cron de lembretes
 * @param {import('mongodb').Db} db - instância do MongoDB
 * @param {Function} sendMessage - função para enviar WhatsApp
 */
export function startReminderCron(db, sendMessage) {
  console.log("⏰ Cron de lembretes iniciado...");

  // Executa a cada minuto
  cron.schedule("* * * * *", async () => {
    if (!db) {
      console.log("❌ Mongo não conectado. Cron aguardando...");
      return;
    }

    try {
      const now = DateTime.now().setZone("America/Sao_Paulo");
      const today = now.toFormat("yyyy-MM-dd");
      const currentTime = now.toFormat("HH:mm");

      console.log(`⏰ Checando lembretes para hoje (${today}) às ${currentTime}`);

      const reminders = await db
        .collection("donna")
        .find({ data: today, sent: false })
        .toArray();

      if (reminders.length === 0) {
        console.log("🔹 Nenhum lembrete pendente encontrado.");
        return;
      }

      for (const reminder of reminders) {
        // Checa hora exata
        if (reminder.hora === currentTime) {
          console.log(`🔔 Enviando lembrete para ${reminder.numero}: ${reminder.titulo}`);
          await sendMessage(reminder.numero, `⏰ Lembrete: ${reminder.titulo} às ${reminder.hora}`);
          await db.collection("donna").updateOne(
            { _id: reminder._id },
            { $set: { sent: true, enviadoEm: new Date() } }
          );
        } else {
          console.log(`⏳ Lembrete ${reminder.titulo} ainda não é hora (${reminder.hora})`);
        }
      }
    } catch (err) {
      console.error("❌ Erro no cron:", err.message);
    }
  });
}

/**
 * Adiciona um lembrete no banco
 * @param {import('mongodb').Db} db
 * @param {string} numero
 * @param {string} titulo
 * @param {string} data - YYYY-MM-DD
 * @param {string} hora - HH:mm
 */
export async function addReminder(db, numero, titulo, data, hora) {
  if (!db || !numero || !titulo || !data || !hora) {
    throw new Error("Campos obrigatórios faltando para adicionar lembrete.");
  }

  await db.collection("donna").insertOne({
    numero,
    titulo,
    data,
    hora,
    sent: false,
    criadoEm: new Date()
  });

  console.log(`✅ Lembrete adicionado para ${numero}: "${titulo}" em ${data} ${hora}`);
}

