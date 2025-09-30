// src/utils/funcoesExtras.js
/**
 * Funções extras da Donna - 40 funções prontas
 * A Donna tenta executar essas funções antes de chamar o GPT.
 */
import { DateTime } from "luxon";
import axios from "axios";
import { getTodayEvents, addEvent, saveMemory, db } from "../server.js";
import { buscarPergunta } from "./buscarPdf.js";
import { getWeather } from "./weather.js"; // precisa existir no projeto

export async function funcoesExtras(from, texto) {
  const t = texto.toLowerCase();

  // ===== 1. Hora atual =====
  if (t.includes("horas") || t.includes("que horas")) {
    return `🕒 Agora são ${DateTime.now().toLocaleString(DateTime.TIME_24_SIMPLE)}`;
  }

  // ===== 2. Data de hoje =====
  if (t.includes("data de hoje") || t.includes("que dia é hoje")) {
    return `📅 Hoje é ${DateTime.now().toLocaleString(DateTime.DATE_FULL)}`;
  }

  // ===== 3. Clima atual =====
  if (t.includes("clima") || t.includes("temperatura")) {
    try {
      const clima = await getWeather();
      return `🌤️ O clima atual: ${clima}`;
    } catch {
      return "❌ Não consegui obter o clima no momento.";
    }
  }

  // ===== 4. Teste de funcionamento =====
  if (t.includes("teste")) return "✅ Função extra funcionando!";

  // ===== 5. Contagem regressiva simples =====
  if (t.startsWith("contagem regressiva")) {
    const match = t.match(/\d+/);
    if (match) return `⏱️ Começando contagem regressiva de ${match[0]} segundos!`;
    return "❌ Informe a quantidade de segundos, ex: 'contagem regressiva 10'";
  }

  // ===== 6. Conversão BRL -> USD =====
  if (t.includes("converta") && t.includes("brl para usd")) {
    const match = t.match(/[\d,.]+/);
    if (match) {
      const valor = parseFloat(match[0].replace(",", "."));
      const cotacao = 0.20;
      return `💰 ${valor} BRL = ${(valor * cotacao).toFixed(2)} USD`;
    }
    return "❌ Informe o valor em BRL, ex: 'converta 50 BRL para USD'";
  }

  // ===== 7. Conversão USD -> BRL =====
  if (t.includes("converta") && t.includes("usd para brl")) {
    const match = t.match(/[\d,.]+/);
    if (match) {
      const valor = parseFloat(match[0].replace(",", "."));
      const cotacao = 5.0;
      return `💰 ${valor} USD = ${(valor * cotacao).toFixed(2)} BRL`;
    }
    return "❌ Informe o valor em USD, ex: 'converta 10 USD para BRL'";
  }

  // ===== 8. Soma números =====
  if (t.startsWith("soma")) {
    const nums = t.match(/-?\d+(\.\d+)?/g);
    if (nums) return `➕ Resultado: ${nums.map(Number).reduce((a,b)=>a+b,0)}`;
    return "❌ Informe números para somar, ex: 'soma 2 3 4'";
  }

  // ===== 9. Subtração =====
  if (t.startsWith("subtraia")) {
    const nums = t.match(/-?\d+(\.\d+)?/g);
    if (nums && nums.length >= 2) return `➖ Resultado: ${nums.map(Number).reduce((a,b)=>a-b)}`;
    return "❌ Informe pelo menos 2 números, ex: 'subtraia 10 3'";
  }

  // ===== 10. Multiplicação =====
  if (t.startsWith("multiplique")) {
    const nums = t.match(/-?\d+(\.\d+)?/g);
    if (nums) return `✖️ Resultado: ${nums.map(Number).reduce((a,b)=>a*b,1)}`;
    return "❌ Informe números, ex: 'multiplique 2 3 4'";
  }

  // ===== 11. Divisão =====
  if (t.startsWith("divida")) {
    const nums = t.match(/-?\d+(\.\d+)?/g);
    if (nums && nums.length >= 2) return `➗ Resultado: ${nums.map(Number).reduce((a,b)=>a/b).toFixed(2)}`;
    return "❌ Informe pelo menos 2 números, ex: 'divida 10 2'";
  }

  // ===== 12. Número aleatório =====
  if (t.includes("número aleatório") || t.includes("numero aleatorio")) {
    const min = t.match(/min\s*(\d+)/)?.[1] || 0;
    const max = t.match(/max\s*(\d+)/)?.[1] || 100;
    const n = Math.floor(Math.random() * (max - min + 1)) + parseInt(min);
    return `🎲 Número aleatório: ${n}`;
  }

  // ===== 13. Criar lembrete (simulado) =====
  if (t.startsWith("lembrete")) {
    const msg = t.replace("lembrete", "").trim();
    if (msg) return `⏰ Lembrete criado: "${msg}" (simulação)`;
    return "❌ Informe a mensagem do lembrete, ex: 'lembrete Comprar pão às 18h'";
  }

  // ===== 14. Adicionar tarefa =====
  if (t.startsWith("adicionar tarefa") || t.startsWith("nova tarefa")) {
    const tarefa = t.replace(/adicionar tarefa|nova tarefa/, "").trim();
    if (tarefa) return `📌 Tarefa adicionada: "${tarefa}" (simulação)`;
    return "❌ Informe a tarefa, ex: 'adicionar tarefa Estudar JS'";
  }

  // ===== 15. Listar tarefas =====
  if (t.includes("minhas tarefas") || t.includes("listar tarefas")) {
    return "📋 Suas tarefas: [simulação] 1. Estudar JS 2. Revisar PDF 3. Treinar Donna";
  }

  // ===== 16. Traduzir palavra (simulação) =====
  if (t.startsWith("traduzir")) {
    const palavra = t.replace("traduzir", "").trim();
    if (palavra) return `🌐 "${palavra}" em inglês é "${palavra}-en" (simulação)`;
    return "❌ Informe a palavra, ex: 'traduzir casa'";
  }

  // ===== 17. Cotação bitcoin =====
  if (t.includes("bitcoin") || t.includes("btc")) {
    try {
      const res = await axios.get("https://api.coindesk.com/v1/bpi/currentprice.json");
      return `₿ Bitcoin: $${res.data.bpi.USD.rate}`;
    } catch {
      return "❌ Não consegui obter cotação do Bitcoin agora.";
    }
  }

  // ===== 18. Cotação dólar =====
  if (t.includes("dólar") || t.includes("dolar")) {
    try {
      const res = await axios.get("https://economia.awesomeapi.com.br/json/last/USD-BRL");
      return `💵 Dólar: R$${res.data["USDBRL"].bid}`;
    } catch {
      return "❌ Não consegui obter cotação do dólar agora.";
    }
  }

  // ===== 19. Cotação euro =====
  if (t.includes("euro")) {
    try {
      const res = await axios.get("https://economia.awesomeapi.com.br/json/last/EUR-BRL");
      return `💶 Euro: R$${res.data["EURBRL"].bid}`;
    } catch {
      return "❌ Não consegui obter cotação do euro agora.";
    }
  }

  // ===== 20. Próximo feriado =====
  if (t.includes("próximo feriado")) {
    return "O próximo feriado é 15/11 - Proclamação da República";
  }

  // ===== 21. Gerar senha aleatória =====
  if (t.includes("senha aleatória")) {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()";
    let senha = "";
    for (let i = 0; i < 12; i++) senha += chars[Math.floor(Math.random() * chars.length)];
    return `🔑 Senha gerada: ${senha}`;
  }

  // ===== 22. Contagem regressiva para evento =====
  if (t.startsWith("quanto falta para")) {
    const match = texto.match(/quanto falta para (.+) (\d{2}\/\d{2}\/\d{4})/i);
    if (!match) return "❌ Formato inválido. Use: Quanto falta para [evento] [dd/mm/aaaa]";
    const [, evento, dataStr] = match;
    const data = DateTime.fromFormat(dataStr, "dd/MM/yyyy");
    const diff = data.diffNow("days").days;
    if (diff < 0) return `✅ O evento ${evento} já passou!`;
    return `⏳ Faltam ${Math.ceil(diff)} dias para ${evento}`;
  }

  // ===== 23. Contar palavras =====
  if (t.startsWith("contar palavras")) {
    const count = t.replace("contar palavras", "").trim().split(/\s+/).filter(w => w).length;
    return `🔢 Número de palavras: ${count}`;
  }

  // ===== 24. Resumo PDFs =====
  if (t.includes("resumo pdf") || t.includes("trecho pdf")) {
    const pdfTrechos = await buscarPergunta(texto);
    return pdfTrechos ? `📄 Trechos encontrados:\n${pdfTrechos}` : "❌ Não encontrei nada nos PDFs.";
  }

  // ===== 25. Contar caracteres =====
  if (t.startsWith("contar caracteres")) {
    const count = t.replace("contar caracteres", "").trim().length;
    return `🔤 Número de caracteres: ${count}`;
  }

  // ===== 26. Calcular IMC =====
  if (t.startsWith("imc")) {
    const match = t.match(/(\d+\.?\d*)\s*(\d+\.?\d*)/);
    if (match) {
      const peso = parseFloat(match[1]);
      const altura = parseFloat(match[2]);
      const imc = peso / (altura * altura);
      return `⚖️ Seu IMC é ${imc.toFixed(2)}`;
    }
    return "❌ Informe peso e altura, ex: 'IMC 70 1.75'";
  }

  // ===== 27. Dias entre datas =====
  if (t.startsWith("dias entre")) {
    const match = t.match(/(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})/);
    if (match) {
      const d1 = DateTime.fromISO(match[1]);
      const d2 = DateTime.fromISO(match[2]);
      const diff = d2.diff(d1, "days").days;
      return `📆 Há ${Math.abs(diff)} dias entre ${match[1]} e ${match[2]}`;
    }
    return "❌ Use formato: 'dias entre 2025-09-01 2025-09-30'";
  }

  // ===== 28. Frase motivacional =====
  if (t.includes("motiva") || t.includes("frase motivacional")) {
    return "💡 Acredite em você! Cada passo pequeno te leva a grandes conquistas!";
  }

  // ===== 29. Piada rápida =====
  if (t.includes("piada")) return "😂 Por que o computador foi ao médico? Porque estava com vírus!";

  // ===== 30. Fuso horário =====
  if (t.includes("fuso horário")) return `🌍 O fuso horário atual é ${DateTime.now().offsetNameShort}`;

  // ===== 31. Dia da semana =====
  if (t.includes("dia da semana") || t.includes("que dia caiu")) return `📅 Hoje é ${DateTime.now().toFormat("cccc")}`;

  // ===== 32. Segundos desde meia-noite =====
  if (t.includes("segundos desde meia-noite")) {
    const agora = DateTime.now();
    const segundos = agora.diff(agora.startOf("day"), "seconds").seconds;
    return `⏱️ Segundos desde meia-noite: ${Math.floor(segundos)}`;
  }

  // ===== 33. Limpar memória simulada =====
  if (t.includes("limpar memória")) return "🧹 Memória limpa! (simulação)";

  // ===== 34. Próximo evento =====
  if (t.includes("próximo evento")) {
    const eventos = await getTodayEvents(from);
    return eventos.length ? `📅 Próximo evento: ${eventos[0].titulo} às ${eventos[0].hora}` : "📅 Nenhum evento encontrado.";
  }

  // ===== 35. Adicionar evento =====
  if (t.startsWith("adicionar evento")) {
    const partes = t.replace("adicionar evento", "").trim().split("|");
    if (partes.length === 3) {
      await addEvent(from, partes[0].trim(), partes[1].trim(), partes[2].trim(), "12:00");
      return `✅ Evento "${partes[0].trim()}" adicionado!`;
    }
    return "❌ Formato: adicionar evento [nome] | [descrição] | [dd/mm/aaaa]";
  }

  // ===== 36. Salvar memória =====
  if (t.startsWith("salvar memória")) {
    const info = t.replace("salvar memória", "").trim();
    await saveMemory(from, info);
    return `💾 Informação salva na memória: ${info}`;
  }

  // ===== 37. Mostrar memória simulada =====
  if (t.includes("minha memória")) return "📝 Memória: [simulação] Lembretes e notas.";

  // ===== 38. Converter temperatura Celsius ↔ Fahrenheit =====
  if (t.includes("converter temperatura")) {
    const match = t.match(/(-?\d+\.?\d*)\s*(c|f)/i);
    if (match) {
      let valor = parseFloat(match[1]);
      let tipo = match[2].toLowerCase();
      if (tipo === "c") return `🌡️ ${valor}°C = ${(valor * 9/5 + 32).toFixed(2)}°F`;
      if (tipo === "f") return `🌡️ ${valor}°F = ${((valor - 32) * 5/9).toFixed(2)}°C`;
    }
    return "❌ Formato: 'converter temperatura 30 C' ou 'converter temperatura 86 F'";
  }

  // ===== 39. Emoji aleatório =====
  if (t.includes("emoji aleatório")) {
    const emojis = ["😀","😂","🥰","😎","🤖","💡","🔥","🎉"];
    return `🎭 Emoji aleatório: ${emojis[Math.floor(Math.random()*emojis.length)]}`;
  }

  // ===== 40. Saudação inteligente =====
  if (t.includes("olá") || t.includes("oi") || t.includes("bom dia") || t.includes("boa tarde") || t.includes("boa noite")) {
    const hora = DateTime.now().hour;
    if (hora < 12) return "☀️ Bom dia!";
    if (hora < 18) return "🌤️ Boa tarde!";
    return "🌙 Boa noite!";
  }

  // ===== Se nada se aplica =====
  return null;
}
