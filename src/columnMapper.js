export const FIELD_KEYWORDS = {
  sku: ['артикул', 'арт.', 'код', 'sku', 'id', 'номенклатур', 'код_товару', 'product_id', 'артикул_товару'],
  name: ['товар', 'наименование', 'название', 'name', 'номенклатура', 'назва_позиції', 'назва_позиції_укр', 'назва_товару'],
  price: ['цена', 'прайс', 'стоимость', 'price', 'розничная', 'ціна', 'роздрібна', 'ціна_грн'],
  image: ['картинка', 'фото', 'изображение', 'image', 'photo', 'picture', 'посилання_зображення', 'зображення', 'url_зображення'],
  description: ['описание', 'характеристик', 'доп. инфо', 'дополнительно', 'технические', 'параметры', 'опис', 'опис_укр', 'повний_опис'],
  availability: ['наявність', 'наличие', 'кількість', 'количество', 'залишок', 'остаток', 'stock', 'qty', 'склад', 'наявність_на_складі', 'кількість_на_складі'],

  brand: ['бренд', 'виробник', 'manufacturer', 'марка', 'brand', 'торгівельна марка', 'tm', 'торговая марка', 'производитель', 'бренд_товару'],
  model: ['модель', 'model', 'модифікація', 'variant', 'артикул_модель', 'модель_товару'],
  color: ['колір', 'цвет', 'colour', 'колер', 'колір_товару', 'кольорова_гама'],
  size: ['розмір', 'размер', 'size', 'габарити', 'розмір_товару', 'розмір_одягу', 'розмір_взуття'],
  material: ['матеріал', 'материал', 'material', 'сировина', 'матеріал_виробу', 'склад_матеріалу'],
  weight: ['вага', 'вес', 'weight', 'маса', 'вага_кг', 'маса_товару'],
  length: ['довжина', 'длина', 'length', 'довжина_см', 'довжина_товару'],
  width: ['ширина', 'ширина', 'width', 'ширина_см', 'ширина_товару'],
  height: ['висота', 'высота', 'height', 'висота_см', 'висота_товару'],
  unit: ['одиниця виміру', 'одиница измерения', 'unit', 'од.вим.', 'одиниця_виміру', 'одиниця_виміру_товару'],
  currency: ['валюта', 'currency', 'вал', 'валюта_ціни', 'код_валюти'],
  seo_title: ['html_заголовок', 'seo_title', 'html_title', 'заголовок_seo', 'seo_заголовок', 'meta_title'],
  seo_description: ['html_опис', 'seo_description', 'html_description', 'опис_seo', 'seo_опис', 'meta_description'],
  search_queries: ['пошукові запити', 'search_queries', 'ключові слова', 'keywords', 'ключові_слова', 'пошукові_фрази'],
};

const REQUIRED_FIELDS = ['sku', 'name', 'price'];
const ALL_FIELDS = ['sku', 'name', 'price', 'image', 'description', 'availability',
  'brand', 'model', 'color', 'size', 'material',
  'weight', 'length', 'width', 'height', 'unit', 'currency',
  'seo_title', 'seo_description', 'search_queries'];

function normalizeHeader(h) {
  return String(h ?? '').trim().toLowerCase();
}

function guessMappingFromData(rows) {
  if (!rows || rows.length === 0) return null;

  const sampleSize = Math.min(5, rows.length);
  const stats = {};

  for (let col = 0; col < rows[0].length; col++) {
    const values = [];
    let hasUrl = false;
    let numericCount = 0;
    let decimalCount = 0;
    let maxLength = 0;
    let totalNonEmpty = 0;
    let numericValues = [];

    for (let rowIdx = 0; rowIdx < sampleSize; rowIdx++) {
      const val = String(rows[rowIdx][col] ?? '').trim();
      values.push(val);
      if (val === '') continue;
      totalNonEmpty++;
      maxLength = Math.max(maxLength, val.length);
      if (/^https?:\/\//i.test(val)) hasUrl = true;

      const numeric = parseFloat(val.replace(',', '.').replace(/\s/g, ''));
      if (!isNaN(numeric) && val !== '') {
        numericCount++;
        numericValues.push(numeric);
        if (val.includes('.') || val.includes(',')) decimalCount++;
      }
    }

    if (totalNonEmpty === 0) continue;

    const numericRatio = numericCount / totalNonEmpty;
    const decimalRatio = decimalCount / totalNonEmpty;
    const uniqueValues = new Set(numericValues).size;
    const variety = uniqueValues / Math.max(1, numericValues.length);
    const avg = numericValues.length > 0 ? numericValues.reduce((a, b) => a + b, 0) / numericValues.length : 0;

    stats[col] = {
      hasUrl,
      numericRatio,
      decimalRatio,
      variety,
      avg,
      maxLength,
      sample: values,
    };
  }

  const mapping = {};
  const usedCols = new Set();

  // 1. Картинка (URL)
  for (const [col, stat] of Object.entries(stats)) {
    if (stat.hasUrl && !usedCols.has(Number(col))) {
      mapping.image = Number(col);
      usedCols.add(Number(col));
      break;
    }
  }

  // 2. Ціна
  let bestPriceCol = null;
  let bestPriceScore = -1;
  for (const [col, stat] of Object.entries(stats)) {
    const colNum = Number(col);
    if (usedCols.has(colNum)) continue;
    if (stat.numericRatio > 0.6 && stat.decimalRatio > 0.1 && stat.variety > 0.5 && stat.avg > 5) {
      const score = stat.numericRatio * 0.3 + stat.decimalRatio * 0.3 + stat.variety * 0.4;
      if (score > bestPriceScore) {
        bestPriceScore = score;
        bestPriceCol = colNum;
      }
    }
  }
  if (bestPriceCol === null) {
    for (const [col, stat] of Object.entries(stats)) {
      const colNum = Number(col);
      if (usedCols.has(colNum)) continue;
      if (stat.numericRatio > 0.5 && stat.decimalRatio > 0.1 && stat.variety > 0.3) {
        const score = stat.numericRatio * 0.3 + stat.decimalRatio * 0.3 + stat.variety * 0.4;
        if (score > bestPriceScore) {
          bestPriceScore = score;
          bestPriceCol = colNum;
        }
      }
    }
  }
  if (bestPriceCol !== null) {
    mapping.price = bestPriceCol;
    usedCols.add(bestPriceCol);
  }

  // 3. Артикул (короткі числа/букви)
  for (const [col, stat] of Object.entries(stats)) {
    const colNum = Number(col);
    if (usedCols.has(colNum)) continue;
    if (stat.maxLength > 2 && stat.maxLength < 20 && !stat.hasUrl && stat.numericRatio > 0.3 && colNum !== mapping.price) {
      mapping.sku = colNum;
      usedCols.add(colNum);
      break;
    }
  }

  // 4. Назва (найдовші строки)
  for (const [col, stat] of Object.entries(stats)) {
    const colNum = Number(col);
    if (usedCols.has(colNum)) continue;
    if (stat.maxLength > 20 && !stat.hasUrl) {
      mapping.name = colNum;
      usedCols.add(colNum);
      break;
    }
  }

  // 5. Опис
  if (!mapping.description) {
    for (const [col, stat] of Object.entries(stats)) {
      const colNum = Number(col);
      if (usedCols.has(colNum)) continue;
      if (stat.maxLength > 10) {
        mapping.description = colNum;
        usedCols.add(colNum);
        break;
      }
    }
  }

  if (mapping.sku !== undefined && mapping.name !== undefined && mapping.price !== undefined) {
    console.log('[columnMapper] Эвристика определила колонки:', mapping);
    return mapping;
  }

  return null;
}

export function mapColumns(headers, dataRows) {
  const normalized = headers.map(normalizeHeader);
  const mapping = {};
  const guessed = [];

  // Головний цикл – шукаємо всі поля за ключовими словами
  for (const field of ALL_FIELDS) {
    const keywords = FIELD_KEYWORDS[field];
    const idx = normalized.findIndex((h) => keywords.some((kw) => h.includes(kw)));
    if (idx !== -1) {
      mapping[field] = idx;
    }
  }

  // Якщо не всі обов'язкові поля знайдені – пробуємо евристику
  const missing = REQUIRED_FIELDS.filter((f) => mapping[f] === undefined);
  if (missing.length > 0 && dataRows && dataRows.length > 0) {
    console.log('[columnMapper] Ключевые слова не помогли, пробуем эвристику...');
    const heuristicMapping = guessMappingFromData(dataRows);
    if (heuristicMapping) {
      for (const [field, idx] of Object.entries(heuristicMapping)) {
        if (mapping[field] === undefined) {
          mapping[field] = idx;
          guessed.push(field);
        }
      }
    }
  }

  // Позиційний fallback для обов'язкових полів
  const requiredFallback = ['sku', 'name', 'price', 'description', 'image', 'availability'];
  requiredFallback.forEach((field, position) => {
    if (mapping[field] === undefined && position < headers.length) {
      const alreadyUsed = Object.values(mapping).includes(position);
      if (!alreadyUsed) {
        mapping[field] = position;
        guessed.push(field);
      }
    }
  });

  const finalMissing = REQUIRED_FIELDS.filter((f) => mapping[f] === undefined);

  console.log('[columnMapper] Итоговый маппинг:', mapping);
  console.log('[columnMapper] Поля, определённые позиционно или эвристикой:', guessed);
  console.log('[columnMapper] Отсутствующие обязательные поля:', finalMissing);

  return { mapping, guessed, missing: finalMissing };
}

export function applyMapping(rows, mapping) {
  return rows.map((row) => {
    const item = {
      sku: mapping.sku !== undefined ? String(row[mapping.sku] ?? '').trim() : '',
      name: mapping.name !== undefined ? String(row[mapping.name] ?? '').trim() : '',
      price: mapping.price !== undefined ? String(row[mapping.price] ?? '').trim() : '',
      image: mapping.image !== undefined ? String(row[mapping.image] ?? '').trim() : '',
      description: mapping.description !== undefined ? String(row[mapping.description] ?? '').trim() : '',
      availability: mapping.availability !== undefined ? String(row[mapping.availability] ?? '').trim() : '',
    };

    // Додаткові поля – всі вони вже знайдені в головному циклі
    const extraFields = ['brand', 'model', 'color', 'size', 'material', 'weight', 'length', 'width', 'height', 'unit', 'currency', 'seo_title', 'seo_description', 'search_queries'];
    for (const field of extraFields) {
      if (mapping[field] !== undefined) {
        item[field] = String(row[mapping[field]] ?? '').trim();
      } else {
        item[field] = '';
      }
    }

    item._rawRow = row.map(cell => String(cell ?? '').trim());

    return item;
  });
}

const URL_RE = /^https?:\/\/\S+$/i;

export function isValidImageUrl(value) {
  return URL_RE.test(String(value ?? '').trim());
}

const IMAGE_EXTENSION_RE = /\.(jpe?g|png|webp|gif|bmp|svg)(\?\S*)?$/i;
const GENERIC_PAGE_PATTERN_RE = /\/(product|tovar|item|p|catalog|category)\//i;

export function isConfidentImageUrl(value) {
  const url = String(value ?? '').trim();
  if (!isValidImageUrl(url)) return false;
  if (IMAGE_EXTENSION_RE.test(url)) return true;
  if (GENERIC_PAGE_PATTERN_RE.test(url)) return false;
  return null;
}

export function isDirectImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return /\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i.test(url.trim());
}