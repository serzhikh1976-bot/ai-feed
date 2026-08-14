import fs from 'node:fs';
import path from 'node:path';
import { parseSpreadsheet } from './parser.js';
import { mapColumns, applyMapping, isValidImageUrl } from './columnMapper.js';

const UPLOAD_DIR = '/mnt/user-data/uploads';
const files = fs.readdirSync(UPLOAD_DIR).filter((f) => f.endsWith('.csv'));

if (files.length === 0) {
  console.log('Нет CSV-файлов в', UPLOAD_DIR);
  process.exit(1);
}

for (const file of files) {
  const fullPath = path.join(UPLOAD_DIR, file);
  const buffer = fs.readFileSync(fullPath);

  console.log('\n============================================');
  console.log('Файл:', file);
  console.log('============================================');

  let parsed;
  try {
    parsed = parseSpreadsheet(buffer, file);
  } catch (err) {
    console.log('❌ Ошибка парсинга:', err.message);
    continue;
  }

  console.log('Заголовки:', parsed.headers);
  console.log(`Строк данных: ${parsed.rows.length} (всего в файле: ${parsed.totalRowsInFile}, обрезано: ${parsed.truncated})`);

  const { mapping, guessed, missing } = mapColumns(parsed.headers);
  console.log('Маппинг колонок:', mapping);
  if (guessed.length) console.log('⚠️  Определено позиционным fallback (не по ключевым словам):', guessed);
  if (missing.length) {
    console.log('❌ Не найдены обязательные поля:', missing);
    continue;
  } else {
    console.log('✅ Все обязательные поля (sku, name, price) найдены');
  }

  const items = applyMapping(parsed.rows, mapping);
  items.forEach((item, i) => {
    const imgStatus = item.image
      ? (isValidImageUrl(item.image) ? '✅ валидный URL' : `⚠️  не похоже на URL ("${item.image}") → будет заглушка`)
      : '⚠️  пусто → будет заглушка';
    console.log(`\n  [${i}] ${item.sku} — ${item.name}`);
    console.log(`      цена: ${item.price} | картинка: ${imgStatus}`);
    console.log(`      описание: ${item.description.slice(0, 60)}${item.description.length > 60 ? '…' : ''}`);
  });
}
