import { buildProductPrompt, buildCategorySelectionPrompt } from './promptBuilder.js';
import { callOpenAI, callGemini } from './aiProviders.js';
import { callMock } from './mockProvider.js';

const RETRY_DELAYS_MS = [1000, 3000]; // см. ТЗ 5.1: до 2 повторов, экспоненциальный рост

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripCodeFences(text) {
  // На случай если модель всё же обернула JSON в ```json ... ``` вопреки инструкции.
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
}

/** Обрезает HTML-строку до limit символов, не разрывая тег посередине — откатывается до последнего "}" открытого тега или пробела. */
function truncateAtTagBoundary(html, limit) {
  let cut = html.slice(0, limit);
  // Если разрез попал внутрь тега (после последнего "<" нет ">"), откатываемся до этого "<".
  const lastOpen = cut.lastIndexOf('<');
  const lastClose = cut.lastIndexOf('>');
  if (lastOpen > lastClose) {
    cut = cut.slice(0, lastOpen);
  }
  return cut;
}

function parseAndValidate(rawText) {
  const cleaned = stripCodeFences(rawText);
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Невалидный JSON от ИИ: ${err.message}`);
  }

  if (typeof parsed.name !== 'string' || !parsed.name.trim()) {
    throw new Error('В ответе ИИ отсутствует или пустое поле "name"');
  }
  if (typeof parsed.description !== 'string' || !parsed.description.trim()) {
    throw new Error('В ответе ИИ отсутствует или пустое поле "description"');
  }
  if (parsed.description.length > 500) {
    // Обрезка "в лоб" может разорвать HTML-тег посередине (например, "<li>Компакт")
    // и сломать XML/валидатор маркетплейса. Обрезаем по границе последнего целого тега.
    parsed.description = truncateAtTagBoundary(parsed.description, 500);
  }
  if (!Array.isArray(parsed.params)) {
    parsed.params = [];
  }
  if (typeof parsed.categoryTopLevel !== 'string' || !parsed.categoryTopLevel.trim()) {
    throw new Error('В ответе ИИ отсутствует или пустое поле "categoryTopLevel"');
  }

  return {
    name: parsed.name.trim(),
    description: parsed.description.trim(),
    params: parsed.params.filter((p) => p && p.name && p.value),
    categoryTopLevel: parsed.categoryTopLevel.trim(),
  };
}

function getProviderFn(providerName) {
  switch (providerName) {
    case 'openai':
      return callOpenAI;
    case 'gemini':
      return callGemini;
    case 'mock':
      return callMock;
    default:
      throw new Error(`Неизвестный AI_PROVIDER: "${providerName}". Допустимо: openai, gemini, mock`);
  }
}

/**
 * Генерирует name/description/params/categoryTopLevel для товара через AI с retry-логикой.
 * Бросает исключение, если все попытки исчерпаны — вызывающий код (processor.js)
 * должен поймать её и пометить товар статусом error (см. ТЗ, раздел 5.1).
 */
export async function generateProductContent(item, { brand, topLevelCategories, provider, apiKey, model } = {}) {
  const prompt = buildProductPrompt(item, { brand, topLevelCategories });
  const callFn = getProviderFn(provider);

  let lastError;
  const maxAttempts = RETRY_DELAYS_MS.length + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const rawText = await callFn(prompt, { apiKey, model });
      return parseAndValidate(rawText);
    } catch (err) {
      lastError = err;
      const isLastAttempt = attempt === maxAttempts - 1;
      if (!isLastAttempt) {
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
  }

  throw new Error(`Не удалось получить корректный ответ от ИИ после ${maxAttempts} попыток. Последняя ошибка: ${lastError.message}`);
}

/**
 * Второй, узкий вызов — выбор categoryId из короткого списка кандидатов (см. ТЗ,
 * раздел 3.5: точность важнее экономии, но список короткий, поэтому вызов дешёвый).
 * Та же retry-логика, что и у основного вызова.
 */
export async function selectCategory(generatedName, generatedDescription, candidates, { provider, apiKey, model } = {}) {
  if (candidates.length === 0) {
    throw new Error('Список кандидатов категорий пуст — нечего выбирать');
  }
  const prompt = buildCategorySelectionPrompt(generatedName, generatedDescription, candidates);
  const callFn = getProviderFn(provider);
  const validIds = new Set(candidates.map((c) => c.id));

  let lastError;
  const maxAttempts = RETRY_DELAYS_MS.length + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const rawText = await callFn(prompt, { apiKey, model });
      const cleaned = stripCodeFences(rawText);
      const parsed = JSON.parse(cleaned);
      const categoryId = String(parsed.categoryId ?? '').trim();
      if (!validIds.has(categoryId)) {
        throw new Error(`ИИ вернул categoryId "${categoryId}", которого не было в списке кандидатов`);
      }
      return categoryId;
    } catch (err) {
      lastError = err;
      const isLastAttempt = attempt === maxAttempts - 1;
      if (!isLastAttempt) {
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
  }

  throw new Error(`Не удалось выбрать категорию после ${maxAttempts} попыток. Последняя ошибка: ${lastError.message}`);
}
