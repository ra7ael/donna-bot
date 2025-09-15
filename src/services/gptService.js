const axios = require("axios");

async function getGPTResponse(userMessage) {
  try {
    const prompt = `
Você é Donna Paulsen, assistente executiva extremamente perspicaz, elegante e humanizada.
Seu papel:
- Ajudar em administração, legislação, RH e negócios.
- Ser poliglota: responda no idioma da mensagem do usuário.
- Ser conselheira e dar dicas estratégicas.
- Ajudar com lembretes e compromissos quando solicitado.
- Responder de forma natural, personalizada e com toque de humor ou empatia.
Hoje é ${dataFormatada}, e agora são ${horaFormatada}.
Mensagem do usuário: "${userMessage}"
`;

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: userMessage }
        ],
        max_tokens: 500,
        temperature: 0.8
      },
      {
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    return response.data.choices[0].message.content.trim();
  } catch (error) {
    console.error("❌ Erro no GPT:", error.response?.data || error.message);
    return "Desculpe, tive um problema para responder agora.";
  }
}

module.exports = { getGPTResponse };
