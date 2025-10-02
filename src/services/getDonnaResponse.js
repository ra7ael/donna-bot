import { findInMemory, learnMemory } from "../models/Memoria.js";
import { querySemanticMemory, addSemanticMemory } from "../models/semanticMemory.js";
import { getDatasetAnswer } from "./datasetService.js";
import { cacheGet, cacheSet } from "./cacheService.js";
import { getGPTResponse } from "./gptService.js";
import { getUserName } from "../models/user.js";
import { getPapeis } from "../utils/treinoDonna.js";

export async function getDonnaResponse(userMessage, userId) {
  const prompt = userMessage.trim();
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

  // 3️⃣ Memória local
  const localMemory = findInMemory(prompt);
  if (localMemory) {
    cacheSet(cacheKey, localMemory.answer);
    return localMemory.answer;
  }

  // 4️⃣ Memória semântica
  const semanticAnswer = await querySemanticMemory(prompt, userId);
  if (semanticAnswer) {
    cacheSet(cacheKey, semanticAnswer);
    return semanticAnswer;
  }

  // 5️⃣ GPT com contexto personalizado
  const nome = await getUserName(userId);
  const papeis = getPapeis();
  const systemMessage = {
    role: "system",
    content: `Você é Donna, assistente pessoal de ${nome || "usuário"}.
- Papéis ativos: ${papeis.length ? papeis.join(", ") : "nenhum"}.
- Seja objetiva, prática e acolhedora.
- Use até 2 frases por resposta.
- Se o tema for saúde, inclua: "Consulte um especialista.".
- Nunca invente informações.`
  };

  const messages = [systemMessage, { role: "user", content: prompt }];
  const gptAnswer = await getGPTResponse(messages);

  // Aprendizado
  learnMemory(prompt, gptAnswer);
  await addSemanticMemory(prompt, gptAnswer, userId);
  cacheSet(cacheKey, gptAnswer);

  return gptAnswer;
}

