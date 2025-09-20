import cron from "node-cron";
import { sendMessage } from "./whatsapp.js"; // ajusta o caminho se teu sendMessage estiver em outro lugar

// Exemplo de lembrete diário às 9h
cron.schedule("0 9 * * *", () => {
  sendMessage("554195194485", "🌞 Bom dia, Rafa! Não esquece de revisar seus cadastros hoje 🚀");
  console.log("✅ Lembrete diário enviado às 9h");
});

// Outro exemplo: toda segunda às 8h
cron.schedule("0 8 * * 1", () => {
  sendMessage("554195194485", "📌 Rafa, hoje é segunda! Bora começar a semana sem erros de cadastro?");
});
