import axios from "axios";

export async function getWeather(city) {
  try {
    const apiKey = process.env.WEATHER_API_KEY;
    const res = await axios.get(`https://api.openweathermap.org/data/2.5/weather`, {
      params: {
        q: city,
        appid: apiKey,
        units: "metric",
        lang: "pt_br"
      }
    });

    const data = res.data;
    return `🌤️ Clima em ${data.name}: ${data.weather[0].description}, temperatura ${data.main.temp}°C, sensação ${data.main.feels_like}°C.`;
  } catch (err) {
    console.error("❌ Erro ao buscar clima:", err.response?.data || err.message);
    return "❌ Não consegui obter o clima agora.";
  }
}
