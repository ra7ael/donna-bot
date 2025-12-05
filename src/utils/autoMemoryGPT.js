// ===== autoMemoryGPT.js =====
import { enqueueSemanticMemory } from "./semanticQueue.js"; // ajuste o caminho se necessário

// Função auxiliar para obter askGPT dinamicamente
function getAskGPT() {
  if (!global.apiExports?.askGPT) {
    throw new Error("askGPT não está disponível em global.apiExports");
  }
  return global.apiExports.askGPT;
}

// === EXTRAÇÃO AUTOMÁTICA DE MEMÓRIA + EMPRESAS CLIENTES ===
export async function extractAutoMemoryGPT(numero, mensagem) {
  try {
    const askGPT = getAskGPT(); // pega dinamicamente

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

    // ---- AGRUPANDO E EVITANDO DUPLICAÇÃO DE PALAVRAS-CHAVE ----
    const palavrasChave = new Set();

    // Adiciona todas as palavras-chave relevantes em um único Set (evita duplicação)
    if (dados.informacoes_pessoais) palavrasChave.add(JSON.stringify(dados.informacoes_pessoais));
    if (dados.filhos?.length) dados.filhos.forEach(filho => palavrasChave.add(JSON.stringify(filho)));
    if (dados.formacao) palavrasChave.add(JSON.stringify(dados.formacao));
    if (dados.trabalho) palavrasChave.add(JSON.stringify(dados.trabalho));
    if (dados.metas) palavrasChave.add(JSON.stringify(dados.metas));
    if (dados.preferencias) palavrasChave.add(JSON.stringify(dados.preferencias));
    if (dados.processos_rh) palavrasChave.add(JSON.stringify(dados.processos_rh));
    if (dados.lembretes?.length) dados.lembretes.forEach(lembrete => palavrasChave.add(JSON.stringify(lembrete)));
    if (dados.empresas_clientes?.length) dados.empresas_clientes.forEach(empresa => palavrasChave.add(JSON.stringify(empresa)));
    if (dados.outros_dados_relevantes) palavrasChave.add(JSON.stringify(dados.outros_dados_relevantes));

    // ---- SALVANDO AS PALAVRAS-CHAVE ----
    for (const palavra of palavrasChave) {
      await enqueueSemanticMemory("palavras-chave", palavra, numero, "user");
    }

    // ---- SALVANDO OUTROS DADOS SEPARADOS ----
    if (Object.keys(dados.informacoes_pessoais || {}).length > 0) {
      await enqueueSemanticMemory("informacoes_pessoais", dados.informacoes_pessoais, numero, "user");
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
      enqueueSemanticMemory("outros_dados_relevantes", dados.outros_dados_relevantes, numero, "user");
    }

    return dados;
  } catch (err) {
    console.error("❌ Erro extractAutoMemoryGPT:", err);
    return {};
  }
}

// === BUSCA INTELIGENTE PARA CONSULTAR EMPRESAS ===
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
