import axios from "axios";

export async function gerarPostAmber({ plataforma, persona, objetivo }) {
  const prompt = `
Você é Amber, uma assistente corporativa digital.
Crie um post curto para ${plataforma}.

Persona: ${persona}
Objetivo: ${objetivo}

Regras:
- Linguagem profissional e humana
- 2 a 4 parágrafos curtos
- Pode usar emojis com moderação
- Nada de hashtags excessivas
`;

  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 300
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      }
    }
  );

  return response.data.choices[0].message.content.trim();
}

