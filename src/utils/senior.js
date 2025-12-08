import fs from "fs";
import path from "path";

export function gerarArquivoSenior(dados) {
  const pasta = "generated";

  // cria pasta se faltar
  if (!fs.existsSync(pasta)) {
    fs.mkdirSync(pasta);
  }

  const fileName = `senior_${dados.cpf}.txt`;
  const filePath = path.join(pasta, fileName);

  const conteudo =
`NOME=${dados.nome}
CPF=${dados.cpf}
CARGO=${dados.cargo}
ADMISSAO=${dados.admissao}
TIPO_CONTRATO=${dados.tipoContrato}
JORNADA=${dados.jornada}
SALARIO=${dados.salario}
SETOR=${dados.setor}
MATRICULA=${dados.matricula}
`;

  fs.writeFileSync(filePath, conteudo, { encoding: "utf8" });

  return filePath;
}
