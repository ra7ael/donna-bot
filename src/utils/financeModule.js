// src/utils/financeModule.js
import { google } from "googleapis";
import path from "path";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

// Detecta se está no Render ou Local para pegar a chave
const KEY_PATH = process.env.RENDER 
  ? "/etc/secrets/service_account.json" 
  : path.resolve("service_account.json");

const auth = new google.auth.GoogleAuth({
  keyFile: KEY_PATH,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

async function extrairDadosFinanceiros(texto) {
  const prompt = `
  Extraia os dados financeiros da frase: "${texto}"
  Retorne APENAS JSON no formato: { "item": "descrição", "valor": 00.00, "categoria": "ex: Alimentação, Transporte" }
  Exemplo de valor: se for "150 reais", retorne 150.00.
  Se não identificar um gasto claro, retorne null.
  `;

  try {
    const response = await axios.post("https://api.openai.com/v1/chat/completions", {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0
    }, { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });
    
    const content = response.data.choices[0].message.content.replace(/```json|```/g, "").trim();
    return JSON.parse(content);
  } catch { return null; }
}

export async function processarFinanceiro(texto) {
  if (!SPREADSHEET_ID) return "Erro: ID da Planilha não configurado no .env";

  const dados = await extrairDadosFinanceiros(texto);
  if (!dados || !dados.valor) return null; 

  try {
    const dataHoje = new Date().toLocaleDateString("pt-BR");
    
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "Página1!A:D", 
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[dataHoje, dados.item, dados.valor, dados.categoria]]
      },
    });

    return `💸 Anotado: ${dados.item} (R$ ${dados.valor}) em ${dados.categoria}.`;
  } catch (err) {
    console.error("Erro Sheets:", err.message);
    return "Erro ao salvar na planilha. Verifique se o e-mail do robô tem permissão de EDITOR.";
  }
}
