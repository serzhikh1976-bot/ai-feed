import { getCategoryCandidates, getBranchCandidates } from '/home/ser/Desktop/version/ai-feed/src/categoryDirectory.js';

const FILE = '/home/ser/Desktop/version/ai-feed/data/prom_categories.xls';

// Test power strip - full search (since it's in Електрообладнання, not Техніка та електроніка)
console.log('=== Мережевий фільтр — full search ===');
const full = getCategoryCandidates('Мережевий фільтр електричний подовжувач живлення', FILE, 8);
full.forEach(c => console.log(`  [${c.id}] ${c.path.join(' > ')}`));

// Also test with the Електрообладнання branch directly
console.log('\n=== Мережевий фільтр — branch Електрообладнання ===');
const branch = getBranchCandidates('Мережевий фільтр електричний подовжувач', FILE, 'Електрообладнання', 8);
branch.forEach(c => console.log(`  [${c.id}] ${c.path.join(' > ')}`));
