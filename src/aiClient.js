import { buildProductPrompt } from './promptBuilder.js';
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
    // Не фатально — обрезаем и продолжаем, но это стоит логировать на проде.
    parsed.description = parsed.description.slice(0, 500);
  }
  if (!Array.isArray(parsed.params)) {
    parsed.params = [];
  }

  return {
    name: parsed.name.trim(),
    description: parsed.description.trim(),
    params: parsed.params.filter((p) => p && p.name && p.value),
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
 * Генерирует name/description/params для товара через AI с retry-логикой.
 * Бросает исключение, если все попытки исчерпаны — вызывающий код (processor.js)
 * должен поймать её и пометить товар статусом error (см. ТЗ, раздел 5.1).
 */
export async function generateProductContent(item, { brand, provider, apiKey, model } = {}) {
  const prompt = buildProductPrompt(item, { brand });
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
