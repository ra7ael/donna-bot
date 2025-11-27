import cron from "node-cron";
import { DateTime } from "luxon";

export function startReminderCron(db, sendMessage) {
  console.log("⏰ Cron de lembretes iniciado...");

  cron.schedule("* * * * *", async () => {
    if (!db) {
      console.log("❌ Mongo não conectado. Aguardando...");
      return;
    }

    try {
      const now = DateTime.now()
        .setZone("America/Sao_Paulo")
        .startOf("minute")
        .toJSDate();

      const windowAgo = DateTime.now()
        .setZone("America/Sao_Paulo")
        .minus({ minutes: 5 })
        .startOf("minute")
        .toJSDate();

      const formatted = DateTime.fromJSDate(now, { zone: "America/Sao_Paulo" })
        .toFormat("yyyy-MM-dd HH:mm");

      console.log(`🔍 Buscando lembretes para o minuto: ${formatted}`);

      const reminders = await db.collection("lembretes")
        .find({
          horario: { $gte: windowAgo, $lte: now },
          sent: false
        })
        .toArray();

      if (reminders.length === 0) {
        console.log("🔹 Nenhum lembrete pendente encontrado.");
        return;
      }

      for (const r of reminders) {
        console.log(`🔔 Enviando lembrete para ${r.numero}: ${r.titulo}`);

        await sendMessage(
          r.numero,
          `⏰ Lembrete: ${r.titulo} às ${r.hora}`
        );

        await db.collection("lembretes").updateOne(
          { _id: r._id },
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
  ).startOf("minute");

  if (!horario.isValid) {
    throw new Error("Data ou hora inválida.");
  }

  await db.collection("lembretes").insertOne({
    numero,
    titulo,
    descricao: titulo,
    data,
    hora,
    horario: horario.toJSDate(),
    sent: false,
    criadoEm: new Date()
  });

  console.log(`✅ Lembrete agendado: ${data} ${hora} -> ${numero}`);
}
