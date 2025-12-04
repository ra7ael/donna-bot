// ===== autoMemoryGPT.js =====

// Pega askGPT do global.apiExports para evitar import circular
const { askGPT } = global.apiExports;
import { enqueueSemanticMemory } from "./semanticQueue.js"; // ajuste o caminho se necessário

// === EXTRAÇÃO AUTOMÁTICA DE MEMÓRIA + EMPRESAS CLIENTES ===
export async function extractAutoMemoryGPT(numero, mensagem) {
  try {
    const prompt = `
Analise a mensagem abaixo e identifique informações que devem ser armazenadas como memória do usuário.
Classifique dentro das seguintes categorias:
1. informacoes_pessoais
2. filhos
3. formacao
4. trabalho
5. metas
6. preferencias
7. processos_rh
8. lembretes
9. empresas_clientes
10. outros_dados_relevantes

Formato de resposta SEMPRE em JSON:

{
 "informacoes_pessoais": {},
 "filhos": [],
 "formacao": {},
 "trabalho": {},
 "metas": {},
 "preferencias": {},
 "processos_rh": {},
 "lembretes": [],
 "empresas_clientes": [],
 "outros_dados_relevantes": {}
}

Mensagem do usuário: "${mensagem}"
`;

    const resposta = await askGPT(prompt);

    let dados = {};
    try {
      dados = JSON.parse(resposta);
    } catch (e) {
      console.log("❌ Erro ao interpretar JSON:", e);
      return {};
    }

    // ---- SALVA TODAS AS CATEGORIAS NA FILA DE MEMÓRIA SEMÂNTICA ----
    if (Object.keys(dados.informacoes_pessoais || {}).length > 0) {
      enqueueSemanticMemory(
        "informacoes_pessoais",
        dados.informacoes_pessoais,
        numero,
        "user"
      );
    }

    if (dados.filhos?.length > 0) {
      dados.filhos.forEach(filho => {
        enqueueSemanticMemory("filhos", filho, numero, "user");
      });
    }

    if (dados.lembretes?.length > 0) {
      dados.lembretes.forEach(lembrete => {
        enqueueSemanticMemory("lembretes", lembrete, numero, "user");
      });
    }

    if (dados.empresas_clientes?.length > 0) {
      dados.empresas_clientes.forEach(empresa => {
        enqueueSemanticMemory("empresas_clientes", empresa, numero, "user");
      });
    }

    if (Object.keys(dados.outros_dados_relevantes || {}).length > 0) {
      enqueueSemanticMemory(
        "outros_dados_relevantes",
        dados.outros_dados_relevantes,
        numero,
        "user"
      );
    }

    return dados;
  } catch (err) {
    console.error("❌ Erro extractAutoMemoryGPT:", err);
    return {};
  }
}

// === BUSCA INTELIGENTE PARA CONSULTAR EMPRESAS ===
export async function buscarEmpresa(numero, texto) {
  const nomeMatch = texto.toLowerCase().match(/(beneficios|taxa|ponto|pagamento|email).*?da\s(.+)/);
  if (!nomeMatch) return null;

  const empresaNome = nomeMatch[2].trim().toLowerCase();

  // Continua usando o MongoDB diretamente para consultas simples
  const empresa = await db.collection("empresasClientes").findOne({
    numero,
    nome: empresaNome
  });

  return empresa;
}
