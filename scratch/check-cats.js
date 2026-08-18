import { loadCategoryDirectory } from '/home/ser/Desktop/version/ai-feed/src/categoryDirectory.js';

const FILE = '/home/ser/Desktop/version/ai-feed/data/prom_categories.xls';
const cats = loadCategoryDirectory(FILE);

const phoneAccessories = cats.filter(c => c.path.join(' > ').includes('Аксесуари для мобільних телефонів'));
console.log('Phone accessories categories:', phoneAccessories.length);
phoneAccessories.forEach(c => {
  console.log(`  [${c.id}] ${c.path.join(' > ')}`);
});
