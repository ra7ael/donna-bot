import { tavily } from "@tavily/core";

const tvly = tavily(process.env.TAVILY_API_KEY);

export async function pesquisarWeb(query) {
  try {
    const response = await tvly.search(query, {
      searchDepth: "advanced", 
      maxResults: 5,           
      includeAnswer: true      
    });

    // Formata o conteúdo para a Amber ler com clareza
    const contextoBruto = response.results.map(r => 
      `MANCHETE: ${r.title}\nCONTEÚDO: ${r.content}\nFONTE: ${r.url}`
    ).join("\n\n---\n\n");

    return {
      resumo: response.answer,
      contexto: contextoBruto
    };
  } catch (error) {
    console.error("❌ Erro na busca Tavily:", error);
    return null;
  }
}
