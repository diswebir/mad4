#!/usr/bin/env node
'use strict';
/** پاک‌سازی کامل داده‌ها (به‌جز حساب مدیر و تنظیمات):  node scripts/reset.js --yes [--all] */
const { boot } = require('./_boot');
(async () => {
  if (!process.argv.includes('--yes')) { console.error('این دستور همهٔ داده‌ها را حذف می‌کند. برای تأیید، --yes را اضافه کنید. (--all: حذف تنظیمات و کاربران هم)'); process.exit(1); }
  const { db, schema } = await boot({ sync: false });
  const all = process.argv.includes('--all');
  const keep = all ? [] : ['settings', 'module_states', 'migrations'];
  const tables = Object.keys(schema.tables || schema).filter((t) => !keep.includes(t));
  for (const t of tables) {
    if (t === 'users' && !all) { await db.table('users').where('role', '!=', 'admin').delete(); continue; }
    try { await db.run(`DELETE FROM ${t}`); } catch (e) { console.warn('skip', t, e.message); }
  }
  if (db.info.dialect === 'sqlite') { try { await db.exec("DELETE FROM sqlite_sequence WHERE name NOT IN ('users','settings','module_states')"); await db.exec('VACUUM'); } catch (e) { /* ignore */ } }
  await db.update('settings', { value: '0' }, { key: 'demo_mode' });
  console.log(`پاک شد: ${tables.length} جدول`);
  await db.close();
})().catch((e) => { console.error(e); process.exit(1); });
