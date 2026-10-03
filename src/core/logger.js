'use strict';
/**
 * لاگ فایل‌محور سامانه: storage/logs/app-YYYY-MM-DD.log (هر خط یک JSON)
 * - خطاهای ۵xx، استثناهای مدیریت‌نشده، هشدارهای مهم (پشتیبان‌گیری، پیامک، زمان‌بند)
 * - بدون وابستگی خارجی؛ نوشتن append و همگام (حجم کم) با چرخش روزانه و حذف فایل‌های قدیمی
 */
const fs = require('fs');
const path = require('path');
const config = require('./config');
const J = require('./jalali');

const LEVELS = ['debug', 'info', 'warn', 'error'];
const RING_MAX = 300;
const ring = []; // آخرین رخدادها در حافظه (برای نمایش سریع)
let counters = { error: 0, warn: 0, info: 0, debug: 0, since: Date.now() };

function dir() { const d = path.join(config.get().storage, 'logs'); try { fs.mkdirSync(d, { recursive: true }); } catch (e) { /* ignore */ } return d; }
function fileFor(dateIso) { return path.join(dir(), `app-${dateIso || J.todayISO()}.log`); }

function serializeError(err) {
  if (!err) return null;
  if (typeof err === 'string') return { message: err };
  return { name: err.name, message: err.message || String(err), code: err.code, stack: err.stack ? String(err.stack).split('\n').slice(0, 12).join('\n') : undefined };
}
function fromReq(req) {
  if (!req) return {};
  return {
    method: req.method, url: req.originalUrl || req.url, ip: req.ip, user: req.user ? `${req.user.id}:${req.user.username}` : null,
    ua: req.get ? String(req.get('user-agent') || '').slice(0, 120) : undefined
  };
}

function write(level, message, meta) {
  if (!LEVELS.includes(level)) level = 'info';
  const entry = Object.assign({ t: new Date().toISOString().slice(0, 19).replace('T', ' '), level, message: String(message || '').slice(0, 2000) }, meta || {});
  ring.push(entry); if (ring.length > RING_MAX) ring.shift();
  counters[level] = (counters[level] || 0) + 1;
  try { fs.appendFileSync(fileFor(), JSON.stringify(entry) + '\n'); } catch (e) { /* فضای دیسک/مجوز: لاگ نباید برنامه را بیندازد */ }
  return entry;
}

const api = {
  LEVELS,
  dir,
  write,
  debug: (m, meta) => write('debug', m, meta),
  info: (m, meta) => write('info', m, meta),
  warn: (m, meta) => write('warn', m, meta),
  /** ثبت خطا (با درخواست اختیاری) */
  error(message, err, req, extra) {
    const e = serializeError(err);
    return write('error', message || (e && e.message) || 'خطا', Object.assign({ error: e }, fromReq(req), extra || {}));
  },
  /** فهرست فایل‌های لاگ (جدید به قدیم) */
  files() {
    let names = [];
    try { names = fs.readdirSync(dir()).filter((n) => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(n)); } catch (e) { names = []; }
    return names.sort().reverse().map((n) => { const st = fs.statSync(path.join(dir(), n)); return { name: n, date: n.slice(4, 14), size: st.size, mtime: st.mtime }; });
  },
  /** خواندن آخرین N خط یک فایل (پارس JSON؛ خطوط خراب نادیده گرفته می‌شوند) */
  read(dateIso, opts) {
    const o = Object.assign({ limit: 200, level: null, q: '' }, opts || {});
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateIso))) return [];
    const f = fileFor(dateIso);
    if (!fs.existsSync(f)) return [];
    const st = fs.statSync(f);
    // فقط انتهای فایل‌های بزرگ خوانده می‌شود (حداکثر ۲ مگابایت)
    const MAX = 2 * 1024 * 1024; let text;
    if (st.size > MAX) { const fd = fs.openSync(f, 'r'); const buf = Buffer.alloc(MAX); fs.readSync(fd, buf, 0, MAX, st.size - MAX); fs.closeSync(fd); text = buf.toString('utf8'); text = text.slice(text.indexOf('\n') + 1); }
    else text = fs.readFileSync(f, 'utf8');
    const out = [];
    const lines = text.split('\n');
    const q = String(o.q || '').toLowerCase();
    for (let i = lines.length - 1; i >= 0 && out.length < o.limit; i--) {
      const line = lines[i].trim(); if (!line) continue;
      let e; try { e = JSON.parse(line); } catch (err) { continue; }
      if (o.level && e.level !== o.level) continue;
      if (q && !line.toLowerCase().includes(q)) continue;
      out.push(e);
    }
    return out;
  },
  recent(limit) { return ring.slice(-(limit || 50)).reverse(); },
  stats() { return Object.assign({}, counters, { files: api.files().length }); },
  /** حذف فایل‌های قدیمی‌تر از N روز؛ تعداد حذف‌شده‌ها را برمی‌گرداند */
  prune(days) {
    const keepFrom = J.addDays(J.todayISO(), -(days || 14)); let n = 0;
    for (const f of api.files()) if (f.date < keepFrom) { try { fs.unlinkSync(path.join(dir(), f.name)); n++; } catch (e) { /* ignore */ } }
    return n;
  },
  remove(dateIso) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateIso))) return false; try { fs.unlinkSync(fileFor(dateIso)); return true; } catch (e) { return false; } },
  pathFor(dateIso) { return /^\d{4}-\d{2}-\d{2}$/.test(String(dateIso)) ? fileFor(dateIso) : null }
};
module.exports = api;
