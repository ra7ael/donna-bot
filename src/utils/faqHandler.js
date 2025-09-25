// utils/faqHandler.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { askGPT } from '../server.js';

// Corrige __dirname em ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carrega JSONs
const geralFAQ = JSON.parse(fs.readFileSync(path.join(__dirname, '../faq/geral.json'), 'utf8'));
const rhFAQ = JSON.parse(fs.readFileSync(path.join(__dirname, '../faq/rh.json'), 'utf8'));
const empresasJSON = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/empresa.json'), 'utf8'));

const allFAQ = { ...geralFAQ, ...rhFAQ };

// Palavras-chave do menu
const MENU_KEYS = ["EMPRESA", "BANCO", "PAGAMENTO", "BENEFICIOS", "FOLHA PONTO", "HOLERITE"];

/**
 * Função principal para responder FAQ ou buscar dados de empresa
 * @param {string} userInput - entrada do usuário (ex: "PAGAMENTO", "EMPRESA", ou nome da empresa)
 * @param {string} lastKey - última palavra-chave digitada pelo usuário (para controlar contexto)
 * @param {string} userName - nome do usuário
 */
export async function responderFAQ(userInput, lastKey = "", userName = "") {
  const inputNormalized = userInput.toUpperCase().trim();

  // Se for uma palavra-chave do menu
  if (MENU_KEYS.includes(inputNormalized)) {
    return {
      tipo: "MENU",
      key: inputNormalized,
      resposta: `Você escolheu "${inputNormalized}". Por favor, digite o NOME da empresa que deseja consultar.`
    };
  }

  // Se a última interação foi uma palavra-chave relacionada a empresas/pagamento/benefícios
  if (["EMPRESA", "PAGAMENTO", "FOLHA PONTO"].includes(lastKey)) {
    const empresa = empresasJSON.find(e =>
      e.nome.toUpperCase() === inputNormalized
    );
    if (!empresa) {
      return {
        tipo: "ERRO",
        resposta: `Desculpe, não encontrei informações da empresa "${userInput}". Verifique o nome e tente novamente.`
      };
    }

    const resposta = `
Nome: ${empresa.nome}
Data de fechamento do ponto: ${empresa.fechamento_do_ponto || ""}
Método do ponto: ${empresa.metodo_ponto || ""}
Data de pagamento: ${empresa.data_de_pagamento || ""}
Data de adiantamento: ${empresa.data_adiantamento || ""}
    `.trim();

    // Humaniza com GPT
    try {
      const humanized = await askGPT(`
Você é uma assistente simpática. Responda de forma amigável e clara, 
como se estivesse falando diretamente com o usuário${userName ? ` chamado ${userName}` : ""}.
Use apenas estas informações: "${resposta}".
      `);
      return {
        tipo: "EMPRESA",
        key: lastKey,
        resposta: humanized
      };
    } catch (err) {
      console.error("❌ Erro ao humanizar resposta da empresa:", err);
      return {
        tipo: "EMPRESA",
        key: lastKey,
        resposta
      };
    }
  }

  // Para respostas normais de FAQ
  const questionKey = userInput.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  let answer = Object.entries(allFAQ).find(([key, _]) =>
    questionKey.includes(key.toLowerCase())
  )?.[1];

  if (!answer) return { tipo: "ERRO", resposta: null };

  try {
    const humanized = await askGPT(`
Você é uma assistente simpática. Responda de forma amigável, curta e clara, 
como se estivesse falando diretamente com o usuário${userName ? ` chamado ${userName}` : ""}.
Não invente informações, use apenas esta resposta: "${answer}".
    `);
    return { tipo: "FAQ", resposta: humanized };
  } catch (err) {
    console.error("❌ Erro ao humanizar FAQ:", err);
    return { tipo: "FAQ", resposta: answer };
  }
}
