// src/modules/empresasModule.js
import fs from "fs";
import XLSX from "xlsx";

const FILE_PATH = "./data/empresas.xlsx";

export function loadEmpresas() {
  if (!fs.existsSync(FILE_PATH)) {
    return [];
  }

  const workbook = XLSX.readFile(FILE_PATH);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet);
}

export function saveEmpresas(data) {
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Empresas");

  XLSX.writeFile(workbook, FILE_PATH);
}

export function findEmpresa(query) {
  const empresas = loadEmpresas();
  const term = query.toLowerCase();

  return empresas.filter(e =>
    Object.values(e).some(v =>
      String(v || "").toLowerCase().includes(term)
    )
  );
}

export function updateEmpresa(codigo, campo, valor) {
  const empresas = loadEmpresas();
  const empresa = empresas.find(e => String(e.CODIGO) === String(codigo));

  if (!empresa) return false;

  empresa[campo] = valor;

  saveEmpresas(empresas);
  return empresa;
}

export function addEmpresa(nova) {
  const empresas = loadEmpresas();
  empresas.push(nova);
  saveEmpresas(empresas);
  return nova;
}
