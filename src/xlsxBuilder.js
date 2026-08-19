import * as XLSX from 'xlsx';

export function buildXlsxFeed(job, opts = {}) {
  const defaultCategoryId = opts.defaultCategoryId || '1';
  const includedItems = job.items.filter(
    (it) => it && (it.status === 'success' || it.status === 'warning')
  );

  if (includedItems.length === 0) {
    throw new Error('Немає товарів для експорту');
  }

  // Колонки у точному порядку та з назвами з офіційного шаблону
  const columns = [
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
    { key: 'group_id', header: 'Номер_групи' },
    { key: 'group_name', header: 'Назва_групи' },
    { key: 'group_url', header: 'Посилання_підрозділу' },
    { key: 'delivery_possible', header: 'Можливість_поставки' },
    { key: 'delivery_time', header: 'Термін_поставки' },
    { key: 'packaging', header: 'Спосіб_пакування' },
    { key: 'packaging_ua', header: 'Спосіб_пакування_укр' },
    { key: 'unique_id', header: 'Унікальний_ідентифікатор' },
    { key: 'product_id', header: 'Ідентифікатор_товару' },
    { key: 'subdivision_id', header: 'Ідентифікатор_підрозділу' },
    { key: 'category_id', header: 'Ідентифікатор_групи' },
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
    // Далі можна додати блоки характеристик, але поки пропустимо
  ];

  const rows = includedItems.map((item) => {
    // Отримуємо значення для кожної колонки
    const getVal = (key) => {
      switch (key) {
        case 'sku': return item.sku || '';
        case 'name': return item.generatedName || item.name || '';
        case 'name_ua': return item.generatedName || item.name || '';
        case 'search_queries': return item.searchQueries || '';
        case 'search_queries_ru': return item.searchQueries || ''; // або переклад
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
        case 'quantity': return ''; // можна поставити 1, але поки пусто
        case 'group_id': return item.categoryId || defaultCategoryId;
        case 'group_name': return item.categoryPath?.length ? item.categoryPath[item.categoryPath.length - 1] : '';
        case 'group_url': return '';
        case 'delivery_possible': return '';
        case 'delivery_time': return '';
        case 'packaging': return '';
        case 'packaging_ua': return '';
        case 'unique_id': return '';
        case 'product_id': return item.sku || '';
        case 'subdivision_id': return '';
        case 'category_id': return item.categoryId || defaultCategoryId;
        case 'brand': return item.vendor || item.brand || '';
        case 'country': return '';
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

    const row = {};
    columns.forEach((col) => {
      row[col.header] = getVal(col.key);
    });
    return row;
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows, { header: columns.map((c) => c.header) });
  ws['!cols'] = columns.map(() => ({ wch: 20 }));

  // ВАЖЛИВО: назва аркуша має збігатися з офіційним шаблоном
  XLSX.utils.book_append_sheet(wb, ws, 'Export Products Sheet');

  // Другий аркуш не обов'язковий, але якщо хочете – можна додати порожній
  // Зараз залишаємо тільки один аркуш

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}