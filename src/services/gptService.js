import axios from "axios";
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

/**
 * Recebe um array de mensagens já formatado (com system, histórico, memórias e user)
 * @param {Array} messages - array de mensagens no formato OpenAI
 * @returns {string} resposta gerada
 */
export async function getGPTResponse(messages) {
  try {
    const userMessage = messages.find(m => m.role === "user")?.content || "";
    const cached = getCached(userMessage);
    if (cached) return cached;

    const datasetAnswer = null; // aqui você pode chamar datasetService.buscarRespostaDataset(userMessage)
    if (datasetAnswer) {
      setCached(userMessage, datasetAnswer);
      return datasetAnswer;
    }

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      { model: economicalModel, messages, max_tokens: MAX_TOKENS, temperature: TEMPERATURE },
      { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" }, timeout: 10000 }
    );

    const answer = response.data.choices?.[0]?.message?.content?.trim() || "Desculpe, não consegui gerar uma resposta.";
    const limitedAnswer = answer.length > 150 ? answer.slice(0, 150) : answer;
    setCached(userMessage, limitedAnswer);
    return limitedAnswer;

  } catch (modelError) {
    console.error("⚠️ Erro GPT econômico:", modelError.message || modelError);
    const fallbackAnswer = "Desculpe, não consegui responder agora. Tente novamente mais tarde.";
    return fallbackAnswer;
  }
}

