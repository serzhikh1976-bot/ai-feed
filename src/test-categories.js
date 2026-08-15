import { getCategoryCandidates, getCategoryDirectoryStatus } from './categoryDirectory.js';

const FILE = '/home/claude/ai-feed-generator/data/prom_categories.xls';

const status = getCategoryDirectoryStatus(FILE);
console.log('Справочник:', status);
console.log();

const testProducts = [
  { label: 'Футболка Nike мужская (test1)', text: 'Футболка Nike мужская черная хлопковая' },
  { label: 'Кабель Type-C to Type-C 100W (test2, сложный случай)', text: 'Кабель синхр. Type-C to Type-C 100W 1m blk, тканевая оплетка, быстрая зарядка Power Delivery' },
  { label: 'Павербанк 20000mAh (test2)', text: 'Павербанк 20000mAh 22.5W QC3.0, литий-полимерный, дисплей' },
  { label: 'Адаптер сетевой GaN 65W (test2)', text: 'Адаптер сет. GaN 65W 2xType-C+USB быстрое зарядное устройство' },
];

for (const p of testProducts) {
  console.log('=== ' + p.label + ' ===');
  const candidates = getCategoryCandidates(p.text, FILE, 15);
  console.log(`Найдено кандидатов: ${candidates.length}`);
  candidates.slice(0, 8).forEach((c, i) => {
    console.log(`  ${i + 1}. [${c.id}] ${c.path.join(' > ')}`);
  });
  console.log();
}
