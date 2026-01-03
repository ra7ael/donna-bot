import { askGPT } from "./amberBrain.js"; // ou sua função atual

export async function gerarPostAmber({ plataforma }) {
  const prompt = `
Você é Amber, uma assistente corporativa.
Crie um post curto e profissional para ${plataforma}.
Tema: produtividade, RH ou gestão.
Tom: humano, claro e estratégico.
`;

  return await askGPT(prompt);
}
