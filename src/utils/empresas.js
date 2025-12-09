// src/utils/empresas.js
import XLSX from "xlsx";
import path from "path";
import fs from "fs";

const filePath = path.resolve("src/data/empresas.xlsx");

/* ===========================================================
   Carrega a planilha em formato JSON
=========================================================== */
export function loadSheet() {
  if (!fs.existsSync(filePath)) {
    throw new Error("Arquivo empresas.xlsx não encontrado!");
  }

  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  return XLSX.utils.sheet_to_json(sheet, { defval: "" });
}

/* ===========================================================
   Salva o JSON de volta na planilha XLSX
=========================================================== */
export function saveSheet(json) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];

  const newSheet = XLSX.utils.json_to_sheet(json);
  workbook.Sheets[sheetName] = newSheet;

  XLSX.writeFile(workbook, filePath);
}

/* ===========================================================
   Busca flexível por nome, código, ou qualquer coluna
=========================================================== */
export function buscarEmpresa(query) {
  const empresas = loadSheet();
  const q = query.toLowerCase();

  return empresas.filter(e =>
    Object.values(e)
      .some(v => String(v).toLowerCase().includes(q))
  );
}

/* ===========================================================
   Adiciona empresa com TODAS as colunas (mesmo vazias)
=========================================================== */
export function adicionarEmpresa(dados) {
  const empresas = loadSheet();

  empresas.push({
    CODIGO: dados.codigo || "",
    EMPRESAS: dados.empresa || "",
    BENEFICIOS_PELA_SE: dados.beneficios || "",
    VT_E_DESCONTO: dados.vt || "",
    VR_E_DESCONTO: dados.vr || "",
    VA: dados.va || "",
    OBSERVAÇÃO: dados.observacao || "",
    PAGAMENTO: dados.pagamento || "",
    ADIANTAMENTO: dados.adiantamento || "",
    CARTAO_PONTO: dados.cartaoPonto || "",
    FECHA_FOLHA: dados.fechaFolha || ""
  });

  saveSheet(empresas);
}

/* ===========================================================
   Atualiza apenas uma coluna da empresa
   Ex: atualizarCampo("Alpha", "PAGAMENTO", "05")
=========================================================== */
export function atualizarCampo(nomeEmpresa, campo, valor) {
  const empresas = loadSheet();

  const empresa = empresas.find(
    e => String(e.EMPRESAS).toLowerCase() === nomeEmpresa.toLowerCase()
  );

  if (!empresa) return false;

  if (!(campo in empresa)) {
    console.log("⚠ Campo não existe na planilha:", campo);
    return false;
  }

  empresa[campo] = valor;

  saveSheet(empresas);

  return true;
}

/* ===========================================================
   Formata bonitinho para enviar no WhatsApp
=========================================================== */
export function formatarEmpresa(e) {
  return `
🏢 ${e.EMPRESAS}
🔢 Código: ${e.CODIGO}

Benefícios pela SE: ${e.BENEFICIOS_PELA_SE}
VT: ${e.VT_E_DESCONTO}
VR: ${e.VR_E_DESCONTO}
VA: ${e.VA}

Pagamento: ${e.PAGAMENTO}
Adiantamento: ${e.ADIANTAMENTO}
Cartão ponto: ${e.CARTAO_PONTO}
Fecha folha: ${e.FECHA_FOLHA}

Obs: ${e.OBSERVAÇÃO}
`.trim();
}
