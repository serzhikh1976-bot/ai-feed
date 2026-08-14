import { getJob, updateJob, setItemResult, JOB_STATUS, ITEM_STATUS } from './jobStore.js';
import { isValidImageUrl } from './columnMapper.js';
import { generateProductContent } from './aiClient.js';

const PLACEHOLDER_IMAGE = 'https://your-service.com/placeholder.jpg';

const AI_CONFIG = {
  provider: process.env.AI_PROVIDER || 'mock',
  apiKey: process.env.AI_PROVIDER === 'gemini' ? process.env.GOOGLE_AI_API_KEY : process.env.OPENAI_API_KEY,
  model: process.env.AI_MODEL, // если не задано — провайдер использует дефолт из ТЗ
  brand: process.env.DEFAULT_BRAND || null,
};

// Небольшая пауза между СТРОКАМИ (не между ретраями одной строки — та задержка внутри aiClient)
// нужна, чтобы не упереться в rate limit при последовательной обработке 20 товаров.
const INTER_ITEM_DELAY_MS = 300;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function validateFields(raw) {
  if (!raw.sku) {
    return { valid: false, message: 'Пустой артикул — товар пропущен' };
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

function resolveImage(raw) {
  const hasValidImage = isValidImageUrl(raw.image);
  if (hasValidImage) {
    return { resolvedImage: raw.image, imageWarning: null };
  }
  const warning = raw.image
    ? `Значение в колонке картинки не похоже на ссылку ("${raw.image}") — подставлена заглушка`
    : 'Ссылка на изображение отсутствует — подставлена заглушка';
  return { resolvedImage: PLACEHOLDER_IMAGE, imageWarning: warning };
}

/** Запускает фоновую обработку job'а. Не await'ится вызывающим кодом (fire-and-forget). */
export async function processJob(jobId) {
  const job = getJob(jobId);
  if (!job) return;

  updateJob(jobId, { status: JOB_STATUS.PROCESSING });

  try {
    for (let i = 0; i < job.items.length; i += 1) {
      const raw = job.items[i];

      // Шаг 1: валидация полей до траты денег на AI API (см. ТЗ — не гонять ИИ на заведомо битых строках).
      const fieldCheck = validateFields(raw);
      if (!fieldCheck.valid) {
        setItemResult(jobId, i, { ...raw, status: ITEM_STATUS.ERROR, message: fieldCheck.message });
        continue;
      }

      const { resolvedImage, imageWarning } = resolveImage(raw);

      // Шаг 2: генерация контента через ИИ (с retry внутри aiClient).
      try {
        const generated = await generateProductContent(raw, {
          brand: AI_CONFIG.brand,
          provider: AI_CONFIG.provider,
          apiKey: AI_CONFIG.apiKey,
          model: AI_CONFIG.model,
        });

        setItemResult(jobId, i, {
          ...raw,
          status: imageWarning ? ITEM_STATUS.WARNING : ITEM_STATUS.SUCCESS,
          message: imageWarning,
          resolvedImage,
          generatedName: generated.name,
          generatedDescription: generated.description,
          generatedParams: generated.params,
        });
      } catch (aiErr) {
        setItemResult(jobId, i, {
          ...raw,
          status: ITEM_STATUS.ERROR,
          message: `Ошибка ИИ: ${aiErr.message}`,
          resolvedImage,
        });
      }

      if (i < job.items.length - 1) {
        await sleep(INTER_ITEM_DELAY_MS);
      }
    }
    updateJob(jobId, { status: JOB_STATUS.COMPLETED });
  } catch (err) {
    updateJob(jobId, { status: JOB_STATUS.FAILED, error: err.message });
  }
}
