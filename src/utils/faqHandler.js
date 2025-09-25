// utils/faqHandler.js
import fs from 'fs';
import path from 'path';
import { askGPT } from '../server.js'; // já exportaremos essa função do server

// Corrige os caminhos relativos dos JSONs
const geralFAQ = JSON.parse(fs.readFileSync(path.resolve('faq/geral.json'), 'utf8'));
const rhFAQ = JSON.parse(fs.readFileSync(path.resolve('faq/rh.json'), 'utf8'));

// Junta todos os FAQs
const allFAQ = { ...geralFAQ, ...rhFAQ };

// Função que busca resposta do FAQ e humaniza
export async function responderFAQ(userQuestion, userName = "") {
  // Normaliza a pergunta (sem acento, minúscula)
  const questionKey = userQuestion
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // Procura correspondência exata ou próxima no FAQ
  let answer = Object.entries(allFAQ).find(([key, _]) =>
    questionKey.includes(key.toLowerCase())
  )?.[1];

  if (!answer) {
    // Se não achar, resposta padrão
    return "❓ Só consigo responder perguntas do FAQ (benefícios, férias, folha, horário, endereço, contato).";
  }

  // Humaniza a resposta usando GPT
  const prompt = `
Você é uma assistente simpática. Responda de forma amigável, curta e clara, 
como se estivesse falando diretamente com o usuário${userName ? ` chamado ${userName}` : ""}.
Não invente informações, use apenas esta resposta: "${answer}".
`;

  try {
    const humanized = await askGPT(prompt);
    return humanized;
  } catch (err) {
    console.error("❌ Erro ao humanizar FAQ:", err);
    return answer; // fallback
  }
}

