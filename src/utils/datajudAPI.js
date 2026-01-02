import axios from "axios";

const API_URL = "https://api.datajud.gov.br/v1"; // substitua pela URL real da API

export async function consultarDataJud(query) {
  try {
    const response = await axios.get(`${API_URL}/pesquisa`, {
      params: { q: query }, // ou o parâmetro que a API exige
      headers: {
        "Authorization": "APIKey cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==",
        "Content-Type": "application/json"
      }
    });

    if (response.data && response.data.resultados) {
      return response.data.resultados.slice(0, 5); // retorna até 5 resultados
    }
    return [];
  } catch (err) {
    console.error("❌ Erro ao consultar DataJud:", err);
    return [];
  }
}
