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
import { buildXlsxFeed } from './xlsxBuilder.js';

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
  console.log('📥 [upload] Запит отримано');

  let file;
  const fields = {};
  console.log('⏳ [upload] Початок циклу обробки частин...');

  // Таймаут на читання частин (10 секунд)
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Timeout reading multipart parts')), 10000)
  );

  const partsPromise = (async () => {
    let partCount = 0;
    for await (const part of request.parts()) {
      partCount++;
      console.log(`🔍 [upload] Частина #${partCount}, fieldname: ${part.fieldname}`);
      if (part.fieldname === 'file') {
        file = part;
        console.log(`📎 [upload] Знайдено файл: ${file.filename}`);
      } else {
        fields[part.fieldname] = part.value;
        console.log(`📝 [upload] Поле: ${part.fieldname} = ${part.value}`);
      }
    }
    console.log(`✅ [upload] Цикл завершено, оброблено ${partCount} частин`);
  })();

  try {
    await Promise.race([partsPromise, timeoutPromise]);
  } catch (err) {
    console.error('❌ [upload] Помилка або таймаут читання частин:', err.message);
    return reply.code(400).send({
      error: 'Не удалось прочитать файл: возможно, файл поврежден, слишком велик или имеет нестандартный формат. Попробуйте сохранить файл заново или конвертировать в CSV.'
    });
  }

  if (!file) {
    console.error('❌ [upload] Файл не передано');
    return reply.code(400).send({ error: 'Файл не передан' });
  }

  const filename = file.filename;
  const isSupported = /\.(csv|xlsx|xls)$/i.test(filename);
  if (!isSupported) {
    console.error('❌ [upload] Непідтримуваний формат:', filename);
    return reply.code(400).send({ error: 'Поддерживаются только форматы .xlsx, .xls, .csv' });
  }

  console.log('⏳ [upload] Читання файлу в буфер...');
  let buffer;
  try {
    buffer = await file.toBuffer();
    console.log(`✅ [upload] Файл прочитано, розмір: ${buffer.length} байт`);
  } catch (err) {
    console.error('❌ [upload] Помилка читання файлу:', err.message);
    return reply.code(400).send({ error: `Не удалось прочитать файл: ${err.message}` });
  }

  console.log('⏳ [upload] Починаємо парсинг...');
  let parsed;
  try {
    parsed = parseSpreadsheet(buffer, filename);
    console.log(`✅ [upload] Парсинг завершено, знайдено рядків: ${parsed.rows.length}, заголовків: ${parsed.headers.length}`);
  } catch (err) {
    console.error('❌ [upload] Помилка парсингу:', err.message);
    return reply.code(400).send({ error: `Не удалось прочитать файл: ${err.message}` });
  }

  console.log('⏳ [upload] Мапінг колонок...');
  const { mapping, missing } = mapColumns(parsed.headers, parsed.rows);
  if (missing.length > 0) {
    console.error('❌ [upload] Відсутні обов\'язкові колонки:', missing);
    return reply.code(400).send({
      error: `Не найдены обязательные колонки: ${missing.join(', ')}. Проверьте заголовки файла.`,
    });
  }
  console.log('✅ [upload] Мапінг завершено:', mapping);

  console.log('⏳ [upload] Застосування мапінгу до даних...');
  const rawItems = applyMapping(parsed.rows, mapping);
  console.log(`✅ [upload] Отримано ${rawItems.length} товарів`);

  if (rawItems.length === 0) {
    console.warn('⚠️ [upload] Немає даних для обробки');
    return reply.code(400).send({ error: 'В файле нет строк с данными (только заголовок или файл пуст)' });
  }

  console.log('⏳ [upload] Створення задачі...');
  const job = createJob({
    filename,
    totalItems: rawItems.length,
    rawItems,
    context: fields.context || '',
    brand: fields.brand || '',
    productType: fields.productType || '',
    descriptionRequirements: fields.descriptionRequirements || '',
  });
  console.log(`✅ [upload] Задачу створено з ID: ${job.id}`);

  console.log('⏳ [upload] Запуск фонової обробки...');
  processJob(job.id).catch((err) => {
    console.error(`❌ [upload] Помилка обробки задачі ${job.id}:`, err);
    fastify.log.error(err);
  });
  console.log('✅ [upload] Фонова обробка запущена');

  const response = {
    requestId: job.id,
    totalItems: rawItems.length,
    truncated: parsed.truncated,
    totalRowsInFile: parsed.totalRowsInFile,
  };
  console.log('📤 [upload] Відправка відповіді:', response);
  return reply.code(202).send(response);
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

fastify.get('/api/jobs/:id/download-xlsx', async (request, reply) => {
  const job = getJob(request.params.id);
  if (!job) {
    return reply.code(404).send({ error: 'Задача не найдена' });
  }
  if (job.status !== 'completed') {
    return reply.code(409).send({ error: `Задача ещё не завершена (статус: ${job.status})` });
  }
  const publicJob = toPublicJob(job);
  if (publicJob.items.filter((it) => it && (it.status === 'success' || it.status === 'warning')).length === 0) {
    return reply.code(422).send({ error: 'Ни один товар не попал в фид (все со статусом error) — скачивать нечего' });
  }

  try {
    const xlsxBuffer = buildXlsxFeed(publicJob, {
      defaultCategoryId: process.env.DEFAULT_CATEGORY_ID || '1',
    });

    reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', 'attachment; filename="feed.xlsx"')
      .send(xlsxBuffer);
  } catch (err) {
    reply.code(500).send({ error: `Не удалось создать XLSX: ${err.message}` });
  }
});

const port = process.env.PORT || 3000;
fastify.listen({ port, host: '0.0.0.0' }).catch((err) => {
  fastify.log.error(err);
  process.exit(1);
});