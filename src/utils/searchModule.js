import { tavily } from "@tavily/core";

// No JS, a forma mais estável de instanciar é esta:
const tvly = tavily(process.env.TAVILY_API_KEY);

export async function pesquisarWeb(query) {
  try {
    // A documentação exige que o campo 'query' seja uma string não vazia
    if (!query || query.trim().length < 3) return null;

    const response = await tvly.search(query, {
      searchDepth: "advanced",
      maxResults: 5,
      includeAnswer: true,
      topic: "general" 
    });

    // IMPORTANTE: Verifique se a resposta tem resultados
    if (!response || !response.results || response.results.length === 0) {
      console.log("⚠️ Tavily: Nenhum resultado encontrado para:", query);
      return null;
    }

    return {
      resumo: response.answer || "Informação encontrada nos resultados abaixo.",
      contexto: response.results.map(r => `FONTE: ${r.title}\nCONTEÚDO: ${r.content}\nURL: ${r.url}`).join("\n\n")
    };
  } catch (error) {
    console.error("❌ Erro técnico na Tavily:", error.message);
    return null;
  }
}
