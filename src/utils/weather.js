// src/utils/weather.js
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;

export async function getWeather(city) {
  if (!OPENWEATHER_API_KEY) return "❌ Chave da API de clima não configurada.";

  try {
    // Ajusta a cidade: remove espaços extras e normaliza acentos
    const normalizedCity = city.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(normalizedCity)}&appid=${OPENWEATHER_API_KEY}&units=metric&lang=pt_br`;
    const response = await axios.get(url);
    const data = response.data;

    const temp = data.main.temp.toFixed(1);
    const description = data.weather[0].description;
    const humidity = data.main.humidity;
    const wind = data.wind.speed;

    return `🌤️ Clima em ${data.name}:
Temperatura: ${temp}°C
Condição: ${description}
Umidade: ${humidity}%
Vento: ${wind} m/s`;
  } catch (err) {
    if (err.response?.status === 404) return `❌ Não encontrei a cidade "${city}". Verifique a grafia.`;
    console.error("Erro getWeather:", err.response?.data || err.message);
    return "❌ Não consegui obter a previsão do tempo agora 😅";
  }
}
