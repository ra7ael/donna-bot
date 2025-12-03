import { askGPT, db } from "../server.js";

// === FILA CENTRAL DE OPERAÇÕES NO MONGO ===
const mongoQueue = [];
let processingQueue = false;

async function processMongoQueue() {
  if (processingQueue) return;
  processingQueue = true;

  while (mongoQueue.length > 0) {
    const operation = mongoQueue.shift();
    try {
      await operation();
    } catch (err) {
      console.error("❌ Erro na operação MongoDB:", err);
    }
  }

  processingQueue = false;
}

function enqueueMongoOperation(operation) {
  mongoQueue.push(operation);
  processMongoQueue();
}

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

    // ---- SALVA EMPRESAS CLIENTES SE HOUVER ----
    if (dados.empresas_clientes?.length > 0) {
      for (const empresa of dados.empresas_clientes) {
        if (!empresa.nome) continue;

        enqueueMongoOperation(() =>
          db.collection("empresasClientes").updateOne(
            { numero, nome: empresa.nome.toLowerCase() },
            {
              $set: {
                ...empresa,
                nome: empresa.nome.toLowerCase(),
                atualizado_em: new Date()
              }
            },
            { upsert: true }
          )
        );
      }
    }

    // ---- SALVA FILHOS SE HOUVER ----
    if (dados.filhos?.length > 0) {
      for (const filho of dados.filhos) {
        enqueueMongoOperation(() =>
          db.collection("filhos").updateOne(
            { numero, nome: filho.nome.toLowerCase() },
            { $set: { ...filho, atualizado_em: new Date() } },
            { upsert: true }
          )
        );
      }
    }

    // ---- SALVA LEMBRETES SE HOUVER ----
    if (dados.lembretes?.length > 0) {
      for (const lembrete of dados.lembretes) {
        enqueueMongoOperation(() =>
          db.collection("lembretes").updateOne(
            { numero, titulo: lembrete.titulo },
            { $set: { ...lembrete, atualizado_em: new Date() } },
            { upsert: true }
          )
        );
      }
    }

    // ---- SALVA OUTROS DADOS PESSOAIS ----
    if (Object.keys(dados.informacoes_pessoais || {}).length > 0) {
      enqueueMongoOperation(() =>
        db.collection("informacoesPessoais").updateOne(
          { numero },
          { $set: { ...dados.informacoes_pessoais, atualizado_em: new Date() } },
          { upsert: true }
        )
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

  const empresa = await db.collection("empresasClientes").findOne({
    numero,
    nome: empresaNome
  });

  return empresa;
}
