import axios from "axios";

export async function buscarNoticiasComIA(tema, askGPT) {
  const apiKey = process.env.NEWS_API_KEY;
  const query = tema || "tecnologia e inovação";
  
  // Buscamos notícias em português
  const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&language=pt&sortBy=relevancy&pageSize=5&apiKey=${apiKey}`;

  try {
    const response = await axios.get(url);
    const articles = response.data.articles;

    if (!articles || articles.length === 0) {
      return "Não encontrei novidades relevantes sobre esse tema no momento.";
    }

    // Criamos um bloco de texto com os títulos e descrições para a IA ler
    const contextoNoticias = articles.map((art, i) => 
      `Manchete ${i+1}: ${art.title}\nResumo: ${art.description}\nFonte: ${art.source.name}\n---`
    ).join("\n");

    const promptIA = `
      Você é a Amber, uma analista de informações sofisticada. 
      Recebi as seguintes notícias sobre "${query}":
      
      ${contextoNoticias}
      
      Sua tarefa:
      1. Faça um resumo executivo de 2 a 3 parágrafos conectando os pontos principais dessas notícias.
      2. Use um tom profissional e inteligente.
      3. Ao final, liste apenas os links das 3 notícias mais importantes com o título.
    `;

    const resumoIA = await askGPT(promptIA);
    return resumoIA;

  } catch (error) {
    console.error("❌ Erro no NewsModule:", error.message);
    return "Houve um erro ao acessar o feed de notícias. Tente novamente em instantes.";
  }
}
