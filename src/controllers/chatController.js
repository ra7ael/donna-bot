import { OpenAI } from "openai";
import { buscarMemoria, salvarMemoria } from "../utils/memoryManager.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function chat(req, res) {
  try {
    const { userId, mensagem } = req.body;

    // 1. Buscar memória existente do usuário
    const memoria = await buscarMemoria(userId);

    // 2. Montar contexto para o modelo
    const contexto = memoria
      ? `Informações conhecidas sobre ${memoria.memoria.nome || "o usuário"}: 
${JSON.stringify(memoria.memoria, null, 2)}`
      : "Sem informações anteriores sobre o usuário.";

    // 3. Criar prompt
    const prompt = `
Você é um assistente pessoal.
Aqui está a memória do usuário:
${contexto}

Mensagem do usuário: "${mensagem}"
Responda de forma útil e coerente.
    `;

    // 4. Chamar API OpenAI
    const resposta = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
    });

    const respostaBot = resposta.choices[0].message.content;

    // 5. Atualizar memória com algo novo (exemplo simples: salvar última mensagem)
    await salvarMemoria(userId, { ultimaMensagem: mensagem });

    return res.json({ resposta: respostaBot });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ erro: "Erro no chat" });
  }
}
