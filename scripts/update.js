#!/usr/bin/env node
'use strict';
/**
 * به‌روزرسانی نسخه (پس از جایگزینی فایل‌های برنامه):
 *   node scripts/update.js            → npm install (در صورت نیاز) + همگام‌سازی جدول‌ها + ثبت نسخه + درخواست ری‌استارت
 *   node scripts/update.js --check    → فقط گزارش وضعیت (نسخه، وابستگی‌های ناقص، نیاز به نصب)
 *   node scripts/update.js --force-install   → اجرای اجباری npm install
 *   node scripts/update.js --skip-install    → بدون npm install
 *   node scripts/update.js --zip <file.zip>  → ابتدا بستهٔ نسخهٔ جدید را روی پوشهٔ برنامه باز می‌کند
 *   (پرچم --web برای اجرای پس‌زمینه از پنل مدیریت است؛ گزارش در storage/logs/update.log نوشته می‌شود)
 */
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const updater = require('../src/core/updater');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valueOf = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const web = has('--web');
const log = (m) => { if (web) updater.appendLog(m); else console.log(m); if (web && process.stdout.isTTY) console.log(m); };

(async () => {
  if (has('--check')) {
    const st = updater.state();
    console.log(JSON.stringify({ version: st.version, node: st.node, npm: (updater.npmBin() || {}).version || null, missingDeps: st.missingDeps, needsInstall: st.needsInstall, lastStatus: st.lastStatus, updatedAt: st.updatedAt }, null, 2));
    return;
  }
  const zip = valueOf('--zip');
  if (zip) {
    const r = await updater.applyPackage(path.resolve(zip), { log, force: has('--force') });
    log(`بستهٔ نسخهٔ ${r.version} اعمال شد (${r.files} فایل)`);
  }
  // پس از جایگزینی فایل‌ها، ماژول‌های تازه را از نو بارگذاری می‌کنیم
  for (const k of Object.keys(require.cache)) { if (k.startsWith(path.join(__dirname, '..', 'src')) || k.startsWith(path.join(__dirname, '..', 'database'))) delete require.cache[k]; }
  let booted = null;
  try {
    const { boot } = require('./_boot');
    const config = require('../src/core/config');
    if (config.reload().installed) booted = await boot({ sync: false });
  } catch (e) { log('اتصال به پایگاه داده برقرار نشد (' + e.message + ')؛ فقط نصب وابستگی‌ها انجام می‌شود'); }
  const result = await updater.run({ db: booted && booted.db, schema: booted && booted.schema, schemaSync: booted && booted.schemaSync, settings: booted && booted.settings, log, forceInstall: has('--force-install'), skipInstall: has('--skip-install') });
  if (booted) { try { await booted.db.close(); } catch (e) { /* ignore */ } }
  if (!web) console.log(result.ok ? '\nبه‌روزرسانی کامل شد. اگر روی cPanel هستید برنامه خودکار ری‌استارت می‌شود؛ در غیر این صورت سرویس را دوباره اجرا کنید.' : '\nبه‌روزرسانی ناموفق: ' + result.error);
  process.exit(result.ok ? 0 : 1);
})().catch((e) => { log('خطا: ' + (e.stack || e.message)); updater.writeState({ running: false, status: 'failed', message: e.message, finishedAt: new Date().toISOString() }); process.exit(1); });
