import {
  getJob,
  updateJob,
  setItemResult,
  JOB_STATUS,
  ITEM_STATUS,
} from "./jobStore.js";

import { isValidImageUrl, isConfidentImageUrl, isDirectImageUrl } from './columnMapper.js';
import { generateProductContent, selectCategory } from "./aiClient.js";
import {
  getTopLevelCategories,
  getBranchCandidates,
  getCategoryCandidates,
  getCategoryDirectoryStatus,
} from "./categoryDirectory.js";

const PLACEHOLDER_IMAGE = "https://dummyimage.com/300.png/09f/fff";
const CATEGORY_FILE =
  process.env.CATEGORY_DIRECTORY_FILE || "./data/prom_categories.xls";
const DEFAULT_CATEGORY_ID = process.env.DEFAULT_CATEGORY_ID || "1";

const AI_CONFIG = {
  provider: process.env.AI_PROVIDER || "mock",
  apiKey:
    process.env.AI_PROVIDER === "gemini"
      ? process.env.GOOGLE_AI_API_KEY
      : process.env.OPENAI_API_KEY,
  model: process.env.AI_MODEL,
  brand: process.env.DEFAULT_BRAND || null,
};

const categoryDirStatus = getCategoryDirectoryStatus(CATEGORY_FILE);
const topLevelCategories = categoryDirStatus.available
  ? getTopLevelCategories(CATEGORY_FILE)
  : [];
if (!categoryDirStatus.available) {
  console.warn(
    `[categories] Справочник не найден по пути "${CATEGORY_FILE}" — используется DEFAULT_CATEGORY_ID="${DEFAULT_CATEGORY_ID}" для всех товаров.`,
  );
}

const INTER_ITEM_DELAY_MS = 10000;
const INTRA_ITEM_DELAY_MS = 10000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function validateFields(raw) {
  if (!raw.sku) {
    return { valid: false, message: "Пустой артикул — товар пропущен" };
  }
  if (raw.sku.length > 25) {
    return {
      valid: false,
      message: `Артикул длиннее 25 символов ("${raw.sku}", ${raw.sku.length} симв.) — превышен лимит Prom.ua`,
    };
  }
  if (!raw.name) {
    return { valid: false, message: "Пустое название товара" };
  }
  const priceNum = Number(
    String(raw.price).replace(",", ".").replace(/\s/g, ""),
  );
  if (!raw.price || Number.isNaN(priceNum) || priceNum <= 0) {
    return { valid: false, message: `Некорректная цена: "${raw.price}"` };
  }
  return { valid: true };
}

function resolveImage(raw, { strictCheck = false } = {}) {
  const hasValidImage = isValidImageUrl(raw.image);
  if (hasValidImage && !isDirectImageUrl(raw.image)) {
    return {
      resolvedImage: PLACEHOLDER_IMAGE,
      imageWarning: `Посилання не веде на файл зображення ("${raw.image}") — підставлена заглушка`,
    };
  }
  if (hasValidImage && !strictCheck) {
    return { resolvedImage: raw.image, imageWarning: null };
  }
  if (hasValidImage && strictCheck) {
    const confident = isConfidentImageUrl(raw.image);
    if (confident === true) {
      return { resolvedImage: raw.image, imageWarning: null };
    }
    if (confident === false) {
      return {
        resolvedImage: PLACEHOLDER_IMAGE,
        imageWarning: `Колонка изображения определена автоматически, а ссылка похожа на страницу товара, а не на файл картинки ("${raw.image}") — подставлена заглушка, стоит проверить вручную`,
      };
    }
    return {
      resolvedImage: raw.image,
      imageWarning: `Колонка изображения определена автоматически — ссылка похожа на файл, но не подтверждена как картинка ("${raw.image}"), стоит проверить вручную`,
    };
  }
  const warning = raw.image
    ? `Значение в колонке картинки не похоже на ссылку ("${raw.image}") — подставлена заглушка`
    : "Ссылка на изображение отсутствует — подставлена заглушка";
  return { resolvedImage: PLACEHOLDER_IMAGE, imageWarning: warning };
}

function resolveAvailability(raw, { wholeColumnEmpty = false } = {}) {
  const value = String(raw.availability ?? "").trim();
  if (value === "") {
    if (wholeColumnEmpty) {
      return { available: true, warning: null };
    }
    return {
      available: false,
      warning:
        "Наличие товара не указано в файле поставщика — товар помечен как отсутствующий (правило Prom.ua)",
    };
  }
  if (value === "+" || /^!$/.test(value)) {
    return { available: true, warning: null };
  }
  if (value === "-" || value === "0") {
    return { available: false, warning: null };
  }
  const num = Number(value.replace(",", "."));
  if (!Number.isNaN(num)) {
    return { available: num > 0, warning: null };
  }
  return {
    available: false,
    warning: `Не удалось распознать значение наличия ("${value}") — товар помечен как отсутствующий`,
  };
}

async function resolveCategory(generated, raw, fileContext = "") {
  if (!categoryDirStatus.available) {
    return {
      categoryId: DEFAULT_CATEGORY_ID,
      categoryPath: null,
      warning:
        "Справочник категорий не подключён — использована категория по умолчанию",
    };
  }

  const productText = `${generated.name} ${generated.description}`;
  let candidates = getBranchCandidates(
    productText,
    CATEGORY_FILE,
    generated.categoryTopLevel,
    12,
  );

  let warningPrefix = null;
  if (candidates.length === 0) {
    candidates = getCategoryCandidates(productText, CATEGORY_FILE, 15);
    warningPrefix = `ИИ вернул неизвестную ветку категорий ("${generated.categoryTopLevel}") — выполнен поиск по всему справочнику`;
  }

  if (candidates.length === 0) {
    return {
      categoryId: DEFAULT_CATEGORY_ID,
      categoryPath: null,
      warning:
        "Не найдено ни одного кандидата категории — использована категория по умолчанию",
    };
  }

  try {
    const categoryId = await selectCategory(
      generated.name,
      generated.description,
      candidates,
      {
        provider: AI_CONFIG.provider,
        apiKey: AI_CONFIG.apiKey,
        model: AI_CONFIG.model,
        fileContext: fileContext,
      },
    );
    const chosen = candidates.find((c) => c.id === categoryId);
    return {
      categoryId,
      categoryPath: chosen?.path ?? null,
      warning: warningPrefix,
    };
  } catch (err) {
    const fallback = candidates[0];
    return {
      categoryId: fallback.id,
      categoryPath: fallback.path,
      warning: `Автовыбор категории не удался (${err.message}) — использован ближайший найденный вариант, стоит проверить`,
    };
  }
}

export async function processJob(jobId, { imageColumnGuessed = false } = {}) {
  const job = getJob(jobId);
  if (!job) return;
  const { context = '', brand: globalBrand = '', productType = '', descriptionRequirements = '' } = job;

  updateJob(jobId, { status: JOB_STATUS.PROCESSING });

  const wholeColumnEmpty = job.items.every(
    (it) => String(it.availability ?? "").trim() === "",
  );

  try {
    for (let i = 0; i < job.items.length; i += 1) {
      const raw = job.items[i];

      const fieldCheck = validateFields(raw);
      if (!fieldCheck.valid) {
        setItemResult(jobId, i, {
          ...raw,
          status: ITEM_STATUS.ERROR,
          message: fieldCheck.message,
        });
        continue;
      }

      const { resolvedImage, imageWarning } = resolveImage(raw, {
        strictCheck: imageColumnGuessed,
      });
      const { available, warning: availabilityWarning } = resolveAvailability(
        raw,
        { wholeColumnEmpty },
      );

      try {
        const generated = await generateProductContent(raw, {
          brand: globalBrand,
          topLevelCategories,
          provider: AI_CONFIG.provider,
          apiKey: AI_CONFIG.apiKey,
          model: AI_CONFIG.model,
          fileContext: context,
          productType,
          descriptionRequirements,
        });
        await sleep(INTRA_ITEM_DELAY_MS);
        const categoryResult = await resolveCategory(generated, raw, context);

        // Принудительная подстановка бренда, если задан пользователем
        let vendorValue = generated.vendor;
        if (globalBrand && (!vendorValue || vendorValue === 'No Name')) {
          vendorValue = globalBrand;
        }

        const warnings = [
          imageWarning,
          availabilityWarning,
          categoryResult.warning,
        ].filter(Boolean);
        setItemResult(jobId, i, {
          ...raw,
          status:
            warnings.length > 0 ? ITEM_STATUS.WARNING : ITEM_STATUS.SUCCESS,
          message: warnings.length > 0 ? warnings.join(" | ") : null,
          resolvedImage,
          available,
          generatedName: generated.name,
          generatedDescription: generated.description,
          generatedParams: generated.params,
          vendor: vendorValue,
          categoryId: categoryResult.categoryId,
          categoryPath: categoryResult.categoryPath,
          seoTitle: generated.seoTitle || "",
          seoDescription: generated.seoDescription || "",
          searchQueries: generated.searchQueries || "",
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
    updateJob(jobId, { status: JOB_STATUS.COMPLETED });
  } catch (err) {
    updateJob(jobId, { status: JOB_STATUS.FAILED, error: err.message });
  }
}