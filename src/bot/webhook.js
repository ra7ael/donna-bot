require('dotenv').config();
const express = require('express');
const axios = require('axios');          // ✅ necessário para chamadas HTTP
const fs = require('fs');                // ✅ necessário para manipular arquivos
const FormData = require('form-data');   // ✅ necessário para Whisper (áudio)
const router = express.Router();

const { getGPTResponse } = require('../services/gptService');
const Message = require('../models/Message');
const Reminder = require('../models/Reminder');
const Conversation = require('../models/Conversation');

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const MY_NUMBER = process.env.MY_NUMBER;// ===== POST webhook (receber mensagens) =====
router.post('/', async (req, res) => {
  try {
    const body = req.body;
    if (!body.object) return res.sendStatus(400);

    const entry = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!entry) return res.sendStatus(200);

    const from = entry.from;
    if (from !== MY_NUMBER) return res.sendStatus(200);

    let userMessage = entry.text?.body || "";
    console.log("📩 Mensagem recebida:", userMessage);

    // ===== Processar áudio =====
    if (entry.type === 'audio') {
      const mediaId = entry.audio.id;
      const mediaUrlRes = await axios.get(
        `https://graph.facebook.com/v21.0/${mediaId}`,
        { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
      );
      const mediaUrl = mediaUrlRes.data.url;

      const audioRes = await axios.get(mediaUrl, { responseType: 'arraybuffer', headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } });
      fs.writeFileSync('/tmp/audio.ogg', audioRes.data);

      const form = new FormData();
      form.append('file', fs.createReadStream('/tmp/audio.ogg'));
      form.append('model', 'whisper-1');

      const whisperRes = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, ...form.getHeaders() }
      });

      userMessage = whisperRes.data.text;
      console.log("🎙️ Transcrição de áudio:", userMessage);
      fs.unlinkSync('/tmp/audio.ogg');
    }

    // ===== Processar imagem com GPT multimodal =====
    let imageUrl = null;
    if (entry.type === 'image') {
      const mediaId = entry.image.id;
      const mediaUrlRes = await axios.get(
        `https://graph.facebook.com/v21.0/${mediaId}`,
        { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
      );
      imageUrl = mediaUrlRes.data.url;
      userMessage = "📷 Imagem recebida. Analisando...";
    }

    // ===== Salvar mensagem do usuário no histórico =====
    await Conversation.create({ from, role: 'user', content: userMessage });

    // ===== Hora e data =====
    const now = new Date();
    const currentTime = now.toLocaleTimeString('pt-BR');
    const currentDate = now.toLocaleDateString('pt-BR');

    let responseText = "";

    // ===== Lembretes =====
    const lembreteRegex = /lembre-me de (.+) (em|para|às) (.+)/i;
    if (lembreteRegex.test(userMessage)) {
      const match = userMessage.match(lembreteRegex);
      const text = match[1];
      const dateStr = match[3];
      const date = new Date(dateStr);

      if (isNaN(date)) {
        responseText = "❌ Não consegui entender a data/hora do lembrete. Use formato: 'Lembre-me de reunião em 2025-09-18 14:00'";
      } else {
        await Reminder.create({ from, text, date });
        responseText = `✅ Lembrete salvo: "${text}" para ${date.toLocaleString('pt-BR')}`;
      }
    } else {
      // ===== Recuperar histórico para contexto =====
      const history = await Conversation.find({ from }).sort({ createdAt: 1 });
      const conversationContext = history.map(h => `${h.role === 'user' ? 'Usuário' : 'Donna'}: ${h.content}`).join("\n");

      responseText = await getGPTResponse(`
Você é Donna Paulsen, assistente executiva perspicaz, elegante e humanizada.
Hora e data atuais: ${currentTime} do dia ${currentDate}.
Seu papel:
- Ajudar em administração, legislação, RH e negócios.
- Ser poliglota: responda no idioma da mensagem do usuário.
- Dar dicas estratégicas e conselhos.
- Ajudar com lembretes e compromissos.
Histórico de conversa:
${conversationContext}
Mensagem do usuário: "${userMessage}"
      `, imageUrl);
    }

    // ===== Salvar resposta da Donna no histórico =====
    await Conversation.create({ from, role: 'assistant', content: responseText });

    // ===== Salvar no MongoDB e enviar WhatsApp =====
    await Message.create({ from, body: userMessage, response: responseText });
    await sendWhatsApp(from, responseText);

    res.sendStatus(200);

  } catch (error) {
    console.error("❌ Erro no webhook:", error.response?.data || error.message);
    res.sendStatus(500);
  }
});
