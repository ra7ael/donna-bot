import axios from "axios";
import Conversation from "../models/Conversation.js";
import dotenv from "dotenv";
dotenv.config();

let dbInstance;

export function setDB(db) {
  dbInstance = db;
}

export const authorizedNumbers = ["554195194485"];

const cache = new Map();
export function getCached(prompt) { return cache.get(prompt); }
export function setCached(prompt, resposta) { cache.set(prompt, resposta); }

const economicalModel = "gpt-4o-mini";
const MAX_TOKENS = 300;
const TEMPERATURE = 0.7;

export async function getGPTResponse(userMessage, imageUrl = null, userId, phoneNumber) {
  if (phoneNumber && !authorizedNumbers.includes(phoneNumber)) {
    console.log(`❌ Usuário não autorizado: ${phoneNumber}`);
    return "Desculpe, você não está autorizado a usar este serviço.";
  }

  try {
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
      messages.push({ role: h.role === "assistant" ? "assistant" : "user", content: h.content });
    });

    let userContent = userMessage || "";
    if (imageUrl) userContent += `\n📷 Imagem recebida: ${imageUrl}`;
    messages.push({ role: "user", content: userContent });

    const cached = getCached(userContent);
    if (cached) return cached;

    const datasetAnswer = null; // aqui você pode chamar datasetService.buscarRespostaDataset(userContent)
    if (datasetAnswer) {
      setCached(userContent, datasetAnswer);
      return datasetAnswer;
    }

    try {
      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        { model: economicalModel, messages, max_tokens: MAX_TOKENS, temperature: TEMPERATURE },
        { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" }, timeout: 10000 }
      );

      const answer = response.data.choices?.[0]?.message?.content?.trim() || "Desculpe, não consegui gerar uma resposta.";
      const limitedAnswer = answer.length > 150 ? answer.slice(0, 150) : answer;
      setCached(userContent, limitedAnswer);
      return limitedAnswer;

    } catch (modelError) {
      console.error("⚠️ Erro GPT econômico:", modelError.message || modelError);
      const fallbackAnswer = "Desculpe, não consegui responder agora. Tente novamente mais tarde.";
      setCached(userContent, fallbackAnswer);
      return fallbackAnswer;
    }

  } catch (error) {
    console.error("❌ Erro geral no GPT:", error.message || error);
    return "Desculpe, tive um problema para responder agora.";
  }
}

