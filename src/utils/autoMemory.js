import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function extractAutoMemory(message) {
  try {
    const prompt = `
Analise a frase abaixo e determine se ela contém alguma informação pessoal relevante que deveria ser armazenada como memória permanente.

SE tiver algo útil, responda APENAS no seguinte formato JSON:
{
  "key": "nome_da_informacao",
  "value": "conteudo_a_ser_memorizado"
}

Se NÃO houver nada importante, responda APENAS:
null

Aqui está a frase:
"${message}"
`;

    const result = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
    });

    let content = result.choices[0].message.content.trim();
    if (content === "null") return null;

    return JSON.parse(content);
  } catch (err) {
    console.error("❌ ERRO autoMemory:", err);
    return null;
  }
}

