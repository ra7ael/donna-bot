import { askGPT, db } from "../server.js";

// === EXTRAÇÃO AUTOMÁTICA DE MEMÓRIA + EMPRESAS CLIENTES ===
export async function extractAutoMemoryGPT(numero, mensagem) {
  try {
    const prompt = `
Analise a mensagem abaixo e identifique informações que devem ser armazenadas como memória do usuário.
Classifique dentro das seguintes categorias:
1. informações_pessoais
2. filhos
3. formação
4. trabalho
5. metas
6. preferencias
7. processos_rh
8. lembretes
9. empresas_clientes (IMPORTANTE)
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
 "lembretes": {},
 "empresas_clientes": [
    {
      "nome": "",
      "beneficios": [],
      "taxa_servico": "",
      "periodo_ponto": "",
      "datas_pagamento": "",
      "emails": [],
      "observacoes": ""
    }
 ],
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

    // ---- SALVA EMPRESAS CLIENTES SE HOUVER ----
    if (dados.empresas_clientes?.length > 0) {
      for (const empresa of dados.empresas_clientes) {
        if (!empresa.nome) continue;

        await db.collection("empresasClientes").updateOne(
          { numero, nome: empresa.nome.toLowerCase() },
          {
            $set: {
              ...empresa,
              nome: empresa.nome.toLowerCase(),
              atualizado_em: new Date()
            }
          },
          { upsert: true }
        );
      }
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

  const empresa = await db.collection("empresasClientes").findOne({
    numero,
    nome: empresaNome
  });

  return empresa;
}
