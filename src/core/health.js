'use strict';
/**
 * سلامت سرور: فضای دیسک، حجم پوشه‌های storage، هشدار پرشدن دیسک
 *  - disk(): فضای آزاد/کل پارتیشن storage (fs.statfs)
 *  - usage(): حجم uploads / backups / logs / tmp / پایگاه دادهٔ SQLite
 *  - check(): وضعیت نسبت به آستانه‌ها (disk_alert_min_mb, disk_alert_percent)
 *  - نتیجه برای نوار هشدار مدیر ۱۰ دقیقه کش می‌شود
 */
const fs = require('fs');
const path = require('path');
const config = require('./config');
const settings = require('./settings');

let cache = { at: 0, value: null };

function dirSize(dir, depth = 0) {
  let total = 0, files = 0;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return { bytes: 0, files: 0 }; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    try {
      if (e.isDirectory()) { if (depth < 12) { const r = dirSize(p, depth + 1); total += r.bytes; files += r.files; } }
      else if (e.isFile()) { total += fs.statSync(p).size; files++; }
    } catch (err) { /* ignore */ }
  }
  return { bytes: total, files };
}

function disk(dir) {
  const target = dir || config.get().storage;
  return new Promise((resolve) => {
    if (typeof fs.statfs !== 'function') return resolve(null);
    fs.statfs(target, (err, s) => {
      if (err || !s) return resolve(null);
      const total = Number(s.blocks) * Number(s.bsize), free = Number(s.bavail) * Number(s.bsize);
      resolve({ total, free, used: total - free, percent: total ? Math.round(((total - free) / total) * 100) : 0 });
    });
  });
}

function usage() {
  const cfg = config.get();
  const out = {};
  for (const k of ['uploads', 'backups', 'logs', 'tmp']) out[k] = dirSize(path.join(cfg.storage, k));
  let dbBytes = 0;
  if (cfg.db.client === 'sqlite') { try { dbBytes = fs.statSync(cfg.db.filename).size; for (const suf of ['-wal', '-shm']) { try { dbBytes += fs.statSync(cfg.db.filename + suf).size; } catch (e) { /* ignore */ } } } catch (e) { /* ignore */ } }
  out.database = { bytes: dbBytes, files: dbBytes ? 1 : 0 };
  out.total = Object.values(out).reduce((a, r) => a + r.bytes, 0);
  return out;
}

function thresholds() {
  return { minMb: Math.max(50, settings.getInt('disk_alert_min_mb', 500)), percent: Math.min(99, Math.max(50, settings.getInt('disk_alert_percent', 90))), enabled: settings.get('disk_alert_enabled', '1') !== '0' };
}

/** @returns {{ level: 'ok'|'warning'|'critical', disk, usage, thresholds, message }} */
async function check({ withUsage = true } = {}) {
  const t = thresholds();
  const d = await disk();
  const u = withUsage ? usage() : null;
  let level = 'ok'; let message = '';
  if (d) {
    const freeMb = d.free / 1048576; const pct = Number(d.percent).toLocaleString('fa-IR');
    if (freeMb < t.minMb / 2 || d.percent >= Math.min(99, t.percent + 5)) { level = 'critical'; message = `فضای دیسک تقریباً پر شده است: فقط ${fmt(d.free)} آزاد است (${pct}٪ استفاده‌شده). ذخیرهٔ فایل، پشتیبان‌گیری و حتی ثبت اطلاعات ممکن است با خطا مواجه شود.`; }
    else if (freeMb < t.minMb || d.percent >= t.percent) { level = 'warning'; message = `فضای دیسک رو به اتمام است: ${fmt(d.free)} آزاد (${pct}٪ استفاده‌شده). پشتیبان‌های قدیمی و فایل‌های غیرضروری را پاک کنید یا فضای هاست را افزایش دهید.`; }
  }
  return { level, disk: d, usage: u, thresholds: t, message, checkedAt: Date.now() };
}

/** نسخهٔ کش‌شده برای نوار هشدار (بدون محاسبهٔ حجم پوشه‌ها) */
async function cached() {
  if (Date.now() - cache.at < 10 * 60 * 1000 && cache.value) return cache.value;
  cache.value = await check({ withUsage: false }); cache.at = Date.now();
  return cache.value;
}
function invalidate() { cache.at = 0; }

function fmt(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1073741824) return (Math.round((n / 1073741824) * 10) / 10).toLocaleString('fa-IR') + ' گیگابایت';
  if (n >= 1048576) return Math.round(n / 1048576).toLocaleString('fa-IR') + ' مگابایت';
  if (n >= 1024) return Math.round(n / 1024).toLocaleString('fa-IR') + ' کیلوبایت';
  return n.toLocaleString('fa-IR') + ' بایت';
}

module.exports = { disk, usage, check, cached, invalidate, thresholds, fmt, dirSize };
