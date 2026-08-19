import { buildProductPrompt, buildCategorySelectionPrompt } from './promptBuilder.js';
import { callOpenAI, callGemini } from './aiProviders.js';
import { callMock } from './mockProvider.js';

const RETRY_DELAYS_MS = [3000, 7000];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripCodeFences(text) {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
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
  if (parsed.description.length > 2000) {
    parsed.description = parsed.description.slice(0, 2000);
  }
  if (!Array.isArray(parsed.params)) {
    parsed.params = [];
  }

  const seoTitle = parsed.seoTitle && typeof parsed.seoTitle === 'string' ? parsed.seoTitle.trim() : '';
  const seoDescription = parsed.seoDescription && typeof parsed.seoDescription === 'string' ? parsed.seoDescription.trim() : '';
  const searchQueries = parsed.searchQueries && typeof parsed.searchQueries === 'string' ? parsed.searchQueries.trim() : '';
  const categoryTopLevel = parsed.categoryTopLevel && typeof parsed.categoryTopLevel === 'string' ? parsed.categoryTopLevel.trim() : '';
  const vendor = parsed.vendor && typeof parsed.vendor === 'string' ? parsed.vendor.trim() : 'No Name';

  return {
    name: parsed.name.trim(),
    description: parsed.description.trim(),
    params: parsed.params.filter((p) => p && p.name && p.value),
    seoTitle,
    seoDescription,
    searchQueries,
    categoryTopLevel,
    vendor,
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

export async function generateProductContent(item, {
  brand,
  topLevelCategories,
  provider,
  apiKey,
  model,
  fileContext = '',
  productType = '',
  descriptionRequirements = '',
  extraFields = {},
} = {}) {
  const prompt = buildProductPrompt(item, {
    brand,
    topLevelCategories,
    fileContext,
    productType,
    descriptionRequirements,
    extraFields,
  });
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

export async function selectCategory(generatedName, generatedDescription, candidates, { provider, apiKey, model, fileContext = '', extraFields = {} } = {}) {
  if (candidates.length === 0) {
    throw new Error('Список кандидатов категорий пуст — нечего выбирать');
  }
  const prompt = buildCategorySelectionPrompt(generatedName, generatedDescription, candidates, fileContext, extraFields);
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