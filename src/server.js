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
import { buildYmlFeed, countFeedItems } from './xmlBuilder.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_FILE_SIZE = 5 * 1024 * 1024;

const fastify = Fastify({ logger: true });
await fastify.register(multipart, { limits: { fileSize: MAX_FILE_SIZE } });
await fastify.register(staticPlugin, {
  root: path.join(__dirname, '..', 'public'),
  prefix: '/',
});

fastify.get('/api/health', async () => ({ ok: true }));

fastify.post('/api/upload', async (request, reply) => {
  let file;
  const fields = {};

  for await (const part of request.parts()) {
    if (part.fieldname === 'file') {
      file = part;
    } else {
      fields[part.fieldname] = part.value;
    }
  }

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

  const { mapping, missing } = mapColumns(parsed.headers, parsed.rows);
  if (missing.length > 0) {
    return reply.code(400).send({
      error: `Не найдены обязательные колонки: ${missing.join(', ')}. Проверьте заголовки файла.`,
    });
  }

  const rawItems = applyMapping(parsed.rows, mapping);

  if (rawItems.length === 0) {
    return reply.code(400).send({ error: 'В файле нет строк с данными (только заголовок или файл пуст)' });
  }

  const job = createJob({
    filename,
    totalItems: rawItems.length,
    rawItems,
    context: fields.context || '',
    brand: fields.brand || '',
    productType: fields.productType || '',
    descriptionRequirements: fields.descriptionRequirements || '',
  });

  processJob(job.id).catch((err) => fastify.log.error(err));

  return reply.code(202).send({
    requestId: job.id,
    totalItems: rawItems.length,
    truncated: parsed.truncated,
    totalRowsInFile: parsed.totalRowsInFile,
  });
});

fastify.get('/api/jobs/:id', async (request, reply) => {
  const job = getJob(request.params.id);
  if (!job) {
    return reply.code(404).send({ error: 'Задача не найдена' });
  }
  return toPublicJob(job);
});

fastify.get('/api/jobs/:id/download', async (request, reply) => {
  const job = getJob(request.params.id);
  if (!job) {
    return reply.code(404).send({ error: 'Задача не найдена' });
  }
  if (job.status !== 'completed') {
    return reply.code(409).send({ error: `Задача ещё не завершена (статус: ${job.status})` });
  }
  const publicJob = toPublicJob(job);
  if (countFeedItems(publicJob) === 0) {
    return reply.code(422).send({ error: 'Ни один товар не попал в фид (все со статусом error) — скачивать нечего' });
  }

  const xml = buildYmlFeed(publicJob, {
    defaultCategoryId: process.env.DEFAULT_CATEGORY_ID || '1',
  });

  reply
    .header('Content-Type', 'application/xml; charset=utf-8')
    .header('Content-Disposition', 'attachment; filename="feed.xml"')
    .send(xml);
});

const port = process.env.PORT || 3000;
fastify.listen({ port, host: '0.0.0.0' }).catch((err) => {
  fastify.log.error(err);
  process.exit(1);
});