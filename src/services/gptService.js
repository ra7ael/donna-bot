// src/services/gptService.js
const axios = require("axios");
require("dotenv").config();
const Conversation = require("../models/Conversation");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const FINE_TUNED_MODEL_ID = process.env.FINE_TUNED_MODEL_ID || "ft:gpt-4o-mini-2024-07-18:personal:donna-assistentepessoal:CGdyamnQ";
const FALLBACK_MODEL = "gpt-4o-mini";

// Função principal
async function getGPTResponse(userMessage, imageUrl = null, userId) {
  try {
    // 1️⃣ Buscar histórico
    const history = await Conversation.find({ from: userId }).sort({ createdAt: 1 });

    const messages = [
      {
        role: "system",
        content: `
Você é Donna, assistente executiva perspicaz, elegante e humanizada.
- Ajuda em administração, legislação, RH e negócios.
- Poliglota: responda no idioma da mensagem do usuário.
- Dá dicas estratégicas e conselhos.
- Ajuda com lembretes e compromissos.
- Responde de forma natural, personalizada e com humor ou empatia.
        `,
      },
    ];

    history.forEach(h => {
      messages.push({
        role: h.role === "assistant" ? "assistant" : "user",
        content: h.content,
      });
    });

    let userContent = userMessage || "";
    if (imageUrl) userContent += `\n📷 Imagem recebida: ${imageUrl}`;
    messages.push({ role: "user", content: userContent });

    console.log("📌 Mensagens a serem enviadas:", JSON.stringify(messages, null, 2));

    // 2️⃣ Verificar se o modelo fine-tuned existe/está ativo
    try {
      const modelCheck = await axios.get(
        `https://api.openai.com/v1/models/${FINE_TUNED_MODEL_ID}`,
        { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
      );
      console.log("✅ Modelo fine-tuned encontrado:", modelCheck.data.id);
    } catch (checkError) {
      console.warn(`⚠️ Modelo fine-tuned não encontrado ou indisponível: ${FINE_TUNED_MODEL_ID}`);
      console.warn("⚠️ Fallback será usado automaticamente.");
    }

    // 3️⃣ Chamada ao fine-tuned
    try {
      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        { model: FINE_TUNED_MODEL_ID, messages, max_tokens: 500, temperature: 0.8 },
        { headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" } }
      );

      const content = response.data.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error("Resposta vazia do modelo fine-tuned");
      console.log("✅ Resposta obtida do fine-tuned");
      return content;

    } catch (ftError) {
      console.error("⚠️ Erro no fine-tuned:", ftError.response?.data || ftError.message);

      // 4️⃣ Fallback automático
      try {
        console.log("📌 Tentando fallback:", FALLBACK_MODEL);
        const fallbackResponse = await axios.post(
          "https://api.openai.com/v1/chat/completions",
          { model: FALLBACK_MODEL, messages, max_tokens: 500, temperature: 0.8 },
          { headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" } }
        );

        const fallbackContent = fallbackResponse.data.choices?.[0]?.message?.content?.trim();
        if (!fallbackContent) throw new Error("Resposta vazia do fallback");
        console.log("✅ Resposta obtida do fallback");
        return fallbackContent;

      } catch (fallbackError) {
        console.error("❌ Erro no fallback:", fallbackError.response?.data || fallbackError.message);
        return "❌ Não consegui gerar resposta com os modelos disponíveis.";
      }
    }

  } catch (error) {
    console.error("❌ Erro geral em getGPTResponse:", error.response?.data || error.message);
    return "❌ Tive um problema ao processar sua mensagem.";
  }
}

module.exports = { getGPTResponse };
