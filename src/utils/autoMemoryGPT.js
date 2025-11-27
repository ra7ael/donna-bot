// autoMemoryGPT.js
import { askGPT, db } from "../server.js";
import { embedding } from "./embeddingService.js";

// === EXTRAÇÃO AUTOMÁTICA DE MEMÓRIA + EMPRESAS CLIENTES ===
export async function extractAutoMemoryGPT(numero, mensagem) {
  try {
    // 1) encurtar mensagem para aliviar prompt
    const mensagemCurta = mensagem.slice(0, 600);

    // 2) montar mensagens para GPT
    const messages = [
      {
        role: "system",
        content: `
Extraia dados relevantes da mensagem do usuário para as categorias solicitadas.
Retorne JSON válido sempre que possível.
Caso não consiga estruturar, ainda assim responda SOMENTE um JSON válido no formato:
{ "texto": "resposta em texto puro" }

Categorias esperadas:
- informacoes_pessoais
- filhos
- formacao
- trabalho
- metas
- preferencias
- processos_rh
- lembretes
- empresas_clientes
- outros_dados_relevantes
        `
      },
      { role: "user", content: mensagemCurta }
    ];

    // 3) chamar GPT com timeout seguro de 8s
    const resposta = await askGPT(messages, 8000).catch(() => null);
    if (!resposta) return { texto: "timeout na extração de memória" };

    // 4) parser seguro de JSON
    let dados;
    try {
      dados = JSON.parse(resposta);
    } catch {
      dados = { texto: resposta }; // se não for JSON, guardamos como texto seguro
    }

    // 5) se houver empresas, salvar UMA por vez (leve, indexado)
    if (dados.empresas_clientes?.length) {
      const coleção = db.collection("empresasClientes");

      // garantir índices sem travar execução
      await coleção.createIndex({ numero: 1 });
      await coleção.createIndex({ nome: 1 });
      await coleção.createIndex({ atualizado_em: -1 });

      for (const empresa of dados.empresas_clientes) {
        if (!empresa.nome) continue;

        const nome = empresa.nome.trim().toLowerCase();

        await coleção.updateOne(
          { numero, nome },
          { $set: { ...empresa, nome, atualizado_em: new Date() } },
          { upsert: true }
        );
      }
    }

    return dados;

  } catch (err) {
    console.error("❌ Erro extractAutoMemoryGPT:", err.message);
    return { texto: "falha na extração de memória" };
  }
}

// === BUSCA INTELIGENTE PARA CONSULTAR EMPRESAS ===
export async function buscarEmpresa(numero, texto) {
  try {
    // 1) extrair nome da empresa de forma simples e limitada
    const nomeMatch = texto.toLowerCase().match(/da\s([a-z0-9 áéíóúãõç_\-]{2,40})/i);
    if (!nomeMatch) return null;

    const empresaNome = nomeMatch[1].trim().toLowerCase();

    // 2) buscar empresa leve e indexada
    const empresa = await db.collection("empresasClientes")
      .find({ numero, nome: empresaNome })
      .limit(1)
      .next();

    return empresa || null;

  } catch (err) {
    console.error("❌ Erro buscarEmpresa:", err.message);
    return null;
  }
}

// === RELEVÂNCIA OPCIONAL USANDO EMBEDDING (limitado) ===
export async function buscarEmpresaPorSimilaridade(numero, query, minScore = 0.82) {
  try {
    const coleção = db.collection("empresasClientes");

    await coleção.createIndex({ numero: 1 });
    await coleção.createIndex({ nome: 1 });
    
    const buscaVector = await embedding(query);
    if (!buscaVector?.length) return null;

    // ❗ Corrigido: removido .lean() indevido do Mongo nativo
    const empresas = await coleção.find(
      { numero },
      { projection: { nome: 1, vector: 1 } }
    ).toArray();

    if (!empresas.length) return null;

    // calcular score de similaridade
    const scored = empresas.map(e => ({
      nome: e.nome,
      score: cosineSimilarity(buscaVector, e.vector)
    }));

    // ordenar por score
    scored.sort((a, b) => b.score - a.score);
    const melhor = scored[0];

    // ❗ Adicionado guard seguro
    if (!melhor?.nome) return null;
    if (!melhor?.score || melhor.score < minScore) return null;

    // ❗ Corrigido: substituído findOne() por query nativa segura
    return coleção.find(
      { numero, nome: melhor.nome }
    ).limit(1).next();

  } catch (err) {
    console.error("❌ Falha similaridade:", err.message);
    return null;
  }
}

// === Cálculo de similaridade ===
function cosineSimilarity(A, B) {
  if (!A?.length || !B?.length) return 0;
  let dot = 0, mA = 0, mB = 0;
  for (let i = 0; i < A.length; i++) {
    dot += A[i] * B[i];
    mA += A[i] ** 2;
    mB += B[i] ** 2;
  }
  return dot / (Math.sqrt(mA) * Math.sqrt(mB) || 1);
}
