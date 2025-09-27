// src/cron/reminders.js
import cron from "node-cron";
import mongoose from "mongoose";
import axios from "axios";
import { DateTime } from "luxon";

/**
 * Inicia o cron de lembretes usando a função sendMessage do server.js
 * @param {function} sendMessage - função que envia mensagem WhatsApp
 */
export function startReminderCron(sendMessage) {
  cron.schedule("* * * * *", async () => {
    try {
      if (mongoose.connection.readyState !== 1) {
        console.log("❌ Mongo não conectado. Cron aguardando...");
        return;
      }

      const now = DateTime.now().setZone("America/Sao_Paulo");
      const today = now.toFormat("yyyy-MM-dd");
      const currentTime = now.toFormat("HH:mm");

      // Buscar lembretes ainda não enviados até a hora atual
      const reminders = await mongoose.connection.db.collection("donna").find({
        data: today,
        hora: { $lte: currentTime },
        sent: false
      }).toArray();

      if (reminders.length === 0) {
        console.log(`⏰ Nenhum lembrete para enviar às ${currentTime}`);
        return;
      }

      console.log(`⏰ Enviando ${reminders.length} lembrete(s) às ${currentTime}`);

      for (const r of reminders) {
        // Usa sendMessage do server.js (respeita histórico e logs)
        await sendMessage(r.numero, `⏰ Lembrete: ${r.titulo} (agendado para ${r.data} ${r.hora})`);

        // Marca como enviado
        await mongoose.connection.db.collection("donna").updateOne(
          { _id: r._id },
          { $set: { sent: true } }
        );

        console.log(`✅ Lembrete enviado para ${r.numero}: "${r.titulo}"`);
      }

    } catch (err) {
      console.error("❌ Erro no cron de lembretes:", err);
    }
  });

  console.log("⏰ Cron de lembretes iniciado...");
}
