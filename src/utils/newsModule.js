import axios from "axios";

export async function buscarNoticias(tema = "tecnologia") {
  const apiKey = process.env.NEWS_API_KEY;
  // Traduzimos alguns termos comuns para inglês para obter melhores resultados globais, 
  // mas pediremos o resumo em português.
  const query = tema === "tecnologia" ? "technology" : tema;
  
  const url = `https://newsapi.org/v2/top-headlines?q=${query}&language=pt&apiKey=${apiKey}`;

  try {
    const response = await axios.get(url);
    const articles = response.data.articles;

    if (!articles || articles.length === 0) {
      return "Não encontrei notícias recentes sobre esse tema agora.";
    }

    // Pegamos as 3 principais notícias
    const topNoticias = articles.slice(0, 3).map((art, i) => {
      return `${i + 1}. *${art.title}*\n🔗 ${art.url}`;
    }).join("\n\n");

    return `📰 *Principais notícias sobre ${tema}:*\n\n${topNoticias}`;
  } catch (error) {
    console.error("❌ Erro ao buscar notícias:", error.message);
    return "Tive um problema ao conectar com o portal de notícias.";
  }
}
