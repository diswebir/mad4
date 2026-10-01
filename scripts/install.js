#!/usr/bin/env node
'use strict';
/**
 * نصب از خط فرمان (جایگزین ویزارد وب برای SSH / استقرار خودکار)
 *   node scripts/install.js --school "دبیرستان نمونه" --admin admin --password admin123 [--name "مدیر"] [--demo] [--force]
 *   node scripts/install.js --mysql --host 127.0.0.1 --db madrese --user root --pass secret ...
 */
const path = require('path');
const fs = require('fs');
const config = require('../src/core/config');
const installer = require('../src/installer/install');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : d; };
const has = (k) => args.includes('--' + k);

(async () => {
  const cfg = config.get();
  if (cfg.installed && !has('force')) { console.error('سامانه قبلاً نصب شده است. برای نصب مجدد --force بدهید (دادهٔ قبلی پاک نمی‌شود، فقط جدول‌های جدید ساخته و حساب مدیر به‌روزرسانی می‌شود).'); process.exit(1); }
  const dbCfg = has('mysql')
    ? { client: 'mysql', host: String(opt('host', '127.0.0.1')), port: parseInt(opt('port', 3306), 10) || 3306, user: String(opt('user', '')), password: String(opt('pass', '')), database: String(opt('db', '')) }
    : { client: 'sqlite', filename: String(opt('file', installer.sqliteDefaultFile())) };
  const form = {
    school_name: String(opt('school', 'مدرسهٔ نمونه')), school_type: String(opt('type', 'متوسطه اول')), school_gender: String(opt('gender', 'mixed')),
    admin_name: String(opt('name', 'مدیر مدرسه')), admin_username: String(opt('admin', 'admin')), admin_password: String(opt('password', 'admin123')),
    admin_email: opt('email', null), admin_phone: opt('phone', null), timezone_offset: String(opt('tz', '+03:30')), demo: has('demo') ? '1' : '0'
  };
  const errors = installer.validateForm(form);
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  if (has('fresh') && dbCfg.client === 'sqlite') { for (const f of [dbCfg.filename, dbCfg.filename + '-wal', dbCfg.filename + '-shm']) { try { fs.unlinkSync(f); } catch (e) { /* ignore */ } } }
  console.log('نصب با پیکربندی:', dbCfg.client === 'sqlite' ? 'SQLite → ' + path.relative(process.cwd(), dbCfg.filename) : `MySQL → ${dbCfg.user}@${dbCfg.host}/${dbCfg.database}`);
  const t0 = Date.now();
  await installer.performInstall({ dbCfg, form, log: (m) => console.log(' •', m) });
  console.log(`✔ نصب کامل شد (${((Date.now() - t0) / 1000).toFixed(1)} ثانیه). ورود: ${form.admin_username} / ${form.admin_password}${has('demo') ? ' — معلم: teacher1 / 123456 — دانش‌آموز: 40001 / 123456' : ''}`);
  process.exit(0);
})().catch((e) => { console.error('خطا در نصب:', e.message); process.exit(1); });
