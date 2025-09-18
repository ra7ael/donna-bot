// src/services/gptService.js
const axios = require("axios");
require("dotenv").config();

const Conversation = require("../models/Conversation"); // histórico de chat

async function getGPTResponse(userMessage, imageUrl = null, userId) {
  try {
    // Buscar histórico do usuário
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

    // Adicionar histórico no chat
    history.forEach(h => {
      messages.push({
        role: h.role === "assistant" ? "assistant" : "user",
        content: h.content,
      });
    });

    // Adicionar nova mensagem do usuário
    let userContent = userMessage || "";
    if (imageUrl) {
      // Para imagens, transformamos em texto simples informando que há uma imagem
      userContent += `\n📷 Imagem recebida: ${imageUrl}`;
    }

    messages.push({ role: "user", content: userContent });

    // Modelo fine-tuned ou fallback
    let modelId = process.env.FINE_TUNED_MODEL_ID || "gpt-4o-mini";
    modelId = modelId.trim();
    console.log("📌 Modelo usado pela Donna:", `"${modelId}"`);

    // Chamada à API OpenAI
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: modelId,
        messages,
        max_tokens: 500,
        temperature: 0.8,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const content = response.data.choices?.[0]?.message?.content?.trim();

    // Garantir que sempre haja algo para retornar
    return content || "Desculpe, não consegui gerar uma resposta.";

  } catch (error) {
    console.error("❌ Erro no GPT:", error.response?.data || error.message);
    return "Desculpe, tive um problema para responder agora.";
  }
}

module.exports = { getGPTResponse };

