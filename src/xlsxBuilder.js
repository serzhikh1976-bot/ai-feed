import * as XLSX from 'xlsx';

const MAX_PARAMS = 20; // максимальна кількість характеристик, які експортуємо

export function buildXlsxFeed(job, opts = {}) {
  const defaultCategoryId = opts.defaultCategoryId || '1';
  const includedItems = job.items.filter(
    (it) => it && (it.status === 'success' || it.status === 'warning')
  );

  if (includedItems.length === 0) {
    throw new Error('Немає товарів для експорту');
  }

  // Базові колонки (без характеристик)
  const baseColumns = [
    { key: 'sku', header: 'Код_товару' },
    { key: 'name', header: 'Назва_позиції' },
    { key: 'name_ua', header: 'Назва_позиції_укр' },
    { key: 'search_queries', header: 'Пошукові_запити' },
    { key: 'search_queries_ru', header: 'Пошукові_запити_укр' },
    { key: 'description', header: 'Опис' },
    { key: 'description_ua', header: 'Опис_укр' },
    { key: 'product_type', header: 'Тип_товару' },
    { key: 'price', header: 'Ціна' },
    { key: 'currency', header: 'Валюта' },
    { key: 'unit', header: 'Одиниця_виміру' },
    { key: 'min_order', header: 'Мінімальний_обсяг_замовлення' },
    { key: 'wholesale_price', header: 'Оптова_ціна' },
    { key: 'min_wholesale', header: 'Мінімальне_замовлення_опт' },
    { key: 'image', header: 'Посилання_зображення' },
    { key: 'availability', header: 'Наявність' },
    { key: 'quantity', header: 'Кількість' },
    { key: 'group_url', header: 'Посилання_підрозділу' }, // ← ОСНОВНЕ ДЛЯ КАТЕГОРІЇ
    { key: 'group_id', header: 'Номер_групи' }, // залишаємо, але не заповнюємо
    { key: 'group_name', header: 'Назва_групи' },
    { key: 'delivery_possible', header: 'Можливість_поставки' },
    { key: 'delivery_time', header: 'Термін_поставки' },
    { key: 'packaging', header: 'Спосіб_пакування' },
    { key: 'packaging_ua', header: 'Спосіб_пакування_укр' },
    { key: 'unique_id', header: 'Унікальний_ідентифікатор' },
    { key: 'product_id', header: 'Ідентифікатор_товару' },
    { key: 'subdivision_id', header: 'Ідентифікатор_підрозділу' },
    { key: 'category_id', header: 'Ідентифікатор_групи' }, // залишаємо, але не заповнюємо
    { key: 'brand', header: 'Виробник' },
    { key: 'country', header: 'Країна_виробник' },
    { key: 'discount', header: 'Знижка' },
    { key: 'variant_group_id', header: 'ID_групи_різновидів' },
    { key: 'notes', header: 'Особисті_нотатки' },
    { key: 'site_url', header: 'Продукт_на_сайті' },
    { key: 'discount_from', header: 'Термін_дії_знижки_від' },
    { key: 'discount_to', header: 'Термін_дії_знижки_до' },
    { key: 'price_from', header: 'Ціна_від' },
    { key: 'label', header: 'Ярлик' },
    { key: 'seo_title', header: 'HTML_заголовок' },
    { key: 'seo_title_ua', header: 'HTML_заголовок_укр' },
    { key: 'seo_description', header: 'HTML_опис' },
    { key: 'seo_description_ua', header: 'HTML_опис_укр' },
    { key: 'gifts', header: 'Подарунки' },
    { key: 'related', header: 'Супутні' },
    { key: 'gift_ids', header: 'ID_Подарунків' },
    { key: 'related_ids', header: 'ID_Супутніх' },
    { key: 'gtin', header: 'Код_маркування_(GTIN)' },
    { key: 'mpn', header: 'Номер_пристрою_(MPN)' },
    { key: 'weight', header: 'Вага,кг' },
    { key: 'width', header: 'Ширина,см' },
    { key: 'height', header: 'Висота,см' },
    { key: 'length', header: 'Довжина,см' },
    { key: 'location', header: 'Де_знаходиться_товар' },
    { key: 'to_delete', header: 'Товар_на_видалення' },
    { key: 'delete_reason', header: 'Причина_видалення_товару' },
  ];

  // Генеруємо колонки для характеристик (трійки)
  const paramColumns = [];
  for (let i = 0; i < MAX_PARAMS; i++) {
    const suffix = i === 0 ? '' : `_${i + 1}`;
    paramColumns.push(
      { key: `param_name_${i}`, header: `Назва_Характеристики${suffix}` },
      { key: `param_unit_${i}`, header: `Одиниця_виміру_Характеристики${suffix}` },
      { key: `param_value_${i}`, header: `Значення_Характеристики${suffix}` },
    );
  }

  const allColumns = [...baseColumns, ...paramColumns];

  const rows = includedItems.map((item) => {
    const params = item.generatedParams || [];

    // Функція для отримання значення
    const getVal = (key) => {
      switch (key) {
        case 'sku': return item.sku || '';
        case 'name': return item.generatedName || item.name || '';
        case 'name_ua': return item.generatedName || item.name || '';
        case 'search_queries': return item.searchQueries || '';
        case 'search_queries_ru': return item.searchQueries || '';
        case 'description': return item.generatedDescription || item.description || '';
        case 'description_ua': return item.generatedDescription || item.description || '';
        case 'product_type': return '';
        case 'price': return item.price || '';
        case 'currency': return item.currency || 'UAH';
        case 'unit': return item.unit || 'шт.';
        case 'min_order': return '';
        case 'wholesale_price': return '';
        case 'min_wholesale': return '';
        case 'image': return item.resolvedImage || '';
        case 'availability': return item.available ? '+' : '-';
        case 'quantity': return '';
        case 'group_url': return item.categoryUrl || ''; // ← ОСНОВНЕ: URL категорії
        case 'group_id': return ''; // не заповнюємо
        case 'group_name': return item.categoryPath?.length ? item.categoryPath[item.categoryPath.length - 1] : '';
        case 'delivery_possible': return '';
        case 'delivery_time': return '';
        case 'packaging': return '';
        case 'packaging_ua': return '';
        case 'unique_id': return '';
        case 'product_id': return item.sku || '';
        case 'subdivision_id': return '';
        case 'category_id': return ''; // не заповнюємо
        case 'brand': return item.vendor || item.brand || 'No Name';
        case 'country': return item.country || '';
        case 'discount': return '';
        case 'variant_group_id': return '';
        case 'notes': return '';
        case 'site_url': return '';
        case 'discount_from': return '';
        case 'discount_to': return '';
        case 'price_from': return '';
        case 'label': return '';
        case 'seo_title': return item.seoTitle || '';
        case 'seo_title_ua': return item.seoTitle || '';
        case 'seo_description': return item.seoDescription || '';
        case 'seo_description_ua': return item.seoDescription || '';
        case 'gifts': return '';
        case 'related': return '';
        case 'gift_ids': return '';
        case 'related_ids': return '';
        case 'gtin': return '';
        case 'mpn': return '';
        case 'weight': return item.weight || '';
        case 'width': return item.width || '';
        case 'height': return item.height || '';
        case 'length': return item.length || '';
        case 'location': return '';
        case 'to_delete': return '';
        case 'delete_reason': return '';
        default: return '';
      }
    };

    // Заповнюємо характеристики
    const paramRow = {};
    for (let i = 0; i < MAX_PARAMS; i++) {
      const p = params[i] || {};
      paramRow[`param_name_${i}`] = p.name || '';
      paramRow[`param_unit_${i}`] = ''; // одиниці виміру поки не підтримуємо
      paramRow[`param_value_${i}`] = p.value || '';
    }

    const row = {};
    baseColumns.forEach((col) => {
      row[col.header] = getVal(col.key);
    });
    // Додаємо характеристики до рядка
    Object.assign(row, paramRow);

    return row;
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows, { header: allColumns.map((c) => c.header) });
  ws['!cols'] = allColumns.map(() => ({ wch: 20 }));
  XLSX.utils.book_append_sheet(wb, ws, 'Export Products Sheet');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}