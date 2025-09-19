// src/controllers/chatController.js
import { getGPTResponse } from "../services/gptService.js";
import { salvarMemoria, buscarMemoria } from "../utils/memoryManager.js";
import Conversation from "../models/Conversation.js";
import Reminder from "../models/Reminder.js";
import axios from "axios";
import fs from "fs";
import FormData from "form-data";
import { DateTime } from "luxon";

// Lista de números autorizados
const authorizedNumbers = ["554195194485"];

export async function chat(req, res) {
  try {
    const { userId, mensagem, phoneNumber, audioId, imageId, whatsappToken, phoneId } = req.body;

    // Verifica se o usuário é autorizado
    if (phoneNumber && !authorizedNumbers.includes(phoneNumber)) {
      console.log(`❌ Usuário não autorizado: ${phoneNumber}`);
      return res.status(403).json({ erro: "Usuário não autorizado" });
    }

    let userMessage = mensagem || "";
    let mediaUrl = null;

    // ===== Processar áudio =====
    if (audioId) {
      try {
        const mediaRes = await axios.get(
          `https://graph.facebook.com/v21.0/${audioId}`,
          { headers: { Authorization: `Bearer ${whatsappToken}` } }
        );
        mediaUrl = mediaRes.data.url;
        const audioRes = await axios.get(mediaUrl, { responseType: 'arraybuffer', headers: { Authorization: `Bearer ${whatsappToken}` } });
        fs.writeFileSync("/tmp/audio.ogg", audioRes.data);

        const form = new FormData();
        form.append("file", fs.createReadStream("/tmp/audio.ogg"));
        form.append("model", "whisper-1");

        const whisperRes = await axios.post("https://api.openai.com/v1/audio/transcriptions", form, {
          headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, ...form.getHeaders() }
        });

        userMessage = whisperRes.data?.text || "";
        console.log("🎙️ Transcrição de áudio:", userMessage);
      } catch (err) {
        console.error("❌ Erro no processamento de áudio:", err.response?.data || err.message);
        userMessage = "❌ Não consegui processar seu áudio. Por favor, envie como texto.";
      } finally {
        try { fs.unlinkSync("/tmp/audio.ogg"); } catch(e) {}
      }
    }

    // ===== Processar imagem =====
    if (imageId) {
      try {
        const mediaRes = await axios.get(
          `https://graph.facebook.com/v21.0/${imageId}`,
          { headers: { Authorization: `Bearer ${whatsappToken}` } }
        );
        mediaUrl = mediaRes.data.url;
        userMessage = "📷 Imagem recebida. Analisando...";
      } catch (err) {
        console.error("❌ Erro no processamento de imagem:", err.response?.data || err.message);
        userMessage = "❌ Não consegui processar sua imagem.";
      }
    }

    // ===== Comando de lembrete =====
    const lembreteRegex = /lembre-me de (.+) (em|às|para) (.+)/i;
    let responseText = "";

    if (lembreteRegex.test(userMessage)) {
      const match = userMessage.match(lembreteRegex);
      const texto = match[1];
      const dateStr = match[3];
      const date = new Date(dateStr);

      if (isNaN(date)) {
        responseText = "❌ Não consegui entender a data/hora do lembrete. Use formato: 'Lembre-me de reunião em 2025-09-18 14:00'";
      } else {
        await Reminder.create({ from: userId, text: texto, date });
        responseText = `✅ Lembrete salvo: "${texto}" para ${date.toLocaleString('pt-BR')}`;
      }
    } else {
      // ===== Histórico e memória =====
      await Conversation.create({ from: userId, role: 'user', content: userMessage });
      await salvarMemoria(userId, { ultimaMensagem: userMessage });

      const history = await Conversation.find({ from: userId }).sort({ createdAt: 1 });
      const conversationContext = history.map(h => `${h.role === 'user' ? 'Usuário' : 'Assistente'}: ${h.content}`).join("\n");
      const memoria = await buscarMemoria(userId);
      const memoryContext = memoria ? JSON.stringify(memoria.memoria || {}) : "";

      // ===== Resposta GPT =====
      responseText = await getGPTResponse(
        `
Mensagem do usuário: "${userMessage}"

Histórico recente:
${conversationContext}

Histórico de memória relevante:
${memoryContext}
        `,
        mediaUrl,
        userId,
        phoneNumber
      );
    }

    // ===== Salvar resposta e memória =====
    await Conversation.create({ from: userId, role: 'assistant', content: responseText });
    await salvarMemoria(userId, { ultimaResposta: responseText });

    return res.json({ resposta: responseText });

  } catch (error) {
    console.error("❌ Erro no chatController:", error.response?.data || error.message || error);
    return res.status(500).json({ erro: "Erro no chat" });
  }
}
