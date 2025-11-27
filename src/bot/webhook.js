import express from "express";
import axios from "axios";
import fs from "fs";
import FormData from "form-data";
import cron from "node-cron";
import { DateTime } from "luxon";

import { getGPTResponse } from "../services/gptService.js";
import Message from "../models/Message.js";
import Reminder from "../models/Reminder.js";
import Conversation from "../models/Conversation.js";
import { saveMemory, getRelevantMemory } from "../utils/memory.js";
import { getWeather } from "../utils/weather.js";

const router = express.Router();

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_ID;

const authorizedUsers = [process.env.MY_NUMBER.replace("+", "")];

async function sendWhatsApp(to, text) {
  if (!text?.trim()) return;
  try {
    await axios.post(
      `https://graph.facebook.com/v21.0/${PHONE_ID}/messages`,
      { messaging_product: "whatsapp", to, text: { body: text } },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
    );
    console.log("📤 enviado:", text);
  } catch (err) {
    console.error("❌ WhatsApp:", err.response?.data || err.message);
  }
}

router.get("/", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOKEN) {
    console.log("✅ Webhook OK");
    return res.status(200).send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

router.post("/", async (req, res) => {
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    if (!authorizedUsers.includes(from)) return res.sendStatus(200);

    let userMessage = "";
    let mediaUrl = null;

    if (msg.type === "text") {
      userMessage = msg.text?.body || "";
    } else if (msg.type === "audio") {
      try {
        const mediaId = msg.audio.id;
        const meta = await axios.get(`https://graph.facebook.com/v21.0/${mediaId}`, {
          headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
        });

        mediaUrl = meta.data.url;
        const audio = await axios.get(mediaUrl, { responseType: "arraybuffer" });
        fs.writeFileSync("/tmp/audio.ogg", audio.data);

        const form = new FormData();
        form.append("file", fs.createReadStream("/tmp/audio.ogg"));
        form.append("model", "whisper-1");

        const whisper = await axios.post("https://api.openai.com/v1/audio/transcriptions", form, {
          headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, ...form.getHeaders() }
        });

        userMessage = whisper.data.text || "";

      } catch {
        userMessage = "❌ Não consegui transcrever o áudio.";
      }
    } else if (msg.type === "image") {
      userMessage = "📷 Imagem recebida.";
      const mediaId = msg.image.id;
      const meta = await axios.get(`https://graph.facebook.com/v21.0/${mediaId}`, {
        headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
      });
      mediaUrl = meta.data.url;
    } else {
      await sendWhatsApp(from, "❌ Formato não suportado.");
    }

    if (!userMessage?.trim()) return res.sendStatus(200);

    await Conversation.create({ from, role: "user", content: userMessage });
    await saveMemory(from, "user", userMessage);

    const now = DateTime.now().setZone("America/Sao_Paulo");
    const currentTime = now.toFormat("HH:mm:ss");
    const currentDate = now.toFormat("dd/MM/yyyy");

    let responseText = "";

    if (/que horas são\??/i.test(userMessage)) {
      responseText = `🕒 ${currentTime}`;
    } else if (/qual a data( de hoje)?\??/i.test(userMessage)) {
      responseText = `📅 ${currentDate}`;
    } else if (/como está o tempo em (.+)/i.test(userMessage)) {
      const c = userMessage.match(/tempo em (.+)/i)?.[1];
      responseText = await getWeather(c);
    } else if (/lembre-me de (.+) em (.+) às (.+)/i.test(userMessage)) {
      const [, text, date, time] = userMessage.match(/lembre-me de (.+) em (.+) às (.+)/i);
      const horario = DateTime.fromFormat(`${date} ${time}`, "yyyy-MM-dd HH:mm", { zone: "America/Sao_Paulo" });

      if (!horario.isValid) {
        responseText = "❌ Não entendi a data/hora.";
      } else {
        await Reminder.create({ from, text, date: horario.toJSDate() });
        responseText = `✅ vou lembrar de "${text}" em ${date} às ${time}`;
      }
    } else {
      const ctx = await Conversation.find({ from }).sort({ createdAt: 1 });
      const formattedCtx = ctx.map(c => `${c.role}: ${c.content}`).join("\n");

      const mems = await getRelevantMemory(from, userMessage, 3);
      const formattedMem = mems.join("\n");

      responseText = await getGPTResponse(
        `Contexto:\n${formattedCtx}\nMemórias:\n${formattedMem}\nMensagem: "${userMessage}"`,
        mediaUrl,
        from
      );
    }

    await Conversation.create({ from, role: "assistant", content: responseText });
    await saveMemory(from, "assistant", responseText);
    await Message.create({ from, body: userMessage, response: responseText });

    await sendWhatsApp(from, responseText);
    res.sendStatus(200);

  } catch (error) {
    console.error("❌ webhook:", error.message);
    res.sendStatus(500);
  }
});

// ===== CRON ÚNICO para disparar lembretes =====
cron.schedule("* * * * *", async () => {
  const now = new Date();
  const pending = await Reminder.find({ date: { $lte: now }, triggered: false });

  if (!pending.length) {
    console.log("⏳ Nenhum lembrete agora.");
    return;
  }

  for (const r of pending) {
    await sendWhatsApp(r.from, `⏰ ${r.text}`);
    await Reminder.findByIdAndUpdate(r._id, { triggered: true });
  }
});

export default router;
