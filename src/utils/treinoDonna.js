import { MongoClient } from "mongodb";
import OpenAI from "openai";

let client;
let respostas;
let connected = false;
let papeisCombinados = [];

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ✅ Conexão otimizada com o banco
async function initDB() {
  if (client && client.topology?.isConnected() && respostas) return;

  client = new MongoClient(process.env.MONGO_URI, { useUnifiedTopology: true });
  await client.connect();

  const dbName = process.env.DONNA_DB_NAME || "donna";
  const db = client.db(dbName);
  respostas = db.collection("respostas");

  connected = true;
  console.log(`✅ treinoDonna: conectado ao MongoDB (${dbName})`);
}

// ✅ Controle de papéis (funções combinadas)
export function setPapeis(papeis) {
  papeisCombinados = Array.isArray(papeis)
    ? papeis.map(p => p.trim()).filter(Boolean)
    : [];
  console.log("🎭 treinoDonna: papéis definidos =>", papeisCombinados);
}

export function clearPapeis() {
  papeisCombinados = [];
  console.log("🧹 treinoDonna: papéis limpos");
}

export function getPapeis() {
  return papeisCombinados;
}

// ✅ Busca o nome do usuário na coleção "users"
async function buscarNomeDoUsuario(userId) {
  const db = client.db(process.env.DONNA_DB_NAME || "donna");
  const usuarios = db.collection("users");
  const usuario = await usuarios.findOne({ numero: userId });
  return usuario?.nome || "você";
}

// ✅ Função principal — gera e grava respostas
export async function obterResposta(pergunta, userId) {
  await initDB();

  const perguntaTrim = (pergunta || "").trim();
  if (!perguntaTrim) return "";

  const semanticMemory = client.db(process.env.DONNA_DB_NAME || "donna").collection("semanticMemory");

  const ontem = new Date();
  ontem.setDate(ontem.getDate() - 1);

  const palavrasChave = perguntaTrim.split(/\s+/).slice(0, 2).join("|");

  const registrosRecentes = await semanticMemory.find({
    userId,
    role: "user",
    content: new RegExp(palavrasChave, "i"),
    timestamp: { $gte: ontem }
  }).toArray();

  // 🔹 Observação removida para respostas repetidas
  const observacaoProativa = ""; // se quiser reativar, basta alterar aqui

  const existente = await respostas.findOne({ pergunta: perguntaTrim, userId });
  if (existente) {
    console.log(`💾 treinoDonna: resposta encontrada para "${perguntaTrim}" (usuário: ${userId})`);
    return existente.resposta;
  }

  const nomeUsuario = await buscarNomeDoUsuario(userId);

  const systemContent = `Você é Donna, assistente pessoal do Rafael. Use toda sua inteligência e combine conhecimentos dos papéis ativos (${papeisCombinados.length > 0 ? papeisCombinados.join(", ") : "nenhum"}).

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

    let respostaGerada = (completion.choices?.[0]?.message?.content || "").trim();
    if (!respostaGerada) respostaGerada = "Não consegui entender bem, pode reformular?";

    respostaGerada = `${nomeUsuario}, ${respostaGerada}${observacaoProativa}`;

    await respostas.insertOne({
      userId,
      pergunta: perguntaTrim,
      resposta: respostaGerada,
      papeis: papeisCombinados,
      criadoEm: new Date()
    });

    const sentimentoDetectado = detectarSentimento(perguntaTrim);

    await semanticMemory.insertMany([
      {
        userId,
        role: "user",
        content: perguntaTrim,
        sentimento: sentimentoDetectado,
        timestamp: new Date()
      },
      {
        userId,
        role: "assistant",
        content: respostaGerada,
        timestamp: new Date()
      }
    ]);

    console.log(`💬 treinoDonna: resposta gerada para "${perguntaTrim}" (usuário: ${userId})`);
    return respostaGerada;

  } catch (err) {
    console.error("❌ treinoDonna: erro ao chamar OpenAI ->", err);
    return "Desculpe, não consegui processar sua solicitação no momento.";
  }
}

// ✅ Função de treinamento manual
export async function treinarDonna(pergunta, resposta, userId) {
  await initDB();

  const p = (pergunta || "").trim();
  const r = (resposta || "").trim();
  if (!p) return;

  const exist = await respostas.findOne({ pergunta: p, userId });
  if (exist) {
    await respostas.updateOne(
      { pergunta: p, userId },
      { $set: { resposta: r, atualizadoEm: new Date(), papeis: papeisCombinados } }
    );
  } else {
    await respostas.insertOne({
      userId,
      pergunta: p,
      resposta: r,
      criadoEm: new Date(),
      papeis: papeisCombinados
    });
  }

  console.log(`📘 treinoDonna: treinada -> "${p}" => "${r}" (usuário: ${userId})`);
}

// ✅ Detecção simples de sentimento
function detectarSentimento(texto) {
  const t = texto.toLowerCase();

  if (t.includes("cansado") || t.includes("exausto")) return "cansaço";
  if (t.includes("feliz") || t.includes("animado")) return "alegria";
  if (t.includes("triste") || t.includes("desanimado")) return "tristeza";
  if (t.includes("ansioso") || t.includes("preocupado")) return "ansiedade";
  if (t.includes("irritado") || t.includes("estressado")) return "irritação";
  if (t.includes("motivado") || t.includes("focado")) return "motivação";

  return "neutro";
}
