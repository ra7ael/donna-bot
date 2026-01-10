// ===== autoMemoryGPT.js =====
import { enqueueSemanticMemory } from "./semanticQueue.js";

/**
 * Extract and save useful user memories from a message
 * @param {string} numero - número do usuário
 * @param {string} mensagem - mensagem enviada pelo usuário
 * @param {Function} askGPT - função de chat GPT para análise
 * @returns {Promise<Object>} dados extraídos
 */
export async function extractAutoMemoryGPT(numero, mensagem, askGPT) {
  try {
    if (!askGPT) throw new Error("askGPT não fornecido como parâmetro");

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
// Remove possíveis blocos de Markdown (```json ... ```) antes de converter
      const cleanContent = resposta.replace(/```json|```/g, "").trim();
      dados = JSON.parse(cleanContent);
    } catch (e) {
      console.error("❌ Erro ao interpretar JSON da Memória:", e.message);
      // Logamos a resposta bruta para entender o que veio de errado se falhar
      console.log("Resposta bruta da IA:", resposta);
      return {};
    }

    // ---- AGRUPANDO PALAVRAS-CHAVE PARA EVITAR DUPLICAÇÃO ----
    const palavrasChave = new Set();

    if (dados.informacoes_pessoais) palavrasChave.add(JSON.stringify(dados.informacoes_pessoais));
    if (dados.filhos?.length) dados.filhos.forEach(f => palavrasChave.add(JSON.stringify(f)));
    if (dados.formacao) palavrasChave.add(JSON.stringify(dados.formacao));
    if (dados.trabalho) palavrasChave.add(JSON.stringify(dados.trabalho));
    if (dados.metas) palavrasChave.add(JSON.stringify(dados.metas));
    if (dados.preferencias) palavrasChave.add(JSON.stringify(dados.preferencias));
    if (dados.processos_rh) palavrasChave.add(JSON.stringify(dados.processos_rh));
    if (dados.lembretes?.length) dados.lembretes.forEach(l => palavrasChave.add(JSON.stringify(l)));
    if (dados.empresas_clientes?.length) dados.empresas_clientes.forEach(e => palavrasChave.add(JSON.stringify(e)));
    if (dados.outros_dados_relevantes) palavrasChave.add(JSON.stringify(dados.outros_dados_relevantes));

    // ---- SALVANDO PALAVRAS-CHAVE ----
    for (const palavra of palavrasChave) {
      await enqueueSemanticMemory("palavras-chave", palavra, numero, "user");
    }

    // ---- SALVANDO DADOS ESPECÍFICOS ----
    if (Object.keys(dados.informacoes_pessoais || {}).length > 0) {
      await enqueueSemanticMemory("informacoes_pessoais", dados.informacoes_pessoais, numero, "user");
    }

    if (dados.filhos?.length > 0) {
      for (const filho of dados.filhos) {
        await enqueueSemanticMemory("filhos", filho, numero, "user");
      }
    }

    if (dados.lembretes?.length > 0) {
      for (const lembrete of dados.lembretes) {
        await enqueueSemanticMemory("lembretes", lembrete, numero, "user");
      }
    }

    if (dados.empresas_clientes?.length > 0) {
      for (const empresa of dados.empresas_clientes) {
        await enqueueSemanticMemory("empresas_clientes", empresa, numero, "user");
      }
    }

    if (Object.keys(dados.outros_dados_relevantes || {}).length > 0) {
      await enqueueSemanticMemory("outros_dados_relevantes", dados.outros_dados_relevantes, numero, "user");
    }

    return dados;

  } catch (err) {
    console.error("❌ Erro extractAutoMemoryGPT:", err);
    return {};
  }
}

/**
 * Função de busca rápida de empresa no banco
 * @param {string} numero - número do usuário
 * @param {string} texto - texto contendo referência à empresa
 * @param {Object} db - instância do MongoDB
 * @returns {Promise<Object|null>} empresa encontrada
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
