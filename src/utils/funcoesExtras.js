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
  // Função para remover acentos e normalizar texto
const normalize = (str) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const tNorm = normalize(texto.toLowerCase());
const t = tNorm;
  
  // ===== 1. Hora atual =====
if (tNorm.includes("que horas") || tNorm.includes("horas sao") || tNorm.includes("horas agora")) {
  return `🕒 Agora são ${DateTime.now().toFormat("HH:mm")}`;
}

  // ===== 2. Data de hoje =====
  if (tNorm.includes("data de hoje") || tNorm.includes("que dia é hoje"))  {
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
    const diff = Math.abs(d2.diff(d1, "days").days);
    return `📆 Dias entre datas: ${diff}`;
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

  // ===== 41. Pesquisar no Google (simulação) =====
if (t.startsWith("pesquisar")) {
  const termo = t.replace("pesquisar", "").trim();
  if (termo) return `🔎 Resultados de pesquisa para "${termo}":\n1. ${termo} artigo A\n2. ${termo} artigo B\n3. ${termo} artigo C (simulação)`;
  return "❌ Informe algo para pesquisar, ex: 'pesquisar IA'";
}

// ===== 42. Notícias mais recentes (simulação) =====
if (t.includes("notícias") || t.includes("noticias")) {
  return "📰 Últimas notícias:\n- Economia em alta\n- Tecnologia cresce\n- Esportes em destaque (simulação)";
}

// ===== 43. CEP → Endereço =====
if (t.startsWith("cep")) {
  const cep = t.replace("cep", "").trim();
  try {
    const res = await axios.get(`https://viacep.com.br/ws/${cep}/json/`);
    if (res.data.erro) return "❌ CEP inválido!";
    return `🏠 Endereço: ${res.data.logradouro}, ${res.data.bairro}, ${res.data.localidade}-${res.data.uf}`;
  } catch {
    return "❌ Não consegui consultar o CEP.";
  }
}

// ===== 44. Clima cidade =====
if (t.startsWith("clima")) {
  const cidade = t.replace("clima", "").trim();
  return cidade ? `🌤️ Clima em ${cidade}: 25°C ensolarado (simulação)` : "❌ Informe a cidade, ex: 'clima São Paulo'";
}

  // ===== 45. Nova lista de tarefas =====
if (t.startsWith("nova lista")) {
  const itens = t.replace("nova lista", "").split(",").map(i=>i.trim());
  return `📌 Lista criada:\n${itens.map((i,idx)=>`${idx+1}. ⏳ ${i}`).join("\n")}`;
}

// ===== 46. Lista de compras =====
if (t.startsWith("lista compras")) {
  const itens = t.replace("lista compras", "").split(",").map(i=>i.trim());
  return `🛒 Lista de compras:\n${itens.map(i=>`- ${i}`).join("\n")}`;
}

// ===== 47. Pomodoro =====
if (t.includes("pomodoro")) return "⏳ Pomodoro iniciado: 25min foco + 5min pausa.";

// ===== 48. Resumir texto =====
if (t.startsWith("resumir:")) {
  const textoBruto = t.replace("resumir:", "").trim();
  return textoBruto.length > 50 ? `📝 Resumo: ${textoBruto.slice(0,50)}...` : "❌ Texto muito curto para resumir.";
}

// ===== 49. Explicar palavra =====
if (t.startsWith("o que significa")) {
  const palavra = t.replace("o que significa", "").trim();
  return palavra ? `📖 "${palavra}" significa [explicação simulada].` : "❌ Informe uma palavra.";
    }

  // ===== 50. Horóscopo =====
if (t.includes("horóscopo")) {
  const signo = t.split(" ").pop();
  return `✨ Horóscopo de ${signo}: Hoje é um bom dia para acreditar em você! (simulação)`;
}

// ===== 51. Sugestão de filmes =====
if (t.includes("indica um filme")) return "🎬 Recomendo: 'A Origem' (Inception)";

// ===== 52. Sugestão de músicas =====
if (t.includes("indica músicas")) return "🎶 Playlist para estudar: Lofi Beats (simulação)";

// ===== 53. Nome criativo =====
if (t.startsWith("criar nome")) {
  const tema = t.replace("criar nome", "").trim();
  return `💡 Nome sugerido: ${tema}X Pro`;
}

// ===== 54. Slogan curto =====
if (t.startsWith("slogan")) {
  const tema = t.replace("slogan", "").trim();
  return `📝 Slogan: "${tema}, conectando pessoas e ideias."`;
                                 }

  // ===== 55. Converter moeda JPY =====
if (t.includes("converta") && t.includes("usd para jpy")) {
  const match = t.match(/[\d,.]+/);
  if (match) {
    const valor = parseFloat(match[0].replace(",", "."));
    const cotacao = 150; // simulação
    return `💴 ${valor} USD = ${(valor*cotacao).toFixed(2)} JPY`;
  }
}

// ===== 56. Juros compostos =====
if (t.startsWith("juros compostos")) {
  const [capital, taxa, meses] = t.match(/[\d.]+/g).map(Number);
  const montante = capital * Math.pow(1+taxa/100, meses);
  return `💰 Montante: ${montante.toFixed(2)}`;
}

// ===== 57. Regra de 3 =====
if (t.startsWith("regra de 3")) return "🔢 Exemplo: 2 está para 10 assim como 5 está para 25.";

// ===== 58. Tabuada =====
if (t.startsWith("tabuada")) {
  const n = parseInt(t.replace("tabuada", "").trim());
  if (!isNaN(n)) return Array.from({length:10},(_,i)=>`${n}x${i+1}=${n*(i+1)}`).join("\n");
}

  // ===== 59. Responder WhatsApp (simulação) =====
if (t.startsWith("responder mensagem")) {
  const msg = t.replace("responder mensagem", "").trim();
  return `📲 Resposta enviada: "${msg}" (simulação)`;
}

// ===== 60. Explicar código simples =====
if (t.startsWith("explica código:")) {
  const code = t.replace("explica código:", "").trim();
  return `💻 Esse código faz: [explicação simulada do trecho: ${code}]`;
}

  // ==========================
// Funções Profissionais Premium
// ==========================

// Recrutamento & Seleção
if (t.includes("descrição vaga")) {
  return "Modelo de descrição de vaga:\n\nTítulo: [Cargo]\nResumo: [Resumo da função]\nResponsabilidades: [Liste 3-5 pontos]\nRequisitos: [Liste exigências básicas]\nBenefícios: [Benefícios oferecidos]";
}

if (t.includes("perguntas entrevista")) {
  return "Exemplos de perguntas para entrevista:\n1. Fale sobre você.\n2. Quais suas principais forças?\n3. Como lida com pressão?\n4. Por que deseja trabalhar aqui?";
}

if (t.includes("avaliar candidato")) {
  return "Modelo de avaliação:\n- Comunicação: Boa / Regular / Ruim\n- Pontualidade: Sim / Não\n- Proatividade: Alta / Média / Baixa\n- Observações: [Comentários]";
}

if (t.includes("anúncio vaga")) {
  return "Modelo de anúncio:\n📢 Estamos contratando!\nCargo: [Cargo]\nRequisitos: [Principais requisitos]\nBenefícios: [Benefícios]\nCandidate-se enviando currículo para [e-mail].";
}

if (t.includes("feedback negativo")) {
  return "Olá [Nome], agradecemos por participar do nosso processo seletivo. Após análise, seguimos com outro candidato que se alinhou mais ao perfil da vaga. Desejamos sucesso na sua jornada!";
}

// Gestão de Pessoas
if (t.includes("benefícios criativos")) {
  return "Sugestões de benefícios:\n- Dia de folga no aniversário 🎂\n- Vale-cultura 🎭\n- Horário flexível ⏰\n- Programa de bem-estar 💆";
}

if (t.includes("plano onboarding")) {
  return "Plano de Onboarding:\n1. Apresentação da empresa.\n2. Integração com equipe.\n3. Treinamento de ferramentas.\n4. Acompanhamento inicial.";
}

if (t.includes("plano treinamento")) {
  return "Plano de Treinamento:\n- Objetivo: Desenvolver liderança.\n- Público: Gestores.\n- Duração: 3 meses.\n- Métodos: Workshops, coaching, estudo de caso.";
}

if (t.includes("política home office")) {
  return "Política de Home Office:\n- Até 2 dias por semana.\n- Necessário alinhamento com gestor.\n- Relatórios semanais de atividades.";
}

if (t.includes("pesquisa clima")) {
  return "Modelo de Pesquisa de Clima:\n1. Você está satisfeito com seu trabalho?\n2. Como avalia sua liderança?\n3. Sente que sua opinião é ouvida?\n4. O que pode melhorar?";

// Planejamento & Estratégia
if (t.includes("swot")) {
  return "Análise SWOT:\n- Forças: [Liste]\n- Fraquezas: [Liste]\n- Oportunidades: [Liste]\n- Ameaças: [Liste]";
}

if (t.includes("5w2h")) {
  return "Plano 5W2H:\n- What: O que será feito?\n- Why: Por que?\n- Where: Onde?\n- When: Quando?\n- Who: Quem?\n- How: Como?\n- How Much: Quanto custará?";
}

if (t.includes("meta smart")) {
  return "Modelo de Meta SMART:\n- Específica: Aumentar vendas.\n- Mensurável: +10%.\n- Atingível: Com novas estratégias.\n- Relevante: Impacta receita.\n- Temporal: Até Dez/2025.";
}

if (t.includes("plano estratégico rh")) {
  return "Plano Estratégico RH (6 meses):\n1. Recrutamento ágil.\n2. Programa de treinamento.\n3. Avaliação de desempenho.\n4. Ações de engajamento.";
}

if (t.includes("indicadores recrutamento")) {
  return "KPIs de Recrutamento:\n- Tempo médio de contratação.\n- Custo por contratação.\n- Taxa de turnover.\n- Satisfação do gestor.";

// Negócios & Produtividade
if (t.includes("concorrência")) {
  return "Análise de concorrência:\n- Principais players: [Liste]\n- Diferenciais: [Liste]\n- Preços: [Comparação]\n- Oportunidades: [Liste]";
}

if (t.includes("proposta consultoria")) {
  return "Proposta Comercial:\n📌 Serviços: Consultoria em RH.\n📌 Prazo: [Definir]\n📌 Valor: [Definir]\n📌 Benefícios: Redução de custos, melhor gestão de pessoas.";
}

if (t.includes("resumo executivo")) {
  return "Resumo Executivo:\n1. Contexto.\n2. Resultados principais.\n3. Conclusões.\n4. Recomendações.";
}

if (t.includes("ata reunião")) {
  return "Modelo de Ata:\n📅 Data: [xx/xx]\n👥 Participantes: [Lista]\n📌 Assuntos tratados: [Lista]\n✅ Decisões tomadas: [Lista]";
}

if (t.includes("checklist auditoria")) {
  return "Checklist de Auditoria RH:\n- Contratos assinados.\n- Folhas de ponto.\n- Benefícios pagos.\n- Treinamentos registrados.";
}

  // ==========================
// Funções Departamento Pessoal (DP) e Folha de Pagamento
// ==========================

// ===== 1. Cálculo de férias =====
if (t.includes("calcular férias")) {
  const match = t.match(/(\d+(?:\.\d+)?) dias?/);
  const dias = match ? parseFloat(match[1]) : 30;
  const salario = t.match(/(\d+(?:\.\d+)?)/) ? parseFloat(t.match(/(\d+(?:\.\d+)?)/)[1]) : 0;
  const valorFerias = ((salario / 30) * dias * 1.3333).toFixed(2); // 1/3 constitucional
  return `💼 Férias de ${dias} dias = R$ ${valorFerias} (inclui 1/3 constitucional)`;
}

// ===== 2. Cálculo de 13º salário =====
if (t.includes("calcular 13º")) {
  const salario = t.match(/(\d+(?:\.\d+)?)/) ? parseFloat(t.match(/(\d+(?:\.\d+)?)/)[1]) : 0;
  const meses = t.match(/(\d+)\s*meses?/) ? parseInt(t.match(/(\d+)\s*meses?/)[1]) : 12;
  const valor = ((salario / 12) * meses).toFixed(2);
  return `💰 13º salário proporcional (${meses} meses) = R$ ${valor}`;
}

// ===== 3. Cálculo de rescisão =====
if (t.includes("calcular rescisão")) {
  const salario = t.match(/(\d+(?:\.\d+)?)/) ? parseFloat(t.match(/(\d+(?:\.\d+)?)/)[1]) : 0;
  const diasTrabalhados = t.match(/(\d+) dias?/) ? parseInt(t.match(/(\d+) dias?/)[1]) : 30;
  const aviso = t.includes("indenizado") ? salario : 0;
  const ferias = (salario / 30 * diasTrabalhados * 1.3333).toFixed(2);
  const total = (parseFloat(ferias) + aviso).toFixed(2);
  return `⚖️ Rescisão aproximada = R$ ${total} (Férias: R$${ferias}, Aviso: R$${aviso})`;
}

// ===== 4. INSS a pagar =====
if (t.includes("calcular inss")) {
  const salario = t.match(/(\d+(?:\.\d+)?)/) ? parseFloat(t.match(/(\d+(?:\.\d+)?)/)[1]) : 0;
  let desconto = 0;
  if (salario <= 1302) desconto = salario * 0.075;
  else if (salario <= 2571.29) desconto = salario * 0.09;
  else if (salario <= 3856.94) desconto = salario * 0.12;
  else if (salario <= 7507.49) desconto = salario * 0.14;
  else desconto = 1050.88; // teto 2025
  return `📌 INSS a pagar = R$ ${desconto.toFixed(2)}`;
}

// ===== 5. IRRF a pagar =====
if (t.includes("calcular irrf")) {
  const salario = t.match(/(\d+(?:\.\d+)?)/) ? parseFloat(t.match(/(\d+(?:\.\d+)?)/)[1]) : 0;
  const dependentes = t.match(/(\d+) dependentes?/) ? parseInt(t.match(/(\d+) dependentes?/)[1]) : 0;
  const base = salario - dependentes * 189.59; // dedução por dependente
  let ir = 0;
  if (base <= 1903.98) ir = 0;
  else if (base <= 2826.65) ir = base * 0.075 - 142.80;
  else if (base <= 3751.05) ir = base * 0.15 - 354.80;
  else if (base <= 4664.68) ir = base * 0.225 - 636.13;
  else ir = base * 0.275 - 869.36;
  return `📌 IRRF a pagar ≈ R$ ${ir.toFixed(2)}`;
}

// ===== 6. Cálculo salário líquido =====
if (t.includes("calcular salário líquido")) {
  const salario = t.match(/(\d+(?:\.\d+)?)/) ? parseFloat(t.match(/(\d+(?:\.\d+)?)/)[1]) : 0;
  const inss = salario <= 1302 ? salario * 0.075
               : salario <= 2571.29 ? salario * 0.09
               : salario <= 3856.94 ? salario * 0.12
               : salario <= 7507.49 ? salario * 0.14
               : 1050.88;
  const ir = 0; // simplificado ou use função IRRF anterior
  const liquido = salario - inss - ir;
  return `💵 Salário líquido aproximado = R$ ${liquido.toFixed(2)} (INSS: R$${inss.toFixed(2)}, IR: R$${ir.toFixed(2)})`;
}

// ===== 7. Tabela férias =====
if (t.includes("tabela férias")) {
  return "Tabela de Férias Proporcional:\n- Até 12 meses: 30 dias\n- 11 meses: 27,5 dias\n- 10 meses: 25 dias\n- 9 meses: 22,5 dias\n- 8 meses: 20 dias\n- 7 meses: 17,5 dias\n- 6 meses: 15 dias\n- 5 meses: 12,5 dias\n- 4 meses: 10 dias\n- 3 meses: 7,5 dias\n- 2 meses: 5 dias\n- 1 mês: 2,5 dias";
}

// ===== 8. Aviso prévio =====
if (t.includes("aviso prévio")) {
  const tempo = t.match(/(\d+) anos?/) ? parseInt(t.match(/(\d+) anos?/)[1]) : 0;
  const dias = 30 + (tempo > 1 ? Math.min((tempo - 1) * 3, 30) : 0);
  return `📌 Aviso prévio = ${dias} dias`;
}

// ===== 9. FGTS =====
if (t.includes("calcular fgts")) {
  const salario = t.match(/(\d+(?:\.\d+)?)/) ? parseFloat(t.match(/(\d+(?:\.\d+)?)/)[1]) : 0;
  const fgts = salario * 0.08;
  return `💰 FGTS mensal = R$ ${fgts.toFixed(2)}`;
}

// ===== 10. Jornada de trabalho =====
if (t.includes("horas trabalhadas")) {
  const dias = t.match(/(\d+) dias?/) ? parseInt(t.match(/(\d+) dias?/)[1]) : 30;
  const horasDia = t.match(/(\d+) horas?/) ? parseInt(t.match(/(\d+) horas?/)[1]) : 8;
  const total = dias * horasDia;
  return `⏱️ Total de horas trabalhadas = ${total}h`;
}

  // ===== Se nada se aplica =====
  return null;
}
