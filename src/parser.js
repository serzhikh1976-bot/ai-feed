import * as XLSX from 'xlsx';

/**
 * Парсит буфер файла (.xlsx, .xls, .csv) в { headers, rows }.
 * Строго берёт первые MAX_ROWS строк данных (защита от перерасхода AI API).
 */
const MAX_ROWS = 20;

export function parseSpreadsheet(buffer, filename) {
  const isCsv = /\.csv$/i.test(filename);

  let workbook;
  if (isCsv) {
    // xlsx не всегда верно угадывает кодировку CSV без BOM — читаем как UTF-8 текст
    // явно и парсим уже строку, а не сырой буфер.
    const text = buffer.toString('utf-8');
    workbook = XLSX.read(text, { type: 'string' });
  } else {
    workbook = XLSX.read(buffer, { type: 'buffer', codepage: 65001 });
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

  const headers = matrix[0].map((h) => String(h ?? '').trim());
  const dataRows = matrix.slice(1).filter((row) => row.some((cell) => String(cell ?? '').trim() !== ''));

  const truncated = dataRows.length > MAX_ROWS;
  const limitedRows = dataRows.slice(0, MAX_ROWS);

  return {
    filename,
    headers,
    rows: limitedRows,
    totalRowsInFile: dataRows.length,
    truncated,
  };
}
