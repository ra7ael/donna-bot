/* ========================= DETECTOR DE FAMÍLIA ========================= */

const FAMILIA = [
  { nome: "Carolina", genero: "f" },
  { nome: "Nicolli", genero: "f" },
  { nome: "Miguel", genero: "m" }
];

export function detectarFamilia(texto) {
  const t = texto.toLowerCase();

  return FAMILIA.find(p => {
    const artigo = p.genero === "f" ? "a" : "o";
    return t.includes(`${artigo} ${p.nome.toLowerCase()}`);
  }) || null;
}
