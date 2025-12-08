// src/utils/pontoDonna.js
import fs from "fs-extra";
import path from "path";
import XLSX from "xlsx";
import PDFDocument from "pdfkit";
import fetch from "node-fetch";
import FormData from "form-data";

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

/* ========================= FUNÇÕES DE WHATSAPP ========================= */
export async function enviarDocumentoWhatsApp(to, filePath, caption = "") {
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  // Upload
  const form = new FormData();
  form.append("file", fileBuffer, { filename: fileName });
  form.append("type", "document");

  const uploadRes = await fetch(`https://graph.facebook.com/v23.0/${WHATSAPP_PHONE_ID}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    body: form
  });

  const uploadData = await uploadRes.json();
  if (!uploadData.id) throw new Error("Upload falhou: " + JSON.stringify(uploadData));

  // Envio
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "document",
    document: { id: uploadData.id, filename: fileName, caption }
  };

  const sendRes = await fetch(`https://graph.facebook.com/v23.0/${WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const sendData = await sendRes.json();
  if (!sendRes.ok) throw new Error("Erro ao enviar documento: " + JSON.stringify(sendData));
  console.log(`✅ Documento enviado para ${to}: ${fileName}`);
  return sendData;
}

/* ========================= LER PLANILHA ========================= */
export function lerPlanilha(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet); // Array de objetos
}

/* ========================= AGRUPAR POR EMPRESA/FILIAL ========================= */
export function agruparPorEmpresaFilial(dados) {
  const agrupados = {};
  dados.forEach(emp => {
    const empresa = emp.EMPRESA || "SEM_EMPRESA";
    const filial = emp.FILIAL || "SEM_FILIAL";
    if (!agrupados[empresa]) agrupados[empresa] = {};
    if (!agrupados[empresa][filial]) agrupados[empresa][filial] = [];
    agrupados[empresa][filial].push(emp);
  });
  return agrupados;
}

/* ========================= GERAR PDF ========================= */
export function gerarPDFFuncionario(emp, empresa, filial) {
  const dir = path.join("temp", empresa, filial);
  fs.ensureDirSync(dir);

  const fileName = `${emp.NOME.replace(/\s+/g, "_")}_${emp.CPF}.pdf`;
  const filePath = path.join(dir, fileName);

  const doc = new PDFDocument();
  doc.pipe(fs.createWriteStream(filePath));

  doc.fontSize(14).text(`Empresa: ${empresa}`);
  doc.text(`Filial: ${filial}`);
  doc.text(`Nome: ${emp.NOME}`);
  doc.text(`CPF: ${emp.CPF}`);
  doc.text(`Admissão: ${emp.ADMISSAO}`);
  doc.text(`Escala: ${emp.ESCALA}`);
  doc.end();

  return filePath;
}

/* ========================= LIMPAR TEMPORÁRIOS ========================= */
export function limparTemp() {
  const tempDir = path.join("temp");
  if (fs.existsSync(tempDir)) fs.removeSync(tempDir);
}

/* ========================= PROCESSAR PLANILHA ========================= */
export async function processarPlanilha(filePath, enviarPara = null) {
  const dados = lerPlanilha(filePath);
  const agrupados = agruparPorEmpresaFilial(dados);

  for (const [empresa, filiais] of Object.entries(agrupados)) {
    for (const [filial, funcionarios] of Object.entries(filiais)) {
      for (const func of funcionarios) {
        const pdfPath = gerarPDFFuncionario(func, empresa, filial);

        // Envia via WhatsApp se número informado
        if (enviarPara) {
          try {
            await enviarDocumentoWhatsApp(enviarPara, pdfPath, `Ponto: ${func.NOME}`);
          } catch (err) {
            console.error("Erro ao enviar PDF:", err.message || err);
          }
        }
      }
    }
  }

  // Limpeza final
  limparTemp();
}
