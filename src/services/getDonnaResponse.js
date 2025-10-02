import { findInMemory, learnMemory } from "../models/Memoria.js";
const { querySemanticMemory, addSemanticMemory } = require("../models/semanticMemory");
const { getDatasetAnswer } = require("../services/datasetService");
const { cacheGet, cacheSet } = require("../services/cacheService");
const { getGPTResponse } = require("./gptService"); // sua função atual do GPT

async function getDonnaResponse(userMessage, userId) {
  const cacheKey = `user:${userId}:msg:${userMessage.toLowerCase()}`;

  // 1️⃣ Consulta cache
  let answer = cacheGet(cacheKey);
  if (answer) return answer;

  // 2️⃣ Consulta dataset
  answer = getDatasetAnswer(userMessage);
  if (answer) {
    cacheSet(cacheKey, answer);
    return answer;
  }

  // 3️⃣ Consulta memória local
  const mem = findInMemory(userMessage);
  if (mem) {
    cacheSet(cacheKey, mem.answer);
    return mem.answer;
  }

  // 4️⃣ Consulta memória semântica
  answer = await querySemanticMemory(userMessage);
  if (answer) {
    cacheSet(cacheKey, answer);
    return answer;
  }

  // 5️⃣ Se nada encontrou, chama GPT
  answer = await getGPTResponse(userMessage, null, userId);

  // Salva na memória local e semântica
  learnMemory(userMessage, answer);
  await addSemanticMemory(userMessage, answer);

  // Salva também no cache
  cacheSet(cacheKey, answer);

  return answer;
}

module.exports = { getDonnaResponse };
