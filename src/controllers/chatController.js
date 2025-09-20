// src/controllers/chatController.js
import { getGPTResponse } from "../services/gptService.js";
import { salvarMemoria, buscarMemoria } from "../utils/memoryManager.js";
import { saveMemory, getRelevantMemory } from "../utils/memory.js";  // ⬅️ adicionado
import Conversation from "../models/Conversation.js";
import Reminder from "../models/Reminder.js";
import axios from "axios";
import fs from "fs";
import FormData from "form-data";

// Lista de números autorizados
const authorizedNumbers = ["554195194485"];

export async function chat(req, res) {
  try {
    const { userId, mensagem, phoneNumber, audioId, imageId, whatsappToken } = req.body;

    if (phoneNumber && !authorizedNumbers.includes(phoneNumber)) {
      console.log(`❌ Usuário não autorizado: ${phoneNumber}`);
      return res.status(403).json({ erro: "Usuário não autorizado" });
    }

    let userMessage = mensagem || "";
    let mediaUrl = null;

    // ===== ÁUDIO =====
    if (audioId) {
      try {
        const mediaRes = await axios.get(
          `https://graph.facebook.com/v21.0/${audioId}`,
          { headers: { Authorization: `Bearer ${whatsappToken}` } }
        );
        mediaUrl = mediaRes.data.url;
        const audioRes = await axios.get(mediaUrl, { responseType: "arraybuffer", headers: { Authorization: `Bearer ${whatsappToken}` } });
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
        console.error("❌ Erro no áudio:", err.response?.data || err.message);
        userMessage = "❌ Não consegui processar seu áudio. Envie como texto.";
      } finally {
        try { fs.unlinkSync("/tmp/audio.ogg"); } catch {}
      }
    }

    // ===== IMAGEM =====
    if (imageId) {
      try {
        const mediaRes = await axios.get(
          `https://graph.facebook.com/v21.0/${imageId}`,
          { headers: { Authorization: `Bearer ${whatsappToken}` } }
        );
        mediaUrl = mediaRes.data.url;
        userMessage = "📷 Imagem recebida. Analisando...";
      } catch (err) {
        console.error("❌ Erro na imagem:", err.response?.data || err.message);
        userMessage = "❌ Não consegui processar sua imagem.";
      }
    }

    // ===== LEMBRETE =====
    const lembreteRegex = /lembre-me de (.+) (em|às|para) (.+)/i;
    let responseText = "";

    if (lembreteRegex.test(userMessage)) {
      const match = userMessage.match(lembreteRegex);
      const texto = match[1];
      const dateStr = match[3];
      const date = new Date(dateStr);

      if (isNaN(date)) {
        responseText = "❌ Data/hora inválida. Exemplo: 'Lembre-me de reunião em 2025-09-18 14:00'";
      } else {
        await Reminder.create({ from: userId, text: texto, date });
        responseText = `✅ Lembrete salvo: "${texto}" para ${date.toLocaleString("pt-BR")}`;
      }
    } else {
      // ===== SALVAR CONTEXTO =====
      await Conversation.create({ from: userId, role: "user", content: userMessage });
      await salvarMemoria(userId, { ultimaMensagem: userMessage });
      await saveMemory(userId, "user", userMessage);  // ⬅️ salva embedding

      const history = await Conversation.find({ from: userId }).sort({ createdAt: 1 });
      const conversationContext = history.map(h => `${h.role === "user" ? "Usuário" : "Assistente"}: ${h.content}`).join("\n");

      const memoria = await buscarMemoria(userId);
      const memoryContext = memoria ? JSON.stringify(memoria.memoria || {}) : "";

      const relevantMemories = await getRelevantMemory(userId, userMessage, 3); // ⬅️ busca memórias relevantes
      const semanticContext = relevantMemories.map(m => `Memória: ${m.content}`).join("\n");

      // ===== GPT =====
      responseText = await getGPTResponse(
        `
Mensagem do usuário: "${userMessage}"

Histórico recente:
${conversationContext}

Histórico de memória estruturada:
${memoryContext}

Memórias relevantes:
${semanticContext}
        `,
        mediaUrl,
        userId,
        phoneNumber
      );
    }

    // ===== SALVAR RESPOSTA =====
    await Conversation.create({ from: userId, role: "assistant", content: responseText });
    await salvarMemoria(userId, { ultimaResposta: responseText });
    await saveMemory(userId, "assistant", responseText); // ⬅️ salva embedding da resposta

    return res.json({ resposta: responseText });

  } catch (error) {
    console.error("❌ Erro no chatController:", error.response?.data || error.message || error);
    return res.status(500).json({ erro: "Erro no chat" });
  }
}
