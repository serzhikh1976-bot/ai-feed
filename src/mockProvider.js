// ВНИМАНИЕ: это заглушка ТОЛЬКО для локальной проверки пайплайна (retry, парсинг JSON,
// склейка с job/processor) без реальных затрат на AI API. Никогда не использовать в проде —
// переключается через AI_PROVIDER=mock в .env, что явно недопустимо для реальных клиентов.
// Имитирует часть "проблемных" случаев (невалидный JSON на первой попытке), чтобы retry-логика
// была проверена честно, а не только на счастливом пути.

let callCount = 0;

export async function callMock({ user }) {
  callCount += 1;

  // Каждый третий вызов имитирует сбой (невалидный JSON) — чтобы проверить retry.
  if (callCount % 3 === 0) {
    return 'это не JSON, а имитация сбоя ИИ для проверки retry-логики';
  }

  // Второй (узкий) промпт — выбор categoryId из списка кандидатов. Отличаем по маркеру в тексте.
  if (user.includes('categoryId')) {
    const idMatch = user.match(/id="([^"]+)"/); // берём первый предложенный кандидат — этого достаточно для мока
    const categoryId = idMatch ? idMatch[1] : '1';
    return JSON.stringify({ categoryId });
  }

  const skuMatch = user.match(/Артикул:\s*(\S+)/);
  const sku = skuMatch ? skuMatch[1] : 'UNKNOWN';
  // Список категорий идёт ПОСЛЕ маркера — иначе регэксп цепляет "- Артикул: ..." из блока данных товара.
  const afterMarker = user.split('Список верхнеуровневых категорий маркетплейса')[1] || '';
  const topLevelMatch = afterMarker.match(/- ([^\n]+)\n/);

  return JSON.stringify({
    name: `[MOCK] Товар ${sku} — назва українською`,
    vendor: 'No Name',
    description: `<p>Це тестовий опис товару ${sku}, згенерований мок-провайдером для перевірки конвеєра без реального звернення до AI API.</p><ul><li>Тестова характеристика 1</li><li>Тестова характеристика 2</li></ul>`,
    params: [
      { name: 'Тестовий параметр', value: 'значення' },
    ],
    categoryTopLevel: topLevelMatch ? topLevelMatch[1].trim() : 'Товари, загальне',
  });
}
