const axios = require("axios");
require("dotenv").config();

const Conversation = require("../models/Conversation");

// Lista de números autorizados (se quiser reforçar controle)
const authorizedNumbers = ["554195194485"];

async function getGPTResponse(userMessage, imageUrl = null, userId, phoneNumber) {
  // Verifica se o número é autorizado
  if (phoneNumber && !authorizedNumbers.includes(phoneNumber)) {
    console.log(`❌ Usuário não autorizado: ${phoneNumber}`);
    return "Desculpe, você não está autorizado a usar este serviço.";
  }

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

    // Adiciona histórico do usuário e assistente
    history.forEach(h => {
      messages.push({
        role: h.role === "assistant" ? "assistant" : "user",
        content: h.content,
      });
    });

    // Adiciona nova mensagem do usuário
    let userContent = userMessage || "";
    if (imageUrl) userContent += `\n📷 Imagem recebida: ${imageUrl}`;
    messages.push({ role: "user", content: userContent });

    // Modelos
    const fineTuneModel = process.env.FINE_TUNED_MODEL_ID || "ft:gpt-4o-mini-2024-07-18:personal:donna-assistentepessoal:CGdyamnQ";
    const fallbackModel = "gpt-3.5-turbo";

    try {
      // Chamada para modelo fine-tuned
      console.log("📌 Tentando modelo fine-tuned:", fineTuneModel);
      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: fineTuneModel,
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
      return content || "Desculpe, não consegui gerar uma resposta.";

    } catch (fineTuneError) {
      console.error("⚠️ Erro no fine-tune:", fineTuneError.response?.data || fineTuneError.message);

      // Fallback automático
      console.log("📌 Usando modelo fallback:", fallbackModel);
      const fallbackResponse = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: fallbackModel,
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

      const fallbackContent = fallbackResponse.data.choices?.[0]?.message?.content?.trim();
      return fallbackContent || "Desculpe, tive um problema para responder agora.";
    }

  } catch (error) {
    console.error("❌ Erro geral no GPT:", error.response?.data || error.message);
    return "Desculpe, tive um problema para responder agora.";
  }
}

module.exports = { getGPTResponse };
