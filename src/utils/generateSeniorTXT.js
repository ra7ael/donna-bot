import fs from "fs";
import path from "path";

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

  // caminho absoluto usando __dirname
  const dirPath = path.join(process.cwd(), "generated"); // ou __dirname se preferir
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath);

  const filePath = path.join(dirPath, nomeArquivo);
  fs.writeFileSync(filePath, registro, "utf-8");

  return filePath;
}
