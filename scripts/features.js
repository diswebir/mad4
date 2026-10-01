#!/usr/bin/env node
'use strict';
/** تولید docs/FEATURES.md از مانیفست ماژول‌ها:  node scripts/features.js */
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'src', 'modules');
const mods = fs.readdirSync(dir).map((k) => require(path.join(dir, k, 'index.js'))).sort((a, b) => (a.order || 0) - (b.order || 0));
const out = ['# فهرست کامل قابلیت‌ها', '', 'این فهرست مستقیماً از مانیفست ماژول‌ها (`src/modules/*/index.js`) تولید شده است و همان چیزی است که در صفحهٔ **تنظیمات ← ماژول‌ها و قابلیت‌ها** نمایش داده می‌شود.', 'هر قابلیت (به‌جز موارد «همیشه فعال») را می‌توان جداگانه روشن یا خاموش کرد؛ خاموش‌کردن یک ماژول، همهٔ قابلیت‌ها، منوها و مسیرهای آن را غیرفعال می‌کند.', '', 'تولید مجدد: `node scripts/features.js`', ''];
let total = 0;
for (const m of mods) {
  out.push(`### ${m.name} (\`${m.key}\`) — ${(m.features || []).length} قابلیت`, '');
  for (const f of m.features || []) { total++; out.push(`- **${f.name}**${f.description ? ' — ' + f.description : ''}${f.locked ? ' _(همیشه فعال)_' : ''}`); }
  out.push('');
}
out.push(`---`, `**جمع: ${mods.length} ماژول، ${total} قابلیت**`, '');
fs.writeFileSync(path.join(__dirname, '..', 'docs', 'FEATURES.md'), out.join('\n'));
console.log(`docs/FEATURES.md → ${mods.length} ماژول، ${total} قابلیت`);
