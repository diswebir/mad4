#!/usr/bin/env node
'use strict';
/**
 * اجرای کارهای زمان‌بندی‌شدهٔ سررسیدشده و خروج (برای Cron هاست):
 *   (هر ۱۵ دقیقه)  cd /home/USER/madrese && /usr/bin/node scripts/cron.js >> storage/logs/cron.log 2>&1
 * با --job <key> فقط همان کار (اجباری) اجرا می‌شود؛ با --list فهرست کارها چاپ می‌شود.
 */
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const { boot } = require('../src/app');
const scheduler = require('../src/core/scheduler');
const args = process.argv.slice(2);
(async () => {
  const st = await boot(() => {});
  if (!st.installed) { console.error('سامانه نصب نشده است.'); process.exit(1); }
  scheduler.stop();
  if (args.includes('--list')) { for (const j of await scheduler.state()) console.log(`${j.key.padEnd(22)} ${j.is_enabled ? 'فعال  ' : 'غیرفعال'} ${j.schedule === 'daily' ? j.run_at : j.schedule}  آخرین اجرا: ${j.last_run_at || '-'} ${j.last_status || ''}`); process.exit(0); }
  const i = args.indexOf('--job');
  const results = i >= 0 ? [Object.assign({ key: args[i + 1] }, await scheduler.runJob(args[i + 1], 'cli', true))] : await scheduler.runDue('cron');
  for (const r of results) console.log(`[${new Date().toISOString()}] ${r.key}: ${r.status || (r.skipped ? 'skipped' : '')} ${r.message || ''}`);
  if (!results.length) console.log(`[${new Date().toISOString()}] کاری برای اجرا نبود`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
