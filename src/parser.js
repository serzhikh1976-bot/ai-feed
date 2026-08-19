import * as XLSX from 'xlsx';
import { FIELD_KEYWORDS } from './columnMapper.js';

const MAX_ROWS = 10;

function findHeaderRow(matrix) {
  const skuWords = (FIELD_KEYWORDS.sku || []).map(w => w.toLowerCase());
  const nameWords = (FIELD_KEYWORDS.name || []).map(w => w.toLowerCase());
  const priceWords = (FIELD_KEYWORDS.price || []).map(w => w.toLowerCase());

  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i];
    if (!row || row.length === 0) continue;

    const cells = row.map(cell => String(cell ?? '').toLowerCase().trim());
    if (cells.every(c => c === '')) continue;

    const hasSku = cells.some(cell => skuWords.some(word => cell.includes(word)));
    const hasName = cells.some(cell => nameWords.some(word => cell.includes(word)));
    const hasPrice = cells.some(cell => priceWords.some(word => cell.includes(word)));

    if (hasSku && hasName && hasPrice) {
      return i;
    }
  }

  return -1;
}

export function parseSpreadsheet(buffer, filename) {
  const isCsv = /\.csv$/i.test(filename);

  let workbook;

  if (isCsv) {
    const text = buffer.toString('utf-8');
    workbook = XLSX.read(text, { type: 'string' });
  } else {
    // Читаємо ТІЛЬКИ перші MAX_ROWS+1 рядків
    workbook = XLSX.read(buffer, {
      type: 'buffer',
      codepage: 65001,
      sheetRows: MAX_ROWS + 1,
    });
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error('Файл не содержит листов с данными');
  }

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });

  if (matrix.length === 0) {
    throw new Error('Файл пустой');
  }

  // Знаходимо заголовок
  const headerIndex = findHeaderRow(matrix);
  let headers, dataRows;

  if (headerIndex !== -1) {
    headers = matrix[headerIndex].map((h) => String(h ?? '').trim());
    dataRows = matrix.slice(headerIndex + 1);
  } else {
    headers = matrix[0].map((h) => String(h ?? '').trim());
    dataRows = matrix.slice(1);
  }

  // Фільтруємо порожні рядки
  dataRows = dataRows.filter((row) =>
    row.some((cell) => String(cell ?? '').trim() !== '')
  );

  // Обрізаємо до MAX_ROWS
  const limitedRows = dataRows.slice(0, MAX_ROWS);

  return {
    filename,
    headers,
    rows: limitedRows,
    totalRowsInFile: dataRows.length,
    truncated: dataRows.length > MAX_ROWS,
  };
}