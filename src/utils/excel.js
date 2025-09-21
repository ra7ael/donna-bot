import XLSX from "xlsx";
import fs from "fs";

export function readExcel(filePath, sheetName = null) {
  try {
    if (!fs.existsSync(filePath)) {
      console.error("❌ Arquivo não encontrado:", filePath);
      return [];
    }

    const workbook = XLSX.readFile(filePath);
    const sheet = sheetName || workbook.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheet], { header: 1 });
    return data; // retorna array de arrays
  } catch (err) {
    console.error("❌ Erro ao ler Excel:", err);
    return [];
  }
}
