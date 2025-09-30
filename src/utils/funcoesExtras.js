import { DateTime } from "luxon";
import { getTodayEvents, addEvent, saveMemory, db } from "../server.js";
import { buscarPergunta } from "./buscarPdf.js";

// Funções extras diretas da Donna
export async function funcoesExtras(from, texto) {
  const textoLower = texto.toLowerCase();

  // ==== Função 1: Próximo feriado (exemplo simples) ====
  if (textoLower.includes("próximo feriado")) {
    // Aqui você pode adicionar lógica real ou API
    return "O próximo feriado é 15/11 - Proclamação da República";
  }

  // ==== Função 2: Contagem regressiva para evento ====
  if (textoLower.startsWith("quanto falta para")) {
    const match = texto.match(/quanto falta para (.+) (\d{2}\/\d{2}\/\d{4})/i);
    if (!match) return "❌ Formato inválido. Use: Quanto falta para [evento] [dd/mm/aaaa]";
    const [, evento, dataStr] = match;
    const data = DateTime.fromFormat(dataStr, "dd/MM/yyyy");
    const diff = data.diffNow("days").days;
    if (diff < 0) return `✅ O evento ${evento} já passou!`;
    return `⏳ Faltam ${Math.ceil(diff)} dias para ${evento}`;
  }

  // ==== Função 3: Resumo de PDFs por palavra-chave ====
  if (textoLower.includes("resumo pdf") || textoLower.includes("trecho pdf")) {
    const pdfTrechos = await buscarPergunta(texto);
    return pdfTrechos ? `📄 Trechos encontrados:\n${pdfTrechos}` : "❌ Não encontrei nada nos PDFs.";
  }

  return null; // não é função extra
}
