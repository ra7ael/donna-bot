// src/utils/handleEmpresa.js
import fs from "fs";
import XLSX from "xlsx";
import path from "path";

// Caminho da pasta e arquivo
const folderPath = path.resolve("src/data");
const filePath = path.join(folderPath, "empresas.xlsx");

// Garante que a pasta e o arquivo existam
function ensureFile() {
  // Cria pasta caso não exista
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }

  // Cria o arquivo caso não exista
  if (!fs.existsSync(filePath)) {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet([]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Empresas");
    XLSX.writeFile(workbook, filePath);
  }
}

// Lê todas as empresas
export function listarEmpresas() {
  ensureFile();
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const dados = XLSX.utils.sheet_to_json(sheet);
  return dados;
}

// Buscar empresa
export function buscarEmpresa(termo) {
  termo = termo.toLowerCase();
  const empresas = listarEmpresas();

  return empresas.filter(e =>
    (e.CODIGO || "").toLowerCase().includes(termo) ||
    (e.EMPRESA || "").toLowerCase().includes(termo)
  );
}

// Adicionar empresa
export function adicionarEmpresa(data) {
  ensureFile();

  const lista = listarEmpresas();
  lista.push(data);

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(lista);
  XLSX.utils.book_append_sheet(workbook, sheet, "Empresas");
  XLSX.writeFile(workbook, filePath);
}

// Formata a resposta enviada pelo WhatsApp
export function formatarEmpresa(e) {
  return `
Código: ${e.CODIGO || "-"}
Empresa: ${e.EMPRESA || "-"}
Benefícios: ${e.BENEFICIOS || "-"}
VT: ${e.VT || "-"}
VR: ${e.VR || "-"}
VA: ${e.VA || "-"}
OBS: ${e.OBS || "-"}
  `.trim();
}
