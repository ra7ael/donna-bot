// src/utils/weather.js
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const WEATHER_API_KEY = process.env.OPENWEATHER_API_KEY; // sua chave OpenWeatherMap

export async function getWeather(city) {
  if (!WEATHER_API_KEY) return "❌ Chave de clima não configurada.";

  try {
    const response = await axios.get(
      `https://api.openweathermap.org/data/2.5/weather`,
      {
        params: {
          q: city,
          appid: WEATHER_API_KEY,
          units: "metric",
          lang: "pt_br"
        }
      }
    );

    const data = response.data;
    const temp = Math.round(data.main.temp);
    const description = data.weather[0].description;

    return `🌤️ ${data.name}: ${temp}°C, ${description}`;
  } catch (err) {
    console.error("❌ Erro ao buscar clima:", err.response?.data || err);
    return `❌ Não consegui obter o clima para "${city}".`;
  }
}
