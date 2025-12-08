// src/utils/generateSeniorTXT.js
import fs from "fs";
import path from "path";

/*
 Modelo básico para o Senior:
 1 Nome
 2 CPF
 3 Data de admissão (YYYY-MM-DD)
 4 Cargo
 5 Tipo de contrato
 6 Jornada
 7 Salário
 8 Setor
 9 Matrícula
*/

export function gerarArquivoSenior(dados) {
  const registro = [
    dados.nome,
    dados.cpf,
    dados.admissao,
    dados.cargo,
    dados.tipoContrato,
    dados.jornada,
    dados.salario,
    dados.setor,
    dados.matricula
  ].join("|");

  const nomeArquivo = `senior_${dados.cpf}.txt`;
  const filePath = path.join("generated", nomeArquivo);

  // cria pasta se não existir
  if (!fs.existsSync("generated")) {
    fs.mkdirSync("generated");
  }

  fs.writeFileSync(filePath, registro, "utf-8");
  return filePath;
}
