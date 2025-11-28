// src/utils/weather.js
import axios from "axios";
import { DateTime } from "luxon";

const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;

export async function getWeather(city, when = "hoje") {
  if (!OPENWEATHER_API_KEY) {
    console.warn("⚠️ OPENWEATHER_API_KEY não definida");
    return "⚠️ Serviço de clima não configurado.";
  }

  try {
    const encodedCity = encodeURIComponent(city);

    // ===== Tempo atual =====
    if (when === "hoje") {
      const resp = await axios.get(
        `https://api.openweathermap.org/data/2.5/weather?q=${encodedCity}&appid=${OPENWEATHER_API_KEY}&lang=pt_br&units=metric&units=metric`
      );
      const data = resp.data;

      return `🌤️ Hoje em ${data.name}: ${data.weather?.[0]?.description || "indisponível"}, ${data.main?.temp ?? "--"}°C.`;
    }

    // ===== Previsão futura =====
    const forecastResp = await axios.get(
      `https://api.openweathermap.org/data/2.5/forecast?q=${encodedCity}&appid=${OPENWEATHER_API_KEY}&lang=pt_br&units=metric`
    );

    const forecastList = forecastResp.data.list || [];
    if (!forecastList.length) {
      return `⚠️ Previsões não retornadas para ${city}.`;
    }

    // Determinar data alvo
    let targetDate;
    if (when === "amanhã") {
      targetDate = DateTime.now().plus({ days: 1 }).toISODate();
    } else {
      const parts = when.split("/");
      const year = parts.length === 3 ? parts[2] : DateTime.now().year;
      const formatted = `${parts[0]}/${parts[1]}/${year}`;
      const dt = DateTime.fromFormat(formatted, "dd/LL/yyyy");

      if (!dt.isValid) {
        return `⚠️ Data inválida (${when}). Use DD/MM ou DD/MM/AAAA.`;
      }

      targetDate = dt.toISODate();
    }

    // Buscar previsão mais próxima do meio-dia
    const forecast = forecastList.find(f => {
      const fDate = DateTime.fromSeconds(f.dt).toISODate();
      return fDate === targetDate && (f.dt_txt || "").includes("12:00:00");
    });

    if (forecast) {
      const nomeCidade = forecastResp.data.city?.name || city;
      const desc = forecast.weather?.[0]?.description || "indisponível";
      const temp = forecast.main?.temp ?? "--";

      return `📅 Previsão para ${when} em ${nomeCidade}: ${desc}, ${temp}°C.`;
    }

    return `⚠️ Não encontrei previsão para ${when} em ${city}.`;
  } catch (err) {
    console.error("❌ Falha clima:", err.response?.data || err.message || err);
    return "☁️ Ops, não consegui consultar o clima no momento.";
  }
}
