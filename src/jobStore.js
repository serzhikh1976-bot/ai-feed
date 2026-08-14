import { nanoid } from 'nanoid';

// MVP: job'ы храним в памяти процесса. Согласно ТЗ (раздел "Асинхронная обработка"),
// на реальных объёмах это стоит перенести в БД (та же, где считается email-лимит),
// но для каркаса и локального тестирования in-memory Map полностью достаточен.
// Известное ограничение: перезапуск процесса = все job'ы теряются (см. ТЗ, известные ограничения MVP).

const jobs = new Map();

export const JOB_STATUS = {
  QUEUED: 'queued',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

export const ITEM_STATUS = {
  PENDING: 'pending',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error',
};

export function createJob({ filename, totalItems, rawItems = [] }) {
  const id = nanoid(12);
  const job = {
    id,
    status: JOB_STATUS.QUEUED,
    filename,
    totalItems,
    processedItems: 0,
    // Каждый элемент — исходные данные товара + статус обработки.
    // На этом этапе (без AI) статус проставляется валидацией полей;
    // на этапе интеграции с AI сюда же добавятся сгенерированные name/description/param.
    items: rawItems.map((raw) => ({ ...raw, status: ITEM_STATUS.PENDING, message: null })),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    error: null,
  };
  jobs.set(id, job);
  return job;
}

export function getJob(id) {
  return jobs.get(id) ?? null;
}

export function updateJob(id, patch) {
  const job = jobs.get(id);
  if (!job) return null;
  Object.assign(job, patch, { updatedAt: Date.now() });
  return job;
}

export function setItemResult(id, index, result) {
  const job = jobs.get(id);
  if (!job) return null;
  job.items[index] = result;
  job.processedItems = job.items.filter((i) => i && i.status !== ITEM_STATUS.PENDING).length;
  job.updatedAt = Date.now();
  return job;
}

/** Публичное представление job'а для API-ответа (без внутренних деталей). */
export function toPublicJob(job) {
  if (!job) return null;
  const successCount = job.items.filter((i) => i?.status === ITEM_STATUS.SUCCESS).length;
  const warningCount = job.items.filter((i) => i?.status === ITEM_STATUS.WARNING).length;
  const errorCount = job.items.filter((i) => i?.status === ITEM_STATUS.ERROR).length;
  return {
    id: job.id,
    status: job.status,
    filename: job.filename,
    totalItems: job.totalItems,
    processedItems: job.processedItems,
    counts: { success: successCount, warning: warningCount, error: errorCount },
    items: job.items,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}
