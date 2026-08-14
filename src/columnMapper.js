// Маппинг колонок поставщика на канонические поля.
// Стратегия: сначала пытаемся найти колонку по ключевым словам в заголовке
// (регистронезависимо, с поддержкой ru/ua написаний). Если для обязательного
// поля ничего не нашлось — используем позиционный fallback (порядок колонок
// как в самом первом варианте ТЗ), и помечаем это в результате как "guessed".

const FIELD_KEYWORDS = {
  sku: ['артикул', 'арт.', 'код', 'sku', 'id', 'номенклатур'],
  name: ['товар', 'наименование', 'название', 'name', 'номенклатура'],
  price: ['цена', 'прайс', 'стоимость', 'price', 'розничная'],
  image: ['картинка', 'фото', 'изображение', 'image', 'photo', 'picture'],
  description: ['описание', 'характеристик', 'доп. инфо', 'дополнительно', 'технические', 'параметры'],
};

// Порядок обязателен для позиционного fallback, если keyword-поиск не нашёл колонку.
const REQUIRED_FIELDS = ['sku', 'name', 'price'];
const ALL_FIELDS = ['sku', 'name', 'price', 'image', 'description'];

function normalizeHeader(h) {
  return String(h ?? '').trim().toLowerCase();
}

/**
 * @param {string[]} headers - заголовки колонок как они есть в файле
 * @returns {{ mapping: Record<string, number>, guessed: string[], missing: string[] }}
 */
export function mapColumns(headers) {
  const normalized = headers.map(normalizeHeader);
  const mapping = {};
  const guessed = [];

  for (const field of ALL_FIELDS) {
    const keywords = FIELD_KEYWORDS[field];
    const idx = normalized.findIndex((h) => keywords.some((kw) => h.includes(kw)));
    if (idx !== -1) {
      mapping[field] = idx;
    }
  }

  // Позиционный fallback только для полей, которые не нашлись по ключевым словам,
  // и только если в файле вообще достаточно колонок.
  ALL_FIELDS.forEach((field, position) => {
    if (mapping[field] === undefined && position < headers.length) {
      // не занимаем колонку, которая уже сматчена на другое поле
      const alreadyUsed = Object.values(mapping).includes(position);
      if (!alreadyUsed) {
        mapping[field] = position;
        guessed.push(field);
      }
    }
  });

  const missing = REQUIRED_FIELDS.filter((f) => mapping[f] === undefined);

  return { mapping, guessed, missing };
}

/**
 * Превращает сырые строки таблицы (массивы значений) в объекты канонических полей.
 * @param {string[][]} rows - строки данных (без заголовка)
 * @param {Record<string, number>} mapping
 */
export function applyMapping(rows, mapping) {
  return rows.map((row) => ({
    sku: mapping.sku !== undefined ? String(row[mapping.sku] ?? '').trim() : '',
    name: mapping.name !== undefined ? String(row[mapping.name] ?? '').trim() : '',
    price: mapping.price !== undefined ? String(row[mapping.price] ?? '').trim() : '',
    image: mapping.image !== undefined ? String(row[mapping.image] ?? '').trim() : '',
    description: mapping.description !== undefined ? String(row[mapping.description] ?? '').trim() : '',
  }));
}

const URL_RE = /^https?:\/\/\S+$/i;

/** Валидна ли строка как прямая ссылка на картинку (а не текст-заглушка вроде "Illustration Source"). */
export function isValidImageUrl(value) {
  return URL_RE.test(String(value ?? '').trim());
}
