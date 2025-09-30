// src/utils/funcoesExtras.js

/**
 * Funções extras da Donna - 30 funções prontas
 * A Donna tenta executar essas funções antes de chamar o GPT.
 */

import { DateTime } from "luxon";
import { getWeather } from "./weather.js"; // precisa existir no seu projeto
import axios from "axios";

export async function funcoesExtras(numero, texto) {
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

  // ===== 5. Contagem regressiva =====
  if (t.startsWith("contagem regressiva")) {
    const match = t.match(/\d+/);
    if (match) return `⏱️ Começando contagem regressiva de ${match[0]} segundos!`;
    return "❌ Informe a quantidade de segundos, ex: 'contagem regressiva 10'";
  }

  // ===== 6. Conversão de moeda BRL -> USD =====
  if (t.includes("converta") && t.includes("brl para usd")) {
    const match = t.match(/[\d,.]+/);
    if (match) {
      const valor = parseFloat(match[0].replace(",", "."));
      const cotacao = 0.20; // valor fixo ou chamar API
      return `💰 ${valor} BRL = ${(valor * cotacao).toFixed(2)} USD`;
    }
    return "❌ Informe o valor em BRL, ex: 'converta 50 BRL para USD'";
  }

  // ===== 7. Conversão de moeda USD -> BRL =====
  if (t.includes("converta") && t.includes("usd para brl")) {
    const match = t.match(/[\d,.]+/);
    if (match) {
      const valor = parseFloat(match[0].replace(",", "."));
      const cotacao = 5.0;
      return `💰 ${valor} USD = ${(valor * cotacao).toFixed(2)} BRL`;
    }
    return "❌ Informe o valor em USD, ex: 'converta 10 USD para BRL'";
  }

  // ===== 8. Somar números =====
  if (t.startsWith("soma")) {
    const nums = t.match(/-?\d+(\.\d+)?/g);
    if (nums) return `➕ Resultado: ${nums.map(Number).reduce((a,b)=>a+b,0)}`;
    return "❌ Informe números para somar, ex: 'soma 2 3 4'";
  }

  // ===== 9. Subtrair números =====
  if (t.startsWith("subtraia")) {
    const nums = t.match(/-?\d+(\.\d+)?/g);
    if (nums && nums.length >= 2) {
      const res = nums.map(Number).reduce((a,b)=>a-b);
      return `➖ Resultado: ${res}`;
    }
    return "❌ Informe pelo menos 2 números, ex: 'subtraia 10 3'";
  }

  // ===== 10. Multiplicar números =====
  if (t.startsWith("multiplique")) {
    const nums = t.match(/-?\d+(\.\d+)?/g);
    if (nums) return `✖️ Resultado: ${nums.map(Number).reduce((a,b)=>a*b,1)}`;
    return "❌ Informe números, ex: 'multiplique 2 3 4'";
  }

  // ===== 11. Dividir números =====
  if (t.startsWith("divida")) {
    const nums = t.match(/-?\d+(\.\d+)?/g);
    if (nums && nums.length >= 2) {
      const res = nums.map(Number).reduce((a,b)=>a/b);
      return `➗ Resultado: ${res.toFixed(2)}`;
    }
    return "❌ Informe pelo menos 2 números, ex: 'divida 10 2'";
  }

  // ===== 12. Gerar número aleatório =====
  if (t.includes("número aleatório") || t.includes("numero aleatorio")) {
    const min = t.match(/min\s*(\d+)/)?.[1] || 0;
    const max = t.match(/max\s*(\d+)/)?.[1] || 100;
    const n = Math.floor(Math.random() * (max - min + 1)) + parseInt(min);
    return `🎲 Número aleatório: ${n}`;
  }

  // ===== 13. Criar lembrete =====
  if (t.startsWith("lembrete")) {
    const msg = t.replace("lembrete", "").trim();
    if (msg) return `⏰ Lembrete criado: "${msg}" (simulação)`;
    return "❌ Informe a mensagem do lembrete, ex: 'lembrete Comprar pão às 18h'";
  }

  // ===== 14. Lista de tarefas =====
  if (t.startsWith("adicionar tarefa") || t.startsWith("nova tarefa")) {
    const tarefa = t.replace(/adicionar tarefa|nova tarefa/, "").trim();
    if (tarefa) return `📌 Tarefa adicionada: "${tarefa}" (simulação)`;
    return "❌ Informe a tarefa, ex: 'adicionar tarefa Estudar JS'";
  }

  // ===== 15. Mostrar tarefas =====
  if (t.includes("minhas tarefas") || t.includes("listar tarefas")) {
    return "📋 Suas tarefas: [simulação] 1. Estudar JS 2. Revisar PDF 3. Treinar Donna";
  }

  // ===== 16. Traduzir palavra (PT -> EN) =====
  if (t.startsWith("traduzir")) {
    const palavra = t.replace("traduzir", "").trim();
    if (palavra) return `🌐 "${palavra}" em inglês é "${palavra}-en" (simulação)`;
    return "❌ Informe a palavra, ex: 'traduzir casa'";
  }

  // ===== 17. Cotação de bitcoin =====
  if (t.includes("bitcoin") || t.includes("btc")) {
    try {
      const res = await axios.get("https://api.coindesk.com/v1/bpi/currentprice.json");
      return `₿ Bitcoin: $${res.data.bpi.USD.rate}`;
    } catch {
      return "❌ Não consegui obter cotação do Bitcoin agora.";
    }
  }

  // ===== 18. Cotação de dólar =====
  if (t.includes("dólar") || t.includes("dolar")) {
    try {
      const res = await axios.get("https://economia.awesomeapi.com.br/json/last/USD-BRL");
      return `💵 Dólar: R$${res.data["USDBRL"].bid}`;
    } catch {
      return "❌ Não consegui obter cotação do dólar agora.";
    }
  }

  // ===== 19. Cotação de euro =====
  if (t.includes("euro")) {
    try {
      const res = await axios.get("https://economia.awesomeapi.com.br/json/last/EUR-BRL");
      return `💶 Euro: R$${res.data["EURBRL"].bid}`;
    } catch {
      return "❌ Não consegui obter cotação do euro agora.";
    }
  }

  // ===== 20. Gerar senha aleatória =====
  if (t.includes("senha aleatória")) {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()";
    let senha = "";
    for (let i=0;i<12;i++) senha += chars[Math.floor(Math.random()*chars.length)];
    return `🔑 Senha gerada: ${senha}`;
  }

  // ===== 21. Contar palavras =====
  if (t.startsWith("contar palavras")) {
    const count = t.replace("contar palavras", "").trim().split(/\s+/).filter(w=>w).length;
    return `🔢 Número de palavras: ${count}`;
  }

  // ===== 22. Contar caracteres =====
  if (t.startsWith("contar caracteres")) {
    const count = t.replace("contar caracteres", "").trim().length;
    return `🔤 Número de caracteres: ${count}`;
  }

  // ===== 23. Calcular IMC =====
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

  // ===== 24. Contar número de dias entre datas =====
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

  // ===== 25. Frase motivacional =====
  if (t.includes("motiva") || t.includes("frase motivacional")) {
    return "💡 Acredite em você! Cada passo pequeno te leva a grandes conquistas!";
  }

  // ===== 26. Piada rápida =====
  if (t.includes("piada")) return "😂 Por que o computador foi ao médico? Porque estava com vírus!";

  // ===== 27. Fuso horário =====
  if (t.includes("fuso horário")) return `🌍 O fuso horário atual é ${DateTime.now().offsetNameShort}`;

  // ===== 28. Dia da semana =====
  if (t.includes("dia da semana") || t.includes("que dia caiu")) {
    return `📅 Hoje é ${DateTime.now().toFormat("cccc")}`;
  }

  // ===== 29. Número de segundos desde meia-noite =====
  if (t.includes("segundos desde meia-noite")) {
    const agora = DateTime.now();
    const segundos = agora.diff(agora.startOf("day"), "seconds").seconds;
    return `⏱️ Segundos desde meia-noite: ${Math.floor(segundos)}`;
  }

  // ===== 30. Limpar memória simulada =====
  if (t.includes("limpar memória")) return "🧹 Memória limpa! (simulação)";

  // ===== Se não se aplica =====
  return null;
}
