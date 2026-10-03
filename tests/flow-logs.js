'use strict';
/** جریان: گزارش خطاها و لاگ سامانه (system.error_log) — فایل روزانه، ثبت خطای آزمایشی، فیلتر، دانلود، حذف، ثبت خودکار خطای ۵xx */
const { Client } = require('./client');
const fs = require('fs');
const path = require('path');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 2; } else console.log('ok:', m); };
const strip = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const J = require('../src/core/jalali');
const logger = require('../src/core/logger');

(async () => {
  const a = new Client(); let r = await a.login('admin', 'admin123'); assert(r.status === 302, 'admin login');
  await a.post('/system/modules/toggle', { key: 'system.error_log', enabled: '1' });
  const today = J.todayISO();

  // صفحه و منو
  r = await a.get('/system/logs'); assert(r.status === 200 && /گزارش خطاها و لاگ سامانه/.test(r.text), 'logs page renders');
  r = await a.get('/dashboard'); assert(/href="\/system\/logs"/.test(r.text), 'menu has logs link');

  // ثبت خطای آزمایشی → فایل امروز + نمایش
  r = await a.post('/system/logs/test', {}); assert(r.status === 302 && (r.location || '').includes('/system/logs?date=' + today), 'test entry posted -> ' + r.location);
  r = await a.get(r.location); const txt = strip(r.text);
  assert(/خطای آزمایشی/.test(txt) && /TEST_LOG_ENTRY/.test(r.text), 'test error listed');
  assert(/هشدار آزمایشی/.test(txt), 'test warning listed');
  assert(/POST \/system\/logs\/test/.test(txt) && /:admin/.test(txt), 'request context (method, url, user) recorded');
  assert(fs.existsSync(path.join(logger.dir(), `app-${today}.log`)), 'daily log file exists on disk');
  const lines = fs.readFileSync(path.join(logger.dir(), `app-${today}.log`), 'utf8').trim().split('\n');
  const last = JSON.parse(lines[lines.length - 1]); assert(last.level === 'warn' && last.test === true, 'file lines are JSON with level/meta');

  // فیلتر سطح و جستجو
  r = await a.get(`/system/logs?date=${today}&level=warn`); assert(/هشدار آزمایشی/.test(strip(r.text)) && !/TEST_LOG_ENTRY/.test(r.text), 'level filter (warn only)');
  r = await a.get(`/system/logs?date=${today}&level=error&q=TEST_LOG_ENTRY`); assert(/TEST_LOG_ENTRY/.test(r.text) && !/هشدار آزمایشی/.test(strip(r.text)), 'level + text filter');
  r = await a.get(`/system/logs?date=${today}&q=zzz-no-such-entry`); assert(/رخدادی برای این روز\/فیلتر ثبت نشده/.test(strip(r.text)), 'empty filter result message');

  // دانلود
  r = await a.get(`/system/logs/download?date=${today}`); assert(r.status === 200 && /TEST_LOG_ENTRY/.test(r.text) && /attachment/.test(r.headers['content-disposition'] || ''), 'download file');
  r = await a.get('/system/logs/download?date=2000-01-01'); assert(r.status === 404, 'download missing file -> 404');
  r = await a.get('/system/logs/download?date=../config.json'); assert(r.status === 404, 'path traversal rejected');

  // خطای ۵xx واقعی به‌صورت خودکار ثبت می‌شود (آدرس نامعتبر CSV با ستون اشتباه → سعی می‌کنیم یک ۵۰۰ تولید کنیم؛ اگر نشد از logger مستقیم)
  const before = logger.read(today, { limit: 5000, level: 'error' }).length;
  logger.error('HTTP 500', new Error('simulated'), { method: 'GET', originalUrl: '/x', ip: '127.0.0.1', get: () => '' }, { status: 500 });
  assert(logger.read(today, { limit: 5000, level: 'error' }).length === before + 1, 'logger.error appends one error line');
  assert(logger.recent(5)[0].message === 'HTTP 500', 'in-memory ring buffer has latest entry');

  // هرس فایل‌های قدیمی
  const oldDate = J.addDays(today, -40); const oldFile = path.join(logger.dir(), `app-${oldDate}.log`);
  fs.writeFileSync(oldFile, JSON.stringify({ t: oldDate + ' 10:00:00', level: 'info', message: 'old' }) + '\n');
  r = await a.get('/system/logs'); assert(r.text.includes('app-' + oldDate) || r.text.includes('date=' + oldDate), 'old file listed');
  r = await a.post('/system/logs/prune', {}); assert(r.status === 302, 'prune posted');
  assert(!fs.existsSync(oldFile), 'old file pruned (default 14 days)');
  assert(fs.existsSync(path.join(logger.dir(), `app-${today}.log`)), 'today file kept');

  // حذف دستی فایل یک روز (فایل ساختگی دیروز)
  const y = J.addDays(today, -1); const yFile = path.join(logger.dir(), `app-${y}.log`);
  const hadY = fs.existsSync(yFile);
  if (!hadY) fs.writeFileSync(yFile, JSON.stringify({ t: y + ' 10:00:00', level: 'info', message: 'y' }) + '\n');
  if (!hadY) { r = await a.post('/system/logs/delete', { date: y }); assert(r.status === 302 && !fs.existsSync(yFile), 'delete single day file'); }
  r = await a.post('/system/logs/delete', { date: '../../package' }); assert(r.status === 302 && fs.existsSync(path.join(__dirname, '..', 'package.json')), 'delete rejects invalid date');

  // کار پاک‌سازی هم فایل‌های قدیمی را حذف می‌کند
  fs.writeFileSync(oldFile, '{}\n');
  r = await a.post('/system/jobs/cleanup', { action: 'run' }); assert(r.status === 302, 'cleanup job run');
  assert(!fs.existsSync(oldFile), 'cleanup job pruned old log file');

  // دسترسی: معلم ۴۰۳؛ قابلیت خاموش → ۴۰۴ و حذف از منو
  const t = new Client(); await t.login('teacher1', '123456');
  r = await t.get('/system/logs'); assert(r.status === 403, 'teacher forbidden');
  r = await a.post('/system/modules/toggle', { key: 'system.error_log', enabled: '0' });
  r = await a.get('/system/logs'); assert(r.status === 404, 'feature off -> 404');
  r = await a.get('/dashboard'); assert(!/href="\/system\/logs"/.test(r.text), 'feature off -> no menu link');
  await a.post('/system/modules/toggle', { key: 'system.error_log', enabled: '1' });
  console.log('done');
})().catch((e) => { console.error(e); process.exit(1); });
