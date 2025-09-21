import axios from "axios";
import { DateTime } from "luxon";

const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;

export async function getWeather(city, when = "hoje") {
  try {
    const encodedCity = encodeURIComponent(city);

    // Tempo atual
    if (when === "hoje") {
      const resp = await axios.get(
        `https://api.openweathermap.org/data/2.5/weather?q=${encodedCity}&appid=${OPENWEATHER_API_KEY}&lang=pt_br&units=metric`
      );
      const data = resp.data;
      return `🌤️ Hoje em ${data.name}: ${data.weather[0].description}, ${data.main.temp}°C.`;
    }

    // Previsão (amanhã ou data específica)
    const forecastResp = await axios.get(
      `https://api.openweathermap.org/data/2.5/forecast?q=${encodedCity}&appid=${OPENWEATHER_API_KEY}&lang=pt_br&units=metric`
    );
    const forecastList = forecastResp.data.list;

    let targetDate;
    if (when === "amanhã") {
      targetDate = DateTime.now().plus({ days: 1 }).toISODate();
    } else {
      // formato dd/mm ou dd/mm/yyyy
      const parts = when.split("/");
      const year = parts.length === 3 ? parts[2] : DateTime.now().year;
      targetDate = DateTime.fromFormat(`${parts[0]}/${parts[1]}/${year}`, "dd/LL/yyyy").toISODate();
    }

    // procura previsão mais próxima do meio-dia
    const forecast = forecastList.find(f => {
      const fDate = DateTime.fromSeconds(f.dt).toISODate();
      return fDate === targetDate && f.dt_txt.includes("12:00:00");
    });

    if (forecast) {
      return `📅 Previsão para ${when} em ${forecastResp.data.city.name}: ${forecast.weather[0].description}, ${forecast.main.temp}°C.`;
    } else {
      return `⚠️ Não encontrei previsão para ${when} em ${city}.`;
    }
  } catch (err) {
    console.error("❌ Erro OpenWeather:", err.response?.data || err);
    return "Não consegui obter a previsão do tempo agora 😅";
  }
}
