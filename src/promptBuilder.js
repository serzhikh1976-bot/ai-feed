// src/promptBuilder.js

export function buildProductPrompt(row, context) {
  const {
    brand = '',
    productType = '',
    descriptionRequirements = '',
    fileContext = '',
  } = context;

  const allColumns = Object.entries(row)
    .filter(([key, val]) => val && val.toString().trim())
    .map(([key, val]) => `${key}: ${val}`)
    .join('\n');

  const sku = row['Артикул'] || row['sku'] || row['Код'] || '';
  const price = row['Цена'] || row['price'] || '';
  const nameInput = row['Название'] || row['name'] || '';

  return `
Ти — експерт з наповнення карток товарів для Prom.ua.
Твоє завдання — створити ідеальну картку товару на основі наданих даних, суворо дотримуючись правил нижче.

### ВХІДНІ ДАНІ:

**Контекст файлу (загальна інформація про категорію):**
${fileContext || 'Не вказано'}

**Бренд (застосовуй його для всіх товарів, якщо вказано):**
${brand || 'Не вказано, визнач з назви або залиш порожнім'}

**Тип товару (категоріальна група):**
${productType || 'Визнач самостійно на основі назви'}

**Особливі вимоги до опису:**
${descriptionRequirements || 'Без додаткових вимог'}

**Дані з файлу (всі колонки):**
${allColumns}

---

### ПРАВИЛА СТВОРЕННЯ КАРТКИ:

1. **НАЗВА (name)**
   - Формула: \`{Тип} {Бренд} {Головна характеристика (колір/розмір/модель)}\`
   - ❌ **ЗАБОРОНЕНО** додавати артикул (код, sku) у назву. Він йде окремо.
   - ❌ **ЗАБОРОНЕНО** писати "No Name" або "Невідомий бренд". Якщо бренду немає — просто пропусти його.

2. **ОПИС (description)** з HTML-структурою (теги <h3>, <ul>, <li>, <b>).

3. **ПАРАМЕТРИ (params) — НАЙВАЖЛИВІШЕ ДЛЯ XLSX**
   - Кожен параметр має бути об'єктом з трьома полями:
     \`{ "name": "Назва", "value": "Число або текст", "unit": "Одиниця виміру" }\`
   - **Правило для одиниць виміру:**
     - Якщо параметр має числове значення (висота, вага, довжина, потужність) — **відокремлюй число від одиниці**.
     - ✅ Приклад: \`{ "name": "Висота", "value": "55", "unit": "см" }\`
     - ✅ Приклад: \`{ "name": "Вага", "value": "1.2", "unit": "кг" }\`
     - Якщо параметр текстовий (бренд, колір, матеріал, країна) — \`"value"\` містить текст, а \`"unit"\` залишай порожнім \`""\`.
     - ✅ Приклад: \`{ "name": "Колір", "value": "Білий", "unit": "" }\`
     - ✅ Приклад: \`{ "name": "Матеріал", "value": "Пластик", "unit": "" }\`

4. **ПОШУКОВІ ЗАПИТИ (search_queries)** — рядок через кому з пробілом.

5. **SEO-ПОЛЯ (html_title, html_description)** — до 70/160 символів.

---

### ФОРМАТ ВІДПОВІДІ (суворо JSON):

\`\`\`json
{
  "name": "Лялька інтерактивна ArtSpace 55 см",
  "description": "<h3>Опис</h3><p>...</p><h3>Характеристики</h3><ul><li><b>...</b></li></ul>",
  "params": [
    { "name": "Бренд", "value": "ArtSpace", "unit": "" },
    { "name": "Висота", "value": "55", "unit": "см" },
    { "name": "Країна виробництва", "value": "Китай", "unit": "" },
    { "name": "Колір", "value": "Рожевий", "unit": "" },
    { "name": "Вага", "value": "0.8", "unit": "кг" }
  ],
  "search_queries": "лялька, інтерактивна лялька, лялька ходяча",
  "html_title": "Купити інтерактивну ляльку ArtSpace 55 см",
  "html_description": "Інтерактивна лялька ArtSpace 55 см з великим функціоналом. Подарунок для дитини.",
  "type": "ro",
  "vendorCode": "545"
}
\`\`\`

**Увага!** Поле \`vendorCode\` — це артикул з файлу. Він має бути ТІЛЬКИ тут.

Тепер згенеруй відповідь для цього товару:
`;
}

export function buildCategorySelectionPrompt(generatedName, generatedDescription, candidates, fileContext = '', extraFields = {}) {
  const list = candidates.map((c) => `- id="${c.id}": ${c.path.join(' > ')}`).join('\n');

  const contextPart = fileContext 
    ? `Загальний контекст файлу: "${fileContext}". Враховуй це при виборі категорії — віддавай перевагу категоріям, що відповідають цьому контексту.` 
    : '';

  const extraFieldsEntries = Object.entries(extraFields).filter(([_, value]) => value && String(value).trim() !== '');
  const extraFieldsPart = extraFieldsEntries.length > 0
    ? `Додаткові дані про товар (використовуй їх для точнішого вибору категорії):\n${extraFieldsEntries.map(([key, value]) => `- ${key}: ${value}`).join('\n')}`
    : '';

  const system = `Ти обираєш найбільш підходящу категорію маркетплейсу для товару.
ОБОВ'ЯЗКОВО відповідай ТІЛЬКИ валідним JSON без markdown-розмітки і пояснень.
${contextPart}`;

  const user = `Товар: "${generatedName}"
Опис: ${stripHtml(generatedDescription)}

${extraFieldsPart ? extraFieldsPart + '\n' : ''}

Список кандидатів категорій (обери ОДИН, найбільш точний за змістом):
${list}

Поверни JSON строго такого вигляду:
{ "categoryId": "id одного варіанту зі списку вище, ДОСЛІВНО" }

Правила:
- categoryId ОБОВ'ЯЗКОВО має бути одним із id зі списку вище — ніколи не вигадуй новий id.
- Якщо жоден варіант не підходить ідеально — обери найближчий за змістом із запропонованих.
- Використовуй бренд, модель, колір, розмір, матеріал з додаткових даних для точнішого вибору.
- Поверни ТІЛЬКИ JSON, нічого більше.`;

  return { system, user };
}

function stripHtml(html) {
  return String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}