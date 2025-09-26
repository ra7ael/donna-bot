// src/utils/gpt.js
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();
const GPT_API_KEY = process.env.OPENAI_API_KEY;

export async function askGPT(prompt, history = []) {
  const safeMessages = history
    .map(m => ({ role: m.role, content: typeof m.content === "string" ? m.content : "" }))
    .filter(m => m.content.trim() !== "");
  safeMessages.push({ role: "user", content: prompt || "" });

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      { model: "gpt-5-mini", messages: safeMessages },
      { headers: { Authorization: `Bearer ${GPT_API_KEY}`, "Content-Type": "application/json" } }
    );
    return response.data.choices?.[0]?.message?.content || "Hmm… ainda estou pensando!";
  } catch (err) {
    console.error("❌ Erro GPT:", err.response?.data || err);
    return "Hmm… ainda estou pensando!";
  }
}
