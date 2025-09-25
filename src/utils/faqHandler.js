// utils/faqHandler.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { askGPT } from '../server.js';

// Corrige __dirname em ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Caminhos corretos para os JSONs
const geralFAQ = JSON.parse(fs.readFileSync(path.join(__dirname, '../faq/geral.json'), 'utf8'));
const rhFAQ = JSON.parse(fs.readFileSync(path.join(__dirname, '../faq/rh.json'), 'utf8'));

const allFAQ = { ...geralFAQ, ...rhFAQ };

// Função que busca resposta do FAQ e humaniza
export async function responderFAQ(userQuestion, userName = "") {
  const questionKey = userQuestion.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  let answer = Object.entries(allFAQ).find(([key, _]) =>
    questionKey.includes(key.toLowerCase())
  )?.[1];

  if (!answer) {
    return "❓ Só consigo responder perguntas do FAQ (benefícios, férias, folha, horário, endereço, contato).";
  }

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
    return answer;
  }
}
