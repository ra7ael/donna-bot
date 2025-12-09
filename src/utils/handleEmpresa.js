// src/utils/handleEmpresa.js
import {
  findEmpresa,
  updateEmpresa,
  addEmpresa
} from "../modules/empresasModule.js";

export async function handleEmpresaIntent(message) {
  const text = message.toLowerCase();

  // Buscar empresa
  if (text.startsWith("buscar empresa")) {
    const termo = text.replace("buscar empresa", "").trim();
    const results = findEmpresa(termo);

    if (results.length === 0) return "Nenhuma empresa encontrada.";

    return results
      .map(e => 
        `Código: ${e.CODIGO}
Empresa: ${e.EMPRESA}
Benefícios: ${e["BENEFICIOS PELA SE"]}
VT: ${e["VT E DESCONTO"]}
VR: ${e["VR E DESCONTO"]}
VA: ${e.VA}
Cartão ponto: ${e.CARTAO_PONTO || "Não informado"}
Fechamento folha: ${e.FECHAMENTO_FOLHA || "Não informado"}
Obs: ${e.OBSERVAÇÃO || "—"}`
      )
      .join("\n\n");
  }

  // Atualizar campo
  if (text.startsWith("empresa atualizar")) {
    const [, , codigo, campo, ...valorArray] = text.split(" ");
    const valor = valorArray.join(" ");

    const empresa = updateEmpresa(codigo, campo.toUpperCase(), valor);

    if (!empresa) return "Empresa não encontrada.";

    return `Atualizado com sucesso!
${campo}: ${valor}`;
  }

  // Adicionar nova
  if (text.startsWith("empresa adicionar")) {
    const partes = text.replace("empresa adicionar", "").trim().split(";");
    const nova = {
      CODIGO: partes[0],
      EMPRESA: partes[1],
      OBSERVAÇÃO: partes[2] || "",
    };

    addEmpresa(nova);

    return "Empresa adicionada com sucesso.";
  }

  return null;
}
