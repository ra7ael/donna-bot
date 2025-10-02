// src/services/gptService.js

import axios from "axios";
import fs from "fs";
import path from "path";
import Conversation from "../models/Conversation.js";
import dotenv from "dotenv";
dotenv.config();

// Lista de números autorizados
export const authorizedNumbers = ["554195194485"];

// ---------------- Cache ----------------
const cache = new Map();
export function getCached(prompt) { return cache.get(prompt); }
export function setCached(prompt, resposta) { cache.set(prompt, resposta); }

// ---------------- Dataset ----------------
const datasetPath = path.join(new URL('../dataset/dataset.jsonl', import.meta.url).pathname);
const dataset = fs.readFileSync(datasetPath, "utf8")
  .split("\n")
  .filter(Boolean)
  .map(line => JSON.parse(line));

export function buscarRespostaDataset(mensagem) {
  for (const entry of dataset) {
    const userMsg = entry.messages.find(m => m.role === "user");
    if (userMsg && mensagem.toLowerCase().includes(userMsg.content.toLowerCase())) {
      const assistantMsg = entry.messages.find(m => m.role === "assistant");
      return assistantMsg ? assistantMsg.content : null;
    }
  }
  return null;
}

// ---------------- Modelo Econômico ----------------
const economicalModel = "gpt-4o-mini"; // ou gpt-3.5-turbo
const MAX_TOKENS = 300;
const TEMPERATURE = 0.7;

// ---------------- Função principal ----------------
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

    const datasetAnswer = buscarRespostaDataset(userContent);
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

