import { MongoClient } from "mongodb";
import OpenAI from "openai";

let client;
let respostas;
let connected = false;
let papeisCombinados = [];

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

// Busca o nome do usuário pela coleção "users"
async function buscarNomeDoUsuario(userId) {
  const db = client.db(process.env.DONNA_DB_NAME || "donna");
  const usuarios = db.collection("users");
  const usuario = await usuarios.findOne({ numero: userId });
  return usuario?.nome || "você";
}

export async function obterResposta(pergunta, userId) {
  await initDB();
  const perguntaTrim = (pergunta || "").trim();
  if (!perguntaTrim) return "";

  const semanticMemory = client.db(process.env.DONNA_DB_NAME || "donna").collection("semanticMemory");

  const ontem = new Date();
  ontem.setDate(ontem.getDate() - 1);

  const palavrasChave = perguntaTrim.split(" ").slice(0, 3).join("|");

  const registrosRecentes = await semanticMemory.find({
    userId,
    role: "user",
    content: new RegExp(palavrasChave, "i"),
    timestamp: { $gte: ontem }
  }).toArray();

  let observacaoProativa = "";

  if (registrosRecentes.length > 0) {
    observacaoProativa = " (Você mencionou algo parecido ontem. Quer revisar o que disse?)";
  }

  const existente = await respostas.findOne({ pergunta: perguntaTrim, userId });
  if (existente) {
    console.log("treinoDonna: resposta encontrada no DB para pergunta ->", perguntaTrim, "(usuário:", userId + ")");
    return existente.resposta;
  }

  const nomeUsuario = await buscarNomeDoUsuario(userId);

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

    let respostaGerada = (completion.choices?.[0]?.message?.content || "").trim();

    if (observacaoProativa) {
      respostaGerada += observacaoProativa;
    }

    respostaGerada = `${nomeUsuario}, ${respostaGerada}`;

    await respostas.insertOne({
      userId,
      pergunta: perguntaTrim,
      resposta: respostaGerada,
      papeis: papeisCombinados,
      criadoEm: new Date()
    });

    const sentimentoDetectado = detectarSentimento(perguntaTrim);

    await semanticMemory.insertOne({
      userId,
      role: "user",
      content: perguntaTrim,
      sentimento: sentimentoDetectado,
      timestamp: new Date()
    });

    await semanticMemory.insertOne({
      userId,
      role: "assistant",
      content: respostaGerada,
      timestamp: new Date()
    });

    console.log("treinoDonna: memórias salvas na coleção semanticMemory");
    console.log("treinoDonna: gerada e salva resposta para ->", perguntaTrim, "(usuário:", userId + ")");
    return respostaGerada;
  } catch (err) {
    console.error("treinoDonna: erro ao chamar OpenAI ->", err);
    return "Desculpe, não consegui processar sua solicitação no momento.";
  }
}

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

  console.log(`treinoDonna: treinada -> "${p}" => "${r}" (usuário: ${userId})`);
}

function detectarSentimento(texto) {
  const textoLower = texto.toLowerCase();

  if (textoLower.includes("cansado") || textoLower.includes("exausto")) return "cansaço";
  if (textoLower.includes("feliz") || textoLower.includes("animado")) return "alegria";
  if (textoLower.includes("triste") || textoLower.includes("desanimado")) return "tristeza";
  if (textoLower.includes("ansioso") || textoLower.includes("preocupado")) return "ansiedade";
  if (textoLower.includes("irritado") || textoLower.includes("estressado")) return "irritação";
  if (textoLower.includes("motivado") || textoLower.includes("focado")) return "motivação";

  return "neutro";
}
