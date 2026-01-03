import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function askGPT(prompt) {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "Você é Amber, uma assistente corporativa de RH." },
      { role: "user", content: prompt }
    ],
    temperature: 0.7
  });

  return response.choices[0].message.content.trim();
}
