import { querySemanticMemory, addSemanticMemory } from "../models/semanticMemory.js";
import { getDatasetAnswer } from "./datasetService.js";
import { cacheGet, cacheSet } from "./cacheService.js";
import { getGPTResponse } from "./gptService.js";
import { getUserName } from "../models/user.js";
import { getPapeis } from "../utils/treinoDonna.js";

/** 
 * Busca nome salvo em memória semântica ("O nome do usuário é X")
 */
async function getUserNameFromMemory(userId) {
  const memory = await querySemanticMemory("O nome do usuário é", userId, 3);
  if (memory) {
    const match = memory.match(/O nome do usuário é\s+([^\s.]+)/i);
    return match ? match[1] : null;
  }
  return null;
}

/**
 * Principal gerador de resposta da Donna
 */
export async function getDonnaResponse(userMessage, userId, conversationContext = "", memoryContext = "") {
  const prompt = userMessage?.trim();
  if (!prompt) return "Não entendi o que você quis dizer.";

  const cacheKey = `user:${userId}:msg:${prompt.toLowerCase()}`;

  // 1️⃣ Cache
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  // 2️⃣ Dataset
  const datasetAnswer = getDatasetAnswer(prompt);
  if (datasetAnswer) {
    cacheSet(cacheKey, datasetAnswer);
    return datasetAnswer;
  }

  // 3️⃣ Verifica se o usuário informou seu nome ("meu nome é X")
  let userName = await getUserNameFromMemory(userId);
  if (!userName && /meu nome é/i.test(prompt)) {
    const match = prompt.match(/meu nome é\s+([^\s.]+)/i);
    if (match) {
      userName = match[1];
      await addSemanticMemory(prompt, `O nome do usuário é ${userName}.`, userId, "user");
      console.log(`💾 Nome aprendido: ${userName}`);
      return `Prazer, ${userName}! Vou lembrar disso.`;
    }
  }

  // 4️⃣ Se perguntar "qual meu nome"
  if (/qual (é )?meu nome/i.test(prompt)) {
    if (userName) {
      return `Seu nome é ${userName}!`;
    } else {
      return "Ainda não sei seu nome. Diga: 'meu nome é [seu nome]'.";
    }
  }

  // 5️⃣ Busca em memória semântica
let semanticAnswer = await querySemanticMemory(prompt, userId);
if (semanticAnswer) {
  // querySemanticMemory pode retornar array ou string
  if (Array.isArray(semanticAnswer)) semanticAnswer = semanticAnswer[0];
  if (semanticAnswer) {
    cacheSet(cacheKey, semanticAnswer);
    return semanticAnswer;
  }
}

  // 6️⃣ GPT com contexto personalizado
  const nome = userName || (await getUserName(userId));
  const papeis = getPapeis();

  const systemMessage = {
    role: "system",
    content: `Você é Donna, assistente pessoal de ${nome || "usuário"}.
- Papéis ativos: ${papeis.length ? papeis.join(", ") : "nenhum"}.
- Seja objetiva, prática e acolhedora.
- Use até 2 frases por resposta.
- Se o tema for saúde, inclua: "Consulte um especialista."
- Nunca invente informações.`
  };

  const messages = [
    systemMessage,
    ...(memoryContext ? [{ role: "system", content: `Memórias relevantes:\n${memoryContext}` }] : []),
    ...(conversationContext ? [{ role: "system", content: `Histórico recente:\n${conversationContext}` }] : []),
    { role: "user", content: prompt }
  ];

  const gptAnswer = await getGPTResponse(messages);

  // 7️⃣ Armazenamento na memória semântica
  await addSemanticMemory(prompt, gptAnswer, userId, "user");
  await addSemanticMemory(prompt, gptAnswer, userId, "assistant");
  cacheSet(cacheKey, gptAnswer);

  return gptAnswer;
}

