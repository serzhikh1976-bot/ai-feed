import * as XLSX from 'xlsx';
import fs from 'node:fs';

// Справочник категорий Prom.ua: 4-уровневая иерархия, последний непустой уровень —
// это лист (реальная категория для categoryId), остальные — хлебные крошки.
// Формат файла: Категория1..4, Адрес_подраздела (URL), Идентификатор_подраздела (ID).

let cachedCategories = null;

function loadCategoriesFromFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: false, defval: '' });
  const rows = matrix.slice(1); // без заголовка

  return rows
    .filter((r) => r[5]) // должен быть ID
    .map((r) => {
      const path = [r[0], r[1], r[2], r[3]].map((s) => String(s).trim()).filter(Boolean);
      return {
        id: String(r[5]).trim(),
        path,
        leafName: path[path.length - 1] || '',
        searchText: normalize(path.join(' ')),
      };
    });
}

function normalize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // убираем пунктуацию, оставляем буквы/цифры
    .replace(/\s+/g, ' ')
    .trim();
}

// Небольшой словарь известных вариантов написания одного и того же товара/термина
// (транслитерации, разговорные формы vs официальные в каталоге). Не претендует на полноту —
// это список конкретных случаев, найденных на реальных тестовых данных; расширять по мере
// обнаружения новых расхождений. Ключ и значение — оба проверяются при поиске.
const SYNONYM_GROUPS = [
  ['павербанк', 'повербанк', 'пауербанк'],
  ['зарядка', 'зарядне', 'зарядний', 'зарядного', 'зарядные'],
  ['худі', 'худи', 'світшот', 'свитшот', 'толстовка', 'светр', 'кофта', 'кардиган'],
];

// Небольшой стеммер для сравнения по корню слова, а не по фиксированной длине префикса.
// Фиксированная длина префикса ломается на коротких словах, где расхождение словоформы
// попадает уже в первые 5-6 букв (например, "куртка"/"куртки" — оба 6 букв, отличаются
// только последней). Отсечение типичных окончаний существительных надёжнее в таких случаях.
const NOUN_SUFFIXES = ['ами', 'ями', 'ості', 'ення', 'ання', 'ів', 'ий', 'ій', 'а', 'я', 'и', 'і', 'у', 'ю', 'о', 'е']
  .sort((a, b) => b.length - a.length);

function stripSuffix(word) {
  for (const suf of NOUN_SUFFIXES) {
    if (word.length - suf.length >= 3 && word.endsWith(suf)) {
      return word.slice(0, word.length - suf.length);
    }
  }
  return word;
}

function expandSynonyms(tokens) {
  const expanded = new Set(tokens);
  for (const token of tokens) {
    for (const group of SYNONYM_GROUPS) {
      if (group.some((g) => token.startsWith(g.slice(0, 6)) || g.startsWith(token.slice(0, 6)))) {
        group.forEach((g) => expanded.add(g));
      }
    }
  }
  return expanded;
}

function tokenize(text) {
  return normalize(text)
    .split(' ')
    .filter((t) => t.length >= 4); // отсекаем короткие союзы/предлоги и мусорные 3-буквенные обрубки
}

/** true, если token встречается в text как отдельное слово (по границам), а не как случайная подстрока
 *  внутри другого слова (иначе "сет" ложно матчится внутри "касети", "футбол" — внутри "футболка"). */
function hasWholeWordMatch(text, token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, 'u');
  return re.test(` ${text} `);
}

export function loadCategoryDirectory(filePath) {
  if (!cachedCategories) {
    cachedCategories = loadCategoriesFromFile(filePath);
  }
  return cachedCategories;
}

export function getCategoryDirectoryStatus(filePath) {
  try {
    const cats = loadCategoryDirectory(filePath);
    return { available: true, count: cats.length };
  } catch {
    return { available: false, count: 0 };
  }
}

/** Список уникальных top-level категорий (у Prom.ua их 58) — передаётся ИИ как фиксированный enum. */
export function getTopLevelCategories(filePath) {
  const categories = loadCategoryDirectory(filePath);
  return [...new Set(categories.map((c) => c.path[0]))].sort();
}

function wordsWithStems(normText) {
  return normText.split(' ').filter((w) => w.length >= 4).map((w) => ({ word: w, stem: stripSuffix(w) }));
}

function hasStemMatch(wordList, queryStem) {
  return wordList.some((w) => w.stem === queryStem && w.stem.length >= 3);
}

function scoreCategories(categories, productText) {
  const queryTokensRaw = expandSynonyms(tokenize(productText));
  if (queryTokensRaw.size === 0) return [];
  const queryTokens = [...queryTokensRaw].map((qt) => ({ token: qt, stem: stripSuffix(qt) }));

  const scored = categories.map((cat) => {
    const leafNorm = normalize(cat.leafName);
    const fullNorm = cat.searchText;
    const leafWords = wordsWithStems(leafNorm);
    const fullWords = wordsWithStems(fullNorm);

    let score = 0;
    for (const { token: qt, stem: qStem } of queryTokens) {
      if (hasWholeWordMatch(leafNorm, qt)) {
        score += 3; // точное совпадение целого слова в листовой категории — самый сильный сигнал
      } else if (hasWholeWordMatch(fullNorm, qt)) {
        score += 1; // точное совпадение где-то в хлебных крошках
      } else if (qt.length >= 5 && hasStemMatch(leafWords, qStem)) {
        score += 2; // совпадение по корню слова в листовой категории (словоформа: куртка/куртки)
      } else if (qt.length >= 5 && hasStemMatch(fullWords, qStem)) {
        score += 0.5; // совпадение по корню где-то в хлебных крошках — слабый сигнал
      }
    }
    return { cat, score };
  });

  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
}

/**
 * Отбирает top-N кандидатов категорий под товар по пересечению ключевых слов
 * названия+описания с полным путём категории (leaf-название весит больше, чем
 * верхние уровни иерархии — совпадение в конкретном подразделе значимее, чем
 * в общем разделе типа "Техніка та електроніка").
 */
export function getCategoryCandidates(productText, filePath, limit = 20) {
  const categories = loadCategoryDirectory(filePath);
  const ranked = scoreCategories(categories, productText);
  const topCandidates = ranked.slice(0, limit).map((s) => s.cat);
  addGenericFallback(topCandidates, categories);
  return topCandidates;
}

/**
 * Кандидаты внутри ОДНОЙ top-level ветки (подсказанной ИИ в первом вызове — см. ТЗ,
 * без второго обращения на этом шаге). Внутри узкой ветки (50-300 категорий вместо 5822)
 * список короче и точнее, что делает второй (уже category-only) AI-вызов дешевле.
 */
export function getBranchCandidates(productText, filePath, topLevel, limit = 12) {
  const categories = loadCategoryDirectory(filePath);
  const branchCategories = categories.filter((c) => c.path[0] === topLevel);
  if (branchCategories.length === 0) return []; // ИИ вернул несуществующую ветку — откат на caller

  const ranked = scoreCategories(branchCategories, productText);
  const topCandidates = ranked.slice(0, limit).map((s) => s.cat);
  addGenericFallback(topCandidates, branchCategories, topLevel);

  // Если вообще ничего не совпало по ключевым словам — не отдаём пустой список,
  // отдаём хотя бы общие категории ветки, чтобы ИИ было из чего выбрать.
  if (topCandidates.length === 0) {
    const generic = branchCategories.filter((c) => /загальне/i.test(c.leafName));
    const groups = {};
    for (const c of generic) {
      const sub = c.path[1] || 'default';
      if (!groups[sub]) groups[sub] = [];
      if (groups[sub].length < 2) groups[sub].push(c);
    }
    return Object.values(groups).flat().slice(0, 12);
  }
  return topCandidates;
}

function addGenericFallback(topCandidates, poolCategories, forcedTopLevel = null) {
  if (topCandidates.length === 0) return;
  let dominantTop = forcedTopLevel;
  if (!dominantTop) {
    const topLevelCounts = new Map();
    for (const c of topCandidates) topLevelCounts.set(c.path[0], (topLevelCounts.get(c.path[0]) || 0) + 1);
    dominantTop = [...topLevelCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  }
  const genericFallbacks = poolCategories.filter(
    (c) => c.path[0] === dominantTop && /загальне/i.test(c.leafName),
  );
  for (const gf of genericFallbacks.slice(0, 2)) {
    if (!topCandidates.some((c) => c.id === gf.id)) topCandidates.push(gf);
  }
}

/** Оставлено для обратной совместимости / отладки (полный поиск по всему справочнику без ветки). */
export function getBestCategoryInBranch(productText, filePath, topLevel) {
  const candidates = getBranchCandidates(productText, filePath, topLevel, 1);
  return candidates[0] || null;
}
