export const FIELD_KEYWORDS = {
  sku: ['артикул', 'арт.', 'код', 'sku', 'id', 'номенклатур'],
  name: ['товар', 'наименование', 'название', 'name', 'номенклатура'],
  price: ['цена', 'прайс', 'стоимость', 'price', 'розничная'],
  image: ['картинка', 'фото', 'изображение', 'image', 'photo', 'picture'],
  description: ['описание', 'характеристик', 'доп. инфо', 'дополнительно', 'технические', 'параметры'],
  availability: ['наявність', 'наличие', 'кількість', 'количество', 'залишок', 'остаток', 'stock', 'qty', 'склад'],
};

const REQUIRED_FIELDS = ['sku', 'name', 'price'];
const ALL_FIELDS = ['sku', 'name', 'price', 'image', 'description', 'availability'];

function normalizeHeader(h) {
  return String(h ?? '').trim().toLowerCase();
}

/**
 * Эвристически определяет, какая колонка чем является, на основе первых нескольких строк данных.
 * Возвращает маппинг, если удалось определить хотя бы price, name и sku.
 */
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

    // Вычисляем дополнительные метрики
    const numericRatio = numericCount / totalNonEmpty;
    const decimalRatio = decimalCount / totalNonEmpty;
    // Разнообразие (чем больше, тем лучше для цены)
    const uniqueValues = new Set(numericValues).size;
    const variety = uniqueValues / Math.max(1, numericValues.length);
    // Среднее значение (для исключения номеров строк)
    const avg = numericValues.length > 0 ? numericValues.reduce((a,b) => a+b, 0) / numericValues.length : 0;

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

  // 2. Цена: выбираем колонку с высоким numericRatio, хорошей variety и не с малыми значениями (отсекаем номера строк)
  let bestPriceCol = null;
  let bestPriceScore = -1;
  for (const [col, stat] of Object.entries(stats)) {
    const colNum = Number(col);
    if (usedCols.has(colNum)) continue;
    // Цена должна иметь числа, иметь дробную часть хотя бы в некоторых, и не быть монотонной (разнообразие)
    // Также исключаем очень маленькие значения (номера строк 1,2,3...)
    if (stat.numericRatio > 0.6 && stat.decimalRatio > 0.1 && stat.variety > 0.5 && stat.avg > 5) {
      const score = stat.numericRatio * 0.3 + stat.decimalRatio * 0.3 + stat.variety * 0.4;
      if (score > bestPriceScore) {
        bestPriceScore = score;
        bestPriceCol = colNum;
      }
    }
  }
  // Если не нашли по строгим условиям, пробуем более мягко (без avg)
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

  // 3. Артикул (короткие числа/буквы, не цена, не URL)
  for (const [col, stat] of Object.entries(stats)) {
    const colNum = Number(col);
    if (usedCols.has(colNum)) continue;
    if (stat.maxLength > 2 && stat.maxLength < 20 && !stat.hasUrl && stat.numericRatio > 0.3 && colNum !== mapping.price) {
      mapping.sku = colNum;
      usedCols.add(colNum);
      break;
    }
  }

  // 4. Название (самые длинные строки)
  for (const [col, stat] of Object.entries(stats)) {
    const colNum = Number(col);
    if (usedCols.has(colNum)) continue;
    if (stat.maxLength > 20 && !stat.hasUrl) {
      mapping.name = colNum;
      usedCols.add(colNum);
      break;
    }
  }

  // 5. Описание (если не найдено, берём оставшуюся неиспользованную)
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

  // Сначала пробуем по ключевым словам
  for (const field of ALL_FIELDS) {
    const keywords = FIELD_KEYWORDS[field];
    const idx = normalized.findIndex((h) => keywords.some((kw) => h.includes(kw)));
    if (idx !== -1) {
      mapping[field] = idx;
    }
  }

  // Если не все обязательные поля найдены, пробуем эвристику по данным
  const missing = REQUIRED_FIELDS.filter((f) => mapping[f] === undefined);
  if (missing.length > 0 && dataRows && dataRows.length > 0) {
    console.log('[columnMapper] Ключевые слова не помогли, пробуем эвристику...');
    const heuristicMapping = guessMappingFromData(dataRows);
    if (heuristicMapping) {
      // Дополняем маппинг эвристикой, но не перезаписываем уже найденные
      for (const [field, idx] of Object.entries(heuristicMapping)) {
        if (mapping[field] === undefined) {
          mapping[field] = idx;
          guessed.push(field);
        }
      }
    }
  }

  // Позиционный fallback для оставшихся полей
  ALL_FIELDS.forEach((field, position) => {
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
  return rows.map((row) => ({
    sku: mapping.sku !== undefined ? String(row[mapping.sku] ?? '').trim() : '',
    name: mapping.name !== undefined ? String(row[mapping.name] ?? '').trim() : '',
    price: mapping.price !== undefined ? String(row[mapping.price] ?? '').trim() : '',
    image: mapping.image !== undefined ? String(row[mapping.image] ?? '').trim() : '',
    description: mapping.description !== undefined ? String(row[mapping.description] ?? '').trim() : '',
    availability: mapping.availability !== undefined ? String(row[mapping.availability] ?? '').trim() : '',
  }));
}

const URL_RE = /^https?:\/\/\S+$/i;

export function isValidImageUrl(value) {
  return URL_RE.test(String(value ?? '').trim());
}

const IMAGE_EXTENSION_RE = /\.(jpe?g|png|webp|gif|bmp|svg)(\?\S*)?$/i;
// Частые паттерны страниц ТОВАРА (не картинки) — если колонку "image" пришлось угадывать
// (не подписана явно поставщиком как "Фото"/"Картинка"), такая ссылка с высокой вероятностью
// ведёт на страницу товара у поставщика, а не на файл изображения (см. реальный кейс:
// колонка "URL" со ссылками вида .../product/nazva-tovaru/ — это карточка товара на сайте
// поставщика, не фото; попадание такой ссылки в <picture> тихо портит фид).
const GENERIC_PAGE_PATTERN_RE = /\/(product|tovar|item|p|catalog|category)\//i;

/**
 * Более строгая проверка — используется, когда колонка картинки была определена
 * НЕ по явному ключевому слову в заголовке (см. mapColumns → guessed), а угадана
 * позиционно/эвристикой по данным. В таком случае доверять "это просто похоже на URL"
 * недостаточно — нужно ещё убедиться, что это похоже именно на файл изображения,
 * а не на случайно попавшую в эту колонку ссылку на страницу товара.
 */
export function isConfidentImageUrl(value) {
  const url = String(value ?? '').trim();
  if (!isValidImageUrl(url)) return false;
  if (IMAGE_EXTENSION_RE.test(url)) return true;
  if (GENERIC_PAGE_PATTERN_RE.test(url)) return false;
  // Нет расширения картинки, но и не похоже на страницу товара (например, некоторые
  // CDN отдают картинки без расширения в пути) — не отклоняем однозначно, но и не
  // считаем подтверждённым; вызывающий код должен трактовать это как неопределённость.
  return null;
}