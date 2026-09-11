import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { toReais, formatBRL } from '../../utils/money.js';

/** 'YYYY-MM-DD' -> 'DD/MM/AAAA' (formato exigido nos relatórios). */
const brDate = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

function cellValue(row, col) {
  const raw = row[col.key];
  if (raw === null || raw === undefined) return '';
  if (col.type === 'date') return brDate(raw);
  if (col.type === 'money') return toReais(raw);
  return String(raw);
}

// ------------------------------------------------------------------
// CSV
// ------------------------------------------------------------------
/**
 * Gera CSV com separador `;` e BOM UTF-8 — é o que o Excel em pt-BR abre
 * corretamente sem passar pelo assistente de importação.
 */
export function exportCsv(rows, columns) {
  const escape = (value) => {
    const s = String(value ?? '');
    return /[";\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };

  const lines = [columns.map((c) => escape(c.header)).join(';')];

  for (const row of rows) {
    lines.push(
      columns
        .map((col) => {
          const v = cellValue(row, col);
          // Decimal com vírgula: o Excel pt-BR interpreta como número.
          return escape(col.type === 'money' ? v.toFixed(2).replace('.', ',') : v);
        })
        .join(';'),
    );
  }

  return `﻿${lines.join('\r\n')}`;
}

// ------------------------------------------------------------------
// Excel
// ------------------------------------------------------------------
export async function exportXlsx(rows, columns, meta) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Controle Financeiro';
  wb.created = new Date();

  const ws = wb.addWorksheet('Lançamentos', {
    views: [{ state: 'frozen', ySplit: 4 }],
  });

  // Cabeçalho do relatório
  ws.mergeCells(1, 1, 1, columns.length);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = meta.title;
  titleCell.font = { size: 16, bold: true, color: { argb: 'FF1E293B' } };
  titleCell.alignment = { vertical: 'middle' };
  ws.getRow(1).height = 26;

  ws.mergeCells(2, 1, 2, columns.length);
  ws.getCell(2, 1).value = `Período: ${meta.period}   |   Gerado em: ${brDate(meta.generatedAt)}`;
  ws.getCell(2, 1).font = { size: 10, color: { argb: 'FF64748B' } };

  // Linha 3 vazia como respiro visual; linha 4 = cabeçalho da tabela.
  const headerRow = ws.getRow(4);
  columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF334155' } } };
    ws.getColumn(i + 1).width = col.width ?? 18;
  });
  headerRow.height = 20;

  rows.forEach((row, idx) => {
    const r = ws.getRow(5 + idx);
    columns.forEach((col, i) => {
      const cell = r.getCell(i + 1);
      cell.value = cellValue(row, col);
      if (col.type === 'money') {
        cell.numFmt = 'R$ #,##0.00';
        cell.font = { color: { argb: row.kind === 'income' ? 'FF15803D' : 'FFB91C1C' } };
      }
    });
    // Zebra: facilita seguir a linha em relatórios longos.
    if (idx % 2 === 1) {
      r.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      });
    }
  });

  // Totais
  const totalRow = ws.getRow(5 + rows.length + 1);
  totalRow.getCell(1).value = 'TOTAIS';
  totalRow.getCell(1).font = { bold: true };
  const amountCol = columns.findIndex((c) => c.type === 'money') + 1;
  if (amountCol > 0) {
    totalRow.getCell(Math.max(1, amountCol - 2)).value = 'Receitas:';
    totalRow.getCell(Math.max(1, amountCol - 1)).value = toReais(meta.totals.income);
    totalRow.getCell(Math.max(1, amountCol - 1)).numFmt = 'R$ #,##0.00';
    totalRow.getCell(amountCol).value = toReais(meta.totals.income - meta.totals.expense);
    totalRow.getCell(amountCol).numFmt = 'R$ #,##0.00';
    totalRow.getCell(amountCol).font = { bold: true };
  }

  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: columns.length } };

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ------------------------------------------------------------------
// PDF
// ------------------------------------------------------------------
/**
 * Monta o PDF em paisagem e escreve direto no response (stream), sem
 * materializar o documento inteiro em memória.
 */
export function exportPdf(res, rows, columns, meta) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
  doc.pipe(res);

  // Em paisagem sobra pouca largura: o PDF leva as colunas essenciais.
  const cols = columns.filter((c) =>
    ['due_date', 'kind_label', 'description', 'category_name', 'account_name', 'status_label', 'amount'].includes(c.key),
  );

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const weights = { due_date: 1, kind_label: 0.9, description: 3.2, category_name: 1.6, account_name: 1.6, status_label: 1, amount: 1.4 };
  const totalWeight = cols.reduce((s, c) => s + (weights[c.key] ?? 1), 0);
  const widths = cols.map((c) => ((weights[c.key] ?? 1) / totalWeight) * pageWidth);

  const drawHeader = () => {
    doc.fillColor('#1e293b').fontSize(16).font('Helvetica-Bold').text(meta.title, { align: 'left' });
    doc.moveDown(0.2);
    doc.fillColor('#64748b').fontSize(9).font('Helvetica')
      .text(`Período: ${meta.period}    |    Gerado em: ${brDate(meta.generatedAt)}    |    ${rows.length} lançamento(s)`);
    doc.moveDown(0.6);

    const y = doc.y;
    doc.rect(doc.page.margins.left, y, pageWidth, 18).fill('#4f46e5');
    doc.fillColor('#ffffff').fontSize(8.5).font('Helvetica-Bold');
    let x = doc.page.margins.left;
    cols.forEach((col, i) => {
      doc.text(col.header, x + 4, y + 5, { width: widths[i] - 8, align: col.type === 'money' ? 'right' : 'left' });
      x += widths[i];
    });
    doc.y = y + 22;
  };

  drawHeader();
  doc.font('Helvetica').fontSize(8);

  for (const [idx, row] of rows.entries()) {
    // Quebra de página: repete o cabeçalho para a tabela continuar legível.
    if (doc.y > doc.page.height - doc.page.margins.bottom - 40) {
      doc.addPage();
      drawHeader();
      doc.font('Helvetica').fontSize(8);
    }

    const y = doc.y;
    if (idx % 2 === 1) doc.rect(doc.page.margins.left, y - 2, pageWidth, 14).fill('#f1f5f9');

    let x = doc.page.margins.left;
    cols.forEach((col, i) => {
      const value = cellValue(row, col);
      const isMoney = col.type === 'money';
      doc.fillColor(isMoney ? (row.kind === 'income' ? '#15803d' : '#b91c1c') : '#334155');
      doc.text(
        isMoney ? formatBRL(row[col.key]) : String(value),
        x + 4, y,
        { width: widths[i] - 8, align: isMoney ? 'right' : 'left', lineBreak: false, ellipsis: true },
      );
      x += widths[i];
    });
    doc.y = y + 14;
  }

  // Resumo final
  doc.moveDown(1);
  const boxY = doc.y;
  doc.rect(doc.page.margins.left, boxY, pageWidth, 52).fill('#f8fafc').stroke('#e2e8f0');
  doc.fillColor('#0f172a').fontSize(10).font('Helvetica-Bold').text('Resumo do período', doc.page.margins.left + 10, boxY + 8);
  doc.fontSize(9).font('Helvetica');
  doc.fillColor('#15803d').text(`Receitas: ${formatBRL(meta.totals.income)}`, doc.page.margins.left + 10, boxY + 24);
  doc.fillColor('#b91c1c').text(`Despesas: ${formatBRL(meta.totals.expense)}`, doc.page.margins.left + 200, boxY + 24);
  const result = meta.totals.income - meta.totals.expense;
  doc.fillColor(result >= 0 ? '#15803d' : '#b91c1c').font('Helvetica-Bold')
    .text(`Resultado: ${formatBRL(result)}`, doc.page.margins.left + 400, boxY + 24);

  doc.end();
}
