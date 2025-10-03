import cron from "node-cron";
import { DateTime } from "luxon";

/**
 * Inicia o cron de lembretes
 * @param {import('mongodb').Db} db - instância do MongoDB (banco donna)
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
      const now = DateTime.now().setZone("America/Sao_Paulo").startOf('minute');
      const nowDate = now.toJSDate();
      const nextMinute = now.plus({ minutes: 1 }).toJSDate();


      console.log(`⏰ Verificando lembretes entre ${now.toFormat("HH:mm")} e ${now.plus({ minutes: 1 }).toFormat("HH:mm")}`);

      const reminders = await db
        .collection("lembretes")
        .find({
          horario: { $gte: nowDate, $lt: nextMinute },
          sent: false
        })
        .toArray();

      if (reminders.length === 0) {
        console.log("🔹 Nenhum lembrete pendente encontrado.");
        return;
      }

      for (const reminder of reminders) {
        console.log(`🔔 Enviando lembrete para ${reminder.numero}: ${reminder.titulo}`);
        await sendMessage(
          reminder.numero,
          `⏰ Lembrete: ${reminder.titulo} às ${reminder.hora}`
        );

        await db.collection("lembretes").updateOne(
          { _id: reminder._id },
          { $set: { sent: true, enviadoEm: new Date() } }
        );
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

  const horario = DateTime.fromFormat(`${data} ${hora}`, "yyyy-MM-dd HH:mm", {
    zone: "America/Sao_Paulo"
  }).startOf('minute').toJSDate();

  await db.collection("lembretes").insertOne({
    numero,
    titulo,
    descricao: titulo,
    data,
    hora,
    horario,
    sent: false,
    criadoEm: new Date()
  });

  console.log(`✅ Lembrete adicionado para ${numero}: "${titulo}" em ${data} ${hora}`);
}
