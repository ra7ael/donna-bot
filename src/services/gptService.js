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
// Aumentamos para 1500 para suportar os relatórios de pesquisa profunda
const MAX_TOKENS = 1500; 
const TEMPERATURE = 0.7;

export async function getGPTResponse(messages) {
  try {
    const userMessage = messages.find(m => m.role === "user")?.content || "";
    
    // Cache é bom, mas para pesquisas em tempo real, melhor desativar 
    // ou garantir que a query seja única.
    const cached = getCached(userMessage);
    if (cached) return cached;

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      { 
        model: economicalModel, 
        messages, 
        max_tokens: MAX_TOKENS, 
        temperature: TEMPERATURE 
      },
      { 
        headers: { 
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 
          "Content-Type": "application/json" 
        }, 
        timeout: 25000 // Aumentei o timeout porque pesquisa web demora mais
      }
    );

    const answer = response.data.choices?.[0]?.message?.content?.trim() || "Desculpe, não consegui gerar uma resposta.";
    
    // REMOVIDO O SLICE(0, 150): Agora a Amber pode falar textos longos e profissionais
    setCached(userMessage, answer);
    return answer;

  } catch (modelError) {
    console.error("⚠️ Erro GPT:", modelError.message || modelError);
    return "Tive um soluço mental ao processar esses dados. Pode repetir, Rafael?";
  }
}
