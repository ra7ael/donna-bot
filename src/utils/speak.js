// src/utils/speak.js
import fs from "fs";
import path from "path";
import axios from "axios";
import FormData from "form-data";
import OpenAI from "openai";

// Garantir que env já esteja carregado sem erro caso o caminho não exista
try {
  await import("../config/env.js");
} catch {
  console.warn("⚠️ Configuração env.js não encontrada ou já carregada.");
}

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function falar(texto, arquivoSaida = "./audios/output.mp3") {
  if (!texto?.trim()) return null;

  try {
    const response = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "sage",
      input: texto,
    });

    const audioBuffer = Buffer.from(await response.arrayBuffer());

    const dir = path.dirname(arquivoSaida);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(arquivoSaida, audioBuffer);

    return arquivoSaida;
  } catch (err) {
    console.error("❌ Falha ao gerar áudio TTS:", err?.message || err);
    return
