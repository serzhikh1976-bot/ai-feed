import * as XLSX from 'xlsx';
import fs from 'node:fs';

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
        url: String(r[4] || '').trim(), // Адрес_подраздела — колонка 4
      };
    });
}

function normalize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SYNONYM_GROUPS = [
  ['павербанк', 'повербанк', 'пауербанк'],
  ['зарядка', 'зарядне', 'зарядний', 'зарядного', 'зарядные'],
  ['худі', 'худи', 'світшот', 'свитшот', 'толстовка', 'светр', 'кофта', 'кардиган'],
  ['кабель', 'шнур', 'дріт', 'провід', 'зарядний кабель', 'usb', 'type-c', 'micro usb', 'аксесуари'],
  ['монітор', 'дисплей', 'екран', 'display', 'monitor'],
  ['мережевий фільтр', 'подовжувач електричний', 'фільтр живлення', 'електричний подовжувач', 'подовжувач', 'мережевий'],
];

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
    .filter((t) => t.length >= 4);
}

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
        score += 3;
      } else if (hasWholeWordMatch(fullNorm, qt)) {
        score += 1;
      } else if (qt.length >= 5 && hasStemMatch(leafWords, qStem)) {
        score += 2;
      } else if (qt.length >= 5 && hasStemMatch(fullWords, qStem)) {
        score += 0.5;
      }
    }
    return { cat, score };
  });

  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
}

export function getCategoryCandidates(productText, filePath, limit = 20) {
  const categories = loadCategoryDirectory(filePath);
  const ranked = scoreCategories(categories, productText);
  const topCandidates = ranked.slice(0, limit).map((s) => s.cat);
  addGenericFallback(topCandidates, categories);
  return topCandidates;
}

export function getBranchCandidates(productText, filePath, topLevel, limit = 12) {
  const categories = loadCategoryDirectory(filePath);
  const branchCategories = categories.filter((c) => c.path[0] === topLevel);
  if (branchCategories.length === 0) return [];

  const ranked = scoreCategories(branchCategories, productText);
  const topCandidates = ranked.slice(0, limit).map((s) => s.cat);
  addGenericFallback(topCandidates, branchCategories, topLevel);

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

export function getBestCategoryInBranch(productText, filePath, topLevel) {
  const candidates = getBranchCandidates(productText, filePath, topLevel, 1);
  return candidates[0] || null;
}