import cron from "node-cron";
import { DateTime } from "luxon";

export function startReminderCron(db, sendMessage) {
  console.log("⏰ Cron de lembretes iniciado...");

  // Roda a cada minuto
  cron.schedule("* * * * *", async () => {
    if (!db) {
      console.log("❌ Mongo não conectado. Aguardando...");
      return;
    }

    try {
      const now = DateTime.now().setZone("America/Sao_Paulo").startOf("minute");
      const oneMinuteAgo = now.minus({ minutes: 1 }).toJSDate();
      const nowDate = now.toJSDate();

      console.log(`⏰ Buscando lembretes com horário == ${now.toFormat("yyyy-MM-dd HH:mm")}`);

      const reminders = await db.collection("lembretes").find({
        horario: { $gte: oneMinuteAgo, $lte: nowDate },
        sent: false
      }).toArray();

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
      console.error("❌ Erro no cron:", err);
    }
  });
}

export async function addReminder(db, numero, titulo, data, hora) {
  if (!db || !numero || !titulo || !data || !hora) {
    throw new Error("Campos obrigatórios faltando.");
  }

  const horario = DateTime.fromFormat(
    `${data} ${hora}`,
    "yyyy-MM-dd HH:mm",
    { zone: "America/Sao_Paulo" }
  ).startOf("minute").toJSDate();

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

  console.log(`✅ Lembrete agendado: ${data} ${hora} -> ${numero}`);
}
