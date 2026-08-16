import { getJob, updateJob, setItemResult, JOB_STATUS, ITEM_STATUS } from './jobStore.js';
import { isValidImageUrl, isConfidentImageUrl } from './columnMapper.js';
import { generateProductContent, selectCategory } from './aiClient.js';
import { getTopLevelCategories, getBranchCandidates, getCategoryCandidates, getCategoryDirectoryStatus } from './categoryDirectory.js';

const PLACEHOLDER_IMAGE = 'https://dummyimage.com/300.png/09f/fff';
const CATEGORY_FILE = process.env.CATEGORY_DIRECTORY_FILE || './data/prom_categories.xls';
const DEFAULT_CATEGORY_ID = process.env.DEFAULT_CATEGORY_ID || '1';

const AI_CONFIG = {
  provider: process.env.AI_PROVIDER || 'mock',
  apiKey: process.env.AI_PROVIDER === 'gemini' ? process.env.GOOGLE_AI_API_KEY : process.env.OPENAI_API_KEY,
  model: process.env.AI_MODEL, // если не задано — провайдер использует дефолт из ТЗ
  brand: process.env.DEFAULT_BRAND || null,
};

const categoryDirStatus = getCategoryDirectoryStatus(CATEGORY_FILE);
const topLevelCategories = categoryDirStatus.available ? getTopLevelCategories(CATEGORY_FILE) : [];
if (!categoryDirStatus.available) {
  // Известное ограничение MVP (см. ТЗ 3.5): без справочника все товары получают один
  // дефолтный categoryId. Не тихая заглушка — предупреждение видно в логе сервера при старте.
  console.warn(`[categories] Справочник не найден по пути "${CATEGORY_FILE}" — используется DEFAULT_CATEGORY_ID="${DEFAULT_CATEGORY_ID}" для всех товаров.`);
}

// Небольшая пауза между СТРОКАМИ (не между ретраями одной строки — та задержка внутри aiClient)
// нужна, чтобы не упереться в rate limit при последовательной обработке 20 товаров.
const INTER_ITEM_DELAY_MS = 3000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function validateFields(raw) {
  if (!raw.sku) {
    return { valid: false, message: 'Пустой артикул — товар пропущен' };
  }
  if (raw.sku.length > 25) {
    // Лимит Prom.ua на длину артикула (см. "Export Products Sheet", поле Код_товару).
    // Не обрезаем молча — обрезка может сломать сопоставление с системой поставщика.
    return { valid: false, message: `Артикул длиннее 25 символов ("${raw.sku}", ${raw.sku.length} симв.) — превышен лимит Prom.ua` };
  }
  if (!raw.name) {
    return { valid: false, message: 'Пустое название товара' };
  }
  const priceNum = Number(String(raw.price).replace(',', '.').replace(/\s/g, ''));
  if (!raw.price || Number.isNaN(priceNum) || priceNum <= 0) {
    return { valid: false, message: `Некорректная цена: "${raw.price}"` };
  }
  return { valid: true };
}

function resolveImage(raw, { strictCheck = false } = {}) {
  const hasValidImage = isValidImageUrl(raw.image);
  if (hasValidImage && !strictCheck) {
    return { resolvedImage: raw.image, imageWarning: null };
  }
  if (hasValidImage && strictCheck) {
    const confident = isConfidentImageUrl(raw.image);
    if (confident === true) {
      return { resolvedImage: raw.image, imageWarning: null };
    }
    if (confident === false) {
      // Похоже не на файл картинки, а на страницу товара (напр. .../product/...) —
      // колонка была угадана, а не подписана явно поставщиком, доверять нельзя.
      return {
        resolvedImage: PLACEHOLDER_IMAGE,
        imageWarning: `Колонка изображения определена автоматически, а ссылка похожа на страницу товара, а не на файл картинки ("${raw.image}") — подставлена заглушка, стоит проверить вручную`,
      };
    }
    // confident === null: неопределённо (нет расширения, но и не похоже на страницу товара) —
    // используем ссылку как есть, но предупреждаем, что это не 100% проверено.
    return {
      resolvedImage: raw.image,
      imageWarning: `Колонка изображения определена автоматически — ссылка похожа на файл, но не подтверждена как картинка ("${raw.image}"), стоит проверить вручную`,
    };
  }
  const warning = raw.image
    ? `Значение в колонке картинки не похоже на ссылку ("${raw.image}") — подставлена заглушка`
    : 'Ссылка на изображение отсутствует — подставлена заглушка';
  return { resolvedImage: PLACEHOLDER_IMAGE, imageWarning: warning };
}

/**
 * Определяет available (true/false) по официальным правилам Prom.ua ("Export Products
 * Sheet", поле Наявність): "+" — в наличии, "-" — нет, число — дней на доставку (считается
 * доступным), пусто — товар грузится как "немає в наявності".
 *
 * Дефолт для ПУСТОГО значения зависит от контекста всего файла (см. wholeColumnEmpty):
 * - Если по каким-то строкам данные о наличии ЕСТЬ, а у этой конкретной строки пусто —
 *   уважаем это как явный сигнал поставщика и считаем отсутствующим (консервативный дефолт).
 * - Если во ВСЁМ файле колонки наличия нет или она пуста целиком — это означает, что
 *   поставщик просто не ведёт такой учёт, а не что все товары закончились. В этом случае
 *   по решению заказчика считаем: товар есть в прайсе -> считаем его в наличии.
 */
function resolveAvailability(raw, { wholeColumnEmpty = false } = {}) {
  const value = String(raw.availability ?? '').trim();
  if (value === '') {
    if (wholeColumnEmpty) {
      return { available: true, warning: null };
    }
    return { available: false, warning: 'Наличие товара не указано в файле поставщика — товар помечен как отсутствующий (правило Prom.ua)' };
  }
  if (value === '+' || /^!$/.test(value)) {
    return { available: true, warning: null };
  }
  if (value === '-' || value === '0') {
    return { available: false, warning: null };
  }
  const num = Number(value.replace(',', '.'));
  if (!Number.isNaN(num)) {
    return { available: num > 0, warning: null };
  }
  // Нераспознанное значение — не гадаем, предупреждаем и считаем отсутствующим (тот же консервативный дефолт).
  return { available: false, warning: `Не удалось распознать значение наличия ("${value}") — товар помечен как отсутствующий` };
}

/**
 * Определяет categoryId для товара. Цепочка fallback'ов (см. ТЗ 3.5):
 * 1. Справочник недоступен вообще -> DEFAULT_CATEGORY_ID (известное ограничение MVP).
 * 2. Ветка от ИИ (categoryTopLevel) не найдена в справочнике (галлюцинация/опечатка) ->
 *    ищем кандидатов по всему справочнику вместо одной ветки.
 * 3. Кандидатов для второго AI-вызова нет вообще -> DEFAULT_CATEGORY_ID.
 * 4. Второй AI-вызов (selectCategory) не смог выбрать после ретраев -> берём топ-1
 *    кандидата локально (уже отобранного keyword-поиском) вместо полного отказа.
 * Ни один из этих случаев не должен провалить товар целиком — category — это одно
 * поле фида, а не весь результат.
 */
/**
 * Ключ группировки для консистентности категорий (см. пункт 2/3 доработки):
 * бренд, если он реальный (не "No Name"), иначе — первое значимое слово названия
 * (обычно тип товара: "Софіт", "Планка", "Панель" и т.п.) в нормализованной форме.
 */
function consistencyGroupKey(generated) {
  const vendor = (generated.vendor || '').trim();
  if (vendor && vendor.toLowerCase() !== 'no name') {
    return `vendor:${vendor.toLowerCase()}`;
  }
  const firstWord = generated.name.trim().split(/\s+/)[0] || '';
  return firstWord.length >= 3 ? `type:${firstWord.toLowerCase()}` : null;
}

/**
 * Определяет categoryId для товара. Цепочка fallback'ов (см. ТЗ 3.5):
 * 1. Справочник недоступен вообще -> DEFAULT_CATEGORY_ID (известное ограничение MVP).
 * 2. Ветка от ИИ (categoryTopLevel) не найдена в справочнике (галлюцинация/опечатка) ->
 *    ищем кандидатов по всему справочнику вместо одной ветки.
 * 3. Кандидатов для второго AI-вызова нет вообще -> DEFAULT_CATEGORY_ID.
 * 4. Второй AI-вызов (selectCategory) не смог выбрать после ретраев -> берём топ-1
 *    кандидата локально (уже отобранного keyword-поиском) вместо полного отказа.
 * Ни один из этих случаев не должен провалить товар целиком — category — это одно
 * поле фида, а не весь результат.
 *
 * consistencyMap — общая для всего job'а карта {groupKey -> [{name, categoryId}]},
 * передаётся в промпт как "ранее выбранные категории для похожих товаров", чтобы
 * ИИ по возможности выбирал ту же категорию для товаров одного бренда/типа.
 */
async function resolveCategory(generated, raw, consistencyMap) {
  if (!categoryDirStatus.available) {
    return { categoryId: DEFAULT_CATEGORY_ID, categoryPath: null, warning: 'Справочник категорий не подключён — использована категория по умолчанию' };
  }

  const groupKey = consistencyGroupKey(generated);
  const previousSelections = groupKey ? (consistencyMap.get(groupKey) || []) : [];

  let candidates = getBranchCandidates(generated.name, generated.description, CATEGORY_FILE, generated.categoryTopLevel, 30);

  let warningPrefix = null;
  if (candidates.length === 0) {
    // ИИ вернул ветку, которой нет в справочнике — не подгоняем, честно откатываемся на полный поиск.
    candidates = getCategoryCandidates(generated.name, generated.description, CATEGORY_FILE, 30);
    warningPrefix = `ИИ вернул неизвестную ветку категорий ("${generated.categoryTopLevel}") — выполнен поиск по всему справочнику`;
  }

  if (candidates.length === 0) {
    return { categoryId: DEFAULT_CATEGORY_ID, categoryPath: null, warning: 'Не найдено ни одного кандидата категории — использована категория по умолчанию' };
  }

  let result;
  try {
    const categoryId = await selectCategory(generated.name, generated.description, candidates, {
      provider: AI_CONFIG.provider,
      apiKey: AI_CONFIG.apiKey,
      model: AI_CONFIG.model,
      previousSelections,
    });
    const chosen = candidates.find((c) => c.id === categoryId);
    result = { categoryId, categoryPath: chosen?.path ?? null, warning: warningPrefix };
  } catch (err) {
    // Второй AI-вызов не справился — не проваливаем товар, берём лучший локальный кандидат.
    const fallback = candidates[0];
    result = {
      categoryId: fallback.id,
      categoryPath: fallback.path,
      warning: `Автовыбор категории не удался (${err.message}) — использован ближайший найденный вариант, стоит проверить`,
    };
  }

  // Запоминаем выбор для следующих товаров той же группы (см. buildCategorySelectionPrompt).
  if (groupKey) {
    const list = consistencyMap.get(groupKey) || [];
    list.push({ name: generated.name, categoryId: result.categoryId });
    consistencyMap.set(groupKey, list.slice(-5)); // не раздуваем промпт бесконечно, хватает последних 5
  }

  return result;
}

/** Запускает фоновую обработку job'а. Не await'ится вызывающим кодом (fire-and-forget). */
export async function processJob(jobId, { imageColumnGuessed = false } = {}) {
  const job = getJob(jobId);
  if (!job) return;

  updateJob(jobId, { status: JOB_STATUS.PROCESSING });

  // Решение принимается один раз на весь файл (не построчно): если данные о наличии
  // отсутствуют вообще у всех строк — считаем это "поставщик не ведёт учёт", а не
  // "все товары закончились" (см. resolveAvailability). Если хотя бы у одной строки
  // есть значение — построчные пустые ячейки по-прежнему трактуются как "нет в наличии".
  const wholeColumnEmpty = job.items.every((it) => String(it.availability ?? '').trim() === '');

  // Общая для всего job'а карта {groupKey -> [{name, categoryId}]} — используется, чтобы
  // ИИ по возможности выбирал ту же категорию для товаров одного бренда/типа (см. resolveCategory).
  const consistencyMap = new Map();

  try {
    for (let i = 0; i < job.items.length; i += 1) {
      const raw = job.items[i];

      // Шаг 1: валидация полей до траты денег на AI API (см. ТЗ — не гонять ИИ на заведомо битых строках).
      const fieldCheck = validateFields(raw);
      if (!fieldCheck.valid) {
        setItemResult(jobId, i, { ...raw, status: ITEM_STATUS.ERROR, message: fieldCheck.message });
        continue;
      }

      const { resolvedImage, imageWarning } = resolveImage(raw, { strictCheck: imageColumnGuessed });
      const { available, warning: availabilityWarning } = resolveAvailability(raw, { wholeColumnEmpty });

      // Шаг 2: генерация контента через ИИ (с retry внутри aiClient).
      try {
        const generated = await generateProductContent(raw, {
          brand: AI_CONFIG.brand,
          topLevelCategories,
          provider: AI_CONFIG.provider,
          apiKey: AI_CONFIG.apiKey,
          model: AI_CONFIG.model,
        });

        // Шаг 3: выбор категории. Не валит весь товар при неудаче — name/description уже
        // готовы и это самое ценное; при сбое категоризации используем честный fallback
        // и понижаем статус до warning, а не выбрасываем результат целиком.
        const categoryResult = await resolveCategory(generated, raw, consistencyMap);

        const warnings = [imageWarning, availabilityWarning, categoryResult.warning].filter(Boolean);
        setItemResult(jobId, i, {
          ...raw,
          status: warnings.length > 0 ? ITEM_STATUS.WARNING : ITEM_STATUS.SUCCESS,
          message: warnings.length > 0 ? warnings.join(' | ') : null,
          resolvedImage,
          available,
          generatedName: generated.name,
          generatedDescription: generated.description,
          generatedParams: generated.params,
          vendor: generated.vendor,
          categoryId: categoryResult.categoryId,
          categoryPath: categoryResult.categoryPath,
        });
      } catch (aiErr) {
        setItemResult(jobId, i, {
          ...raw,
          status: ITEM_STATUS.ERROR,
          message: `Ошибка ИИ: ${aiErr.message}`,
          resolvedImage,
          available,
        });
      }

      if (i < job.items.length - 1) {
        await sleep(INTER_ITEM_DELAY_MS);
      }
    }

    applyConsistencyPostProcessing(jobId);
    updateJob(jobId, { status: JOB_STATUS.COMPLETED });
  } catch (err) {
    updateJob(jobId, { status: JOB_STATUS.FAILED, error: err.message });
  }
}

/**
 * Пост-обработка после основного цикла: группирует уже обработанные товары по тому же
 * ключу (бренд/тип), что и в resolveCategory, и для каждой группы из 2+ товаров
 * применяет наиболее частую категорию ко всем членам группы. Сглаживает разброс, когда
 * ИИ всё же выбрал разные категории для явно однотипных товаров, несмотря на подсказку
 * о консистентности в промпте (см. buildCategorySelectionPrompt) — эта подсказка не жёсткое
 * правило, поэтому расхождения возможны, и здесь они выравниваются финально.
 */
function applyConsistencyPostProcessing(jobId) {
  const job = getJob(jobId);
  if (!job) return;

  const groups = new Map(); // groupKey -> [{ index, item }]
  job.items.forEach((item, index) => {
    if (!item || (item.status !== ITEM_STATUS.SUCCESS && item.status !== ITEM_STATUS.WARNING) || !item.categoryId) return;
    const key = consistencyGroupKey({ vendor: item.vendor, name: item.generatedName || item.name });
    if (!key) return;
    const list = groups.get(key) || [];
    list.push({ index, item });
    groups.set(key, list);
  });

  for (const [, members] of groups) {
    if (members.length < 2) continue; // группе из одного товара не с чем быть неконсистентной

    const counts = new Map(); // categoryId -> количество
    for (const { item } of members) counts.set(item.categoryId, (counts.get(item.categoryId) || 0) + 1);
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const [majorityId, majorityCount] = sorted[0];

    // Не применяем при ничьей (несколько категорий с одинаковой частотой) — это значит,
    // группа реально неоднородна, а не просто ИИ разошёлся во мнениях.
    if (sorted.length > 1 && sorted[1][1] === majorityCount) continue;
    if (majorityCount === members.length) continue; // и так все одинаковые, править нечего

    const majorityPath = members.find(({ item }) => item.categoryId === majorityId)?.item.categoryPath ?? null;

    for (const { index, item } of members) {
      if (item.categoryId === majorityId) continue;
      const note = `Категория выровнена по большинству похожих товаров этой партии (было: ${item.categoryId})`;
      setItemResult(jobId, index, {
        ...item,
        status: ITEM_STATUS.WARNING,
        message: item.message ? `${item.message} | ${note}` : note,
        categoryId: majorityId,
        categoryPath: majorityPath,
      });
    }
  }
}