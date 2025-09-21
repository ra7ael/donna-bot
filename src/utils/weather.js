// src/utils/weather.js
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const OPENWEATHER_KEY = process.env.OPENWEATHER_API_KEY; // coloque sua chave no .env

export async function getWeather(city) {
  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${OPENWEATHER_KEY}&units=metric&lang=pt_br`;
    const response = await axios.get(url);
    const data = response.data;

    const temp = data.main.temp.toFixed(1);
    const desc = data.weather[0].description;
    const humidity = data.main.humidity;
    const wind = data.wind.speed;

    return `🌤 Clima em ${data.name}: ${desc}, 🌡 ${temp}°C, 💧 Umidade: ${humidity}%, 💨 Vento: ${wind} m/s`;
  } catch (err) {
    console.error("❌ Erro ao buscar clima:", err.response?.data || err);
    return "Não consegui obter a previsão do tempo agora 😅";
  }
}
