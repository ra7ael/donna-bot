// ===== autoMemoryGPT.js =====
import { enqueueSemanticMemory } from "./semanticQueue.js";

/**
 * Pega askGPT dinamicamente do contexto global
 */
function getAskGPT() {
  if (!global.apiExports?.askGPT) {
    throw new Error("askGPT não está disponível em global.apiExports");
  }
  return global.apiExports.askGPT;
}

/**
 * === EXTRAÇÃO AUTOMÁTICA DE MEMÓRIA VALIOSA ===
 * Analisa a mensagem e salva memórias úteis do usuário de forma estruturada.
 * Categorias priorizadas: informações pessoais, filhos, trabalho, metas, lembretes, empresas clientes.
 */
export async function extractAutoMemoryGPT(numero, mensagem) {
  try {
    const askGPT = getAskGPT();

    const prompt = `
Analise a mensagem do usuário e extraia apenas informações que valem a pena serem lembradas.
Use as categorias a seguir, apenas se houver dados relevantes:

1. informacoes_pessoais
2. filhos
3. formacao
4. trabalho
5. metas
6. preferencias
7. processos_rh
8. lembretes
9. empresas_clientes

Forneça a resposta em JSON no seguinte formato:
{
 "informacoes_pessoais": {},
 "filhos": [],
 "formacao": {},
 "trabalho": {},
 "metas": {},
 "preferencias": {},
 "processos_rh": {},
 "lembretes": [],
 "empresas_clientes": []
}

Mensagem do usuário: "${mensagem}"
`;

    // Chama GPT para extrair memória
    const resposta = await askGPT(prompt);

    let dados = {};
    try {
      dados = JSON.parse(resposta);
    } catch (e) {
      console.warn("❌ Falha ao interpretar JSON do GPT:", e);
      return {};
    }

    // ==== Evita duplicação de memórias
    const palavrasChave = new Set();

    const categorias = [
      "informacoes_pessoais",
      "filhos",
      "formacao",
      "trabalho",
      "metas",
      "preferencias",
      "processos_rh",
      "lembretes",
      "empresas_clientes"
    ];

    categorias.forEach(cat => {
      const valor = dados[cat];
      if (Array.isArray(valor)) {
        valor.forEach(item => palavrasChave.add(JSON.stringify(item)));
      } else if (valor && Object.keys(valor).length > 0) {
        palavrasChave.add(JSON.stringify(valor));
      }
    });

    // ==== Salva palavras-chave na fila de memória semântica
    for (const palavra of palavrasChave) {
      await enqueueSemanticMemory("palavras-chave", palavra, numero, "user");
    }

    // ==== Salva cada categoria de forma estruturada
    for (const cat of categorias) {
      const valor = dados[cat];
      if (!valor) continue;

      if (Array.isArray(valor)) {
        for (const item of valor) {
          await enqueueSemanticMemory(cat, item, numero, "user");
        }
      } else if (Object.keys(valor).length > 0) {
        await enqueueSemanticMemory(cat, valor, numero, "user");
      }
    }

    return dados;
  } catch (err) {
    console.error("❌ Erro em extractAutoMemoryGPT:", err);
    return {};
  }
}

/**
 * === BUSCA INTELIGENTE DE EMPRESAS ===
 * Permite encontrar empresas mencionadas na mensagem para respostas rápidas
 */
export async function buscarEmpresa(numero, texto, db) {
  const nomeMatch = texto.toLowerCase().match(/(beneficios|taxa|ponto|pagamento|email).*?da\s(.+)/);
  if (!nomeMatch) return null;

  const empresaNome = nomeMatch[2].trim().toLowerCase();

  const empresa = await db.collection("empresasClientes").findOne({
    numero,
    nome: empresaNome
  });

  return empresa;
}
