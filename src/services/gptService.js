const axios = require("axios");
require("dotenv").config();

const Conversation = require("../models/Conversation"); // modelo de histórico

async function getGPTResponse(userMessage, imageUrl = null, userId) {
  try {
    // Buscar histórico do usuário
    const history = await Conversation.find({ from: userId }).sort({ createdAt: 1 });

    const messages = [
      {
        role: "system",
        content: `
Você é Donna Paulsen, assistente executiva perspicaz, elegante e humanizada.
Seu papel:
- Ajudar em administração, legislação, RH e negócios.
- Ser poliglota: responda no idioma da mensagem do usuário.
- Ser conselheira e dar dicas estratégicas.
- Ajudar com lembretes e compromissos quando solicitado.
- Responder de forma natural, personalizada e com toque de humor ou empatia.
`
      },
    ];

    // Adicionar histórico no chat
    history.forEach(h => {
      messages.push({
        role: h.role === "assistant" ? "assistant" : "user",
        content: h.content,
      });
    });

    // Nova mensagem do usuário
    if (imageUrl) {
      messages.push({
        role: "user",
        content: [
          { type: "text", text: userMessage || "Descreva a imagem ou extraia o texto dela" },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      });
    } else {
      messages.push({ role: "user", content: userMessage });
    }

    // 🔑 Modelo: Fine-tuned se existir, fallback gpt-4o-mini
    let modelId = process.env.FINE_TUNED_MODEL_ID || "gpt-4o-mini";
    modelId = modelId.replace(/\s+/g, "").trim(); // remove espaços/quebras de linha invisíveis
    console.log("📌 Modelo usado pela Donna:", `"${modelId}"`);

    // Chamada ao GPT
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

    // Retorna resposta
    return response.data.choices[0].message.content.trim();

  } catch (error) {
    console.error("❌ Erro no GPT:", error.response?.data || error.message);
    return "Desculpe, tive um problema para responder agora.";
  }
}

module.exports = { getGPTResponse };
