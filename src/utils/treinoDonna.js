import { MongoClient } from "mongodb";
import OpenAI from "openai";

let client;
let respostas;
let connected = false;
let papeisCombinados = [];

// Inicializa cliente OpenAI com a chave de ambiente
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Inicializa/garante conexão com MongoDB (conecta apenas uma vez)
async function initDB() {
  if (connected && respostas) return;
  client = new MongoClient(process.env.MONGO_URI, { useUnifiedTopology: true });
  await client.connect();
  const dbName = process.env.DONNA_DB_NAME || "donna";
  const db = client.db(dbName);
  respostas = db.collection("respostas");
  connected = true;
  console.log(`treinoDonna: conectado ao MongoDB (${dbName})`);
}

// Define os papéis ativos (chamado pelo server.js quando usuário solicita)
export function setPapeis(papeis) {
  if (!papeis) papeis = [];
  papeisCombinados = Array.isArray(papeis) ? papeis.map(p => p.trim()).filter(Boolean) : [];
  console.log("treinoDonna: papéis definidos =>", papeisCombinados);
}

export function clearPapeis() {
  papeisCombinados = [];
  console.log("treinoDonna: papéis limpos");
}

export function getPapeis() {
  return papeisCombinados;
}

// Tenta obter resposta treinada; se não houver, chama a OpenAI, salva e retorna
export async function obterResposta(pergunta, numero) {
  await initDB();
  const perguntaTrim = (pergunta || "").trim();
  if (!perguntaTrim) return "";

  // 1) Busca exata no banco para este usuário
  const existente = await respostas.findOne({ pergunta: perguntaTrim, numero });
  if (existente) {
    console.log("treinoDonna: resposta encontrada no DB para pergunta ->", perguntaTrim, "(usuário:", numero + ")");
    return existente.resposta;
  }

  // 2) Se não existir, gera com a OpenAI
  const systemContent = `Você é Donna, assistente pessoal do Rafael. Use toda sua inteligência e combine conhecimentos dos papéis ativos (${papeisCombinados.length > 0 ? papeisCombinados.join(', ') : 'nenhum'}).

Regras importantes:
- Responda de forma curta, prática e objetiva (máx. 2 frases).
- Se a resposta envolver saúde ou medicina, adicione o disclaimer: "Não sou um profissional; consulte um especialista.".
- Quando combinar vários papéis, integre a expertise de cada um. Se aplicar um papel específico, indique entre colchetes qual foi usado (ex: [Nutricionista]).
- Sugira até 1 ação prática clara quando fizer sentido.
- Não invente fatos. Se tiver incerteza, diga isso claramente.
- Mantenha o tom amistoso e direto.
`;

  const messages = [
    { role: "system", content: systemContent },
    { role: "user", content: perguntaTrim }
  ];

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages
    });

    const respostaGerada = (completion.choices?.[0]?.message?.content || "").trim();

    // Salva a nova resposta para aprendizado futuro, por usuário
    await respostas.insertOne({
      numero,
      pergunta: perguntaTrim,
      resposta: respostaGerada,
      papeis: papeisCombinados,
      criadoEm: new Date()
    });

    console.log("treinoDonna: gerada e salva resposta para ->", perguntaTrim, "(usuário:", numero + ")");
    return respostaGerada;
  } catch (err) {
    console.error("treinoDonna: erro ao chamar OpenAI ->", err);
    return "Desculpe, não consegui processar sua solicitação no momento.";
  }
}

// Função para treinar manualmente (upsert) por usuário
export async function treinarDonna(pergunta, resposta, numero) {
  await initDB();
  const p = (pergunta || "").trim();
  const r = (resposta || "").trim();
  if (!p) return;

  const exist = await respostas.findOne({ pergunta: p, numero });
  if (exist) {
    await respostas.updateOne(
      { pergunta: p, numero },
      { $set: { resposta: r, atualizadoEm: new Date(), papeis: papeisCombinados } }
    );
  } else {
    await respostas.insertOne({
      numero,
      pergunta: p,
      resposta: r,
      criadoEm: new Date(),
      papeis: papeisCombinados
    });
  }

  console.log(`treinoDonna: treinada -> "${p}" => "${r}" (usuário: ${numero})`);
}
