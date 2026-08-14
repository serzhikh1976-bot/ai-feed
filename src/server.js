import 'dotenv/config';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSpreadsheet } from './parser.js';
import { mapColumns, applyMapping } from './columnMapper.js';
import { createJob, getJob, toPublicJob } from './jobStore.js';
import { processJob } from './processor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 МБ — см. ТЗ, валидация загрузки

const fastify = Fastify({ logger: true });
await fastify.register(multipart, { limits: { fileSize: MAX_FILE_SIZE } });
await fastify.register(staticPlugin, {
  root: path.join(__dirname, '..', 'public'),
  prefix: '/',
});

fastify.get('/api/health', async () => ({ ok: true }));

// Этап 1: приём файла, парсинг, маппинг, создание job'а и запуск фоновой обработки.
fastify.post('/api/upload', async (request, reply) => {
  const file = await request.file();
  if (!file) {
    return reply.code(400).send({ error: 'Файл не передан' });
  }

  const filename = file.filename;
  const isSupported = /\.(csv|xlsx|xls)$/i.test(filename);
  if (!isSupported) {
    return reply.code(400).send({ error: 'Поддерживаются только форматы .xlsx, .xls, .csv' });
  }

  const buffer = await file.toBuffer();

  let parsed;
  try {
    parsed = parseSpreadsheet(buffer, filename);
  } catch (err) {
    return reply.code(400).send({ error: `Не удалось прочитать файл: ${err.message}` });
  }

  const { mapping, missing } = mapColumns(parsed.headers);
  if (missing.length > 0) {
    return reply.code(400).send({
      error: `Не найдены обязательные колонки: ${missing.join(', ')}. Проверьте заголовки файла.`,
    });
  }

  const rawItems = applyMapping(parsed.rows, mapping);

  if (rawItems.length === 0) {
    return reply.code(400).send({ error: 'В файле нет строк с данными (только заголовок или файл пуст)' });
  }

  const job = createJob({ filename, totalItems: rawItems.length, rawItems });

  // Fire-and-forget: не блокируем HTTP-ответ обработкой (см. ТЗ, "Асинхронная обработка").
  processJob(job.id).catch((err) => fastify.log.error(err));

  return reply.code(202).send({
    requestId: job.id,
    totalItems: rawItems.length,
    truncated: parsed.truncated,
    totalRowsInFile: parsed.totalRowsInFile,
  });
});

// Опрос статуса job'а — фронтенд будет дёргать это раз в 2-3 сек (polling).
fastify.get('/api/jobs/:id', async (request, reply) => {
  const job = getJob(request.params.id);
  if (!job) {
    return reply.code(404).send({ error: 'Задача не найдена' });
  }
  return toPublicJob(job);
});

const port = process.env.PORT || 3000;
fastify.listen({ port, host: '0.0.0.0' }).catch((err) => {
  fastify.log.error(err);
  process.exit(1);
});
