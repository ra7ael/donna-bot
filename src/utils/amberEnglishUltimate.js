import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Armazena contexto da conversa por usuário
const conversationMemory = {};

export async function amberEnglishUltimate({ userId, pergunta, level = "beginner", userSentence = null }) {
  // Inicializa memória se não existir
  if (!conversationMemory[userId]) conversationMemory[userId] = [];

  let prompt = "";

  // Se for exercício
  if (userSentence) {
    prompt = `You are Amber, a friendly English teacher. Correct the sentence: "${userSentence.text}" and explain mistakes clearly. Target word/grammar: "${userSentence.targetWord}"`;
  } else {
    // Conversa normal ou pedido de exercícios
    prompt = `
You are Amber, a smart English mentor teaching a ${level} student.
You will:
- Respond in English with natural conversation
- Correct mistakes politely
- Provide small exercises when relevant
- Keep previous conversation context

Conversation so far:
${conversationMemory[userId].map(c => `${c.role}: ${c.text}`).join("\n")}

User: ${pergunta}
Amber:`;
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are Amber, an English teacher and mentor." },
        { role: "user", content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 400
    });

    const answer = response.choices[0].message.content.trim();

    // Salva na memória
    conversationMemory[userId].push({ role: "user", text: pergunta });
    conversationMemory[userId].push({ role: "assistant", text: answer });

    return answer;

  } catch (err) {
    console.error("Amber Error:", err);
    return "Sorry, there was an error. Please try again.";
  }
}
