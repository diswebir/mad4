'use strict';
/**
 * ابزارهای عمومی
 */
const crypto = require('crypto');
const J = require('./jalali');

const ROLES = { super: 'مدیر ارشد سامانه', hr_manager: 'مدیر منابع انسانی', hr_staff: 'کارشناس منابع انسانی', employee: 'کارمند شرکت', applicant: 'متقاضی استخدام' };
const ROLE_COLORS = { super: 'purple', hr_manager: 'primary', hr_staff: 'info', employee: 'success', applicant: 'warning' };
const GENDERS = { male: 'مرد', female: 'زن' };
const EMPLOYMENT_TYPES = { full_time: 'تمام‌وقت', part_time: 'پاره‌وقت', remote: 'دورکاری', project: 'پروژه‌ای', internship: 'کارآموزی', any: 'هر نوع' };
const POSITION_STATUS = { open: ['success', 'فعال (در حال جذب)'], closed: ['secondary', 'بسته‌شده'], draft: ['warning', 'پیش‌نویس'] };
const APP_STATUS = {
  draft: ['secondary', 'پیش‌نویس'], submitted: ['info', 'ارسال‌شده'], screening: ['primary', 'در حال بررسی'], test: ['purple', 'در مرحلهٔ آزمون'], interview: ['warning', 'مصاحبه'],
  offer: ['success', 'پیشنهاد همکاری'], hired: ['success', 'استخدام‌شده'], rejected: ['danger', 'رد شده'], withdrawn: ['secondary', 'انصراف'], archived: ['secondary', 'بایگانی']
};
const APP_STATUS_FLOW = ['draft', 'submitted', 'screening', 'test', 'interview', 'offer', 'hired'];
const DECISIONS = { suitable: ['success', 'مناسب برای استخدام'], review: ['warning', 'نیاز به بررسی بیشتر'], rejected: ['danger', 'رد صلاحیت'] };
const EVAL_STAGES = { interviewer: 'نظر مصاحبه‌کننده', hr: 'نظر منابع انسانی', management: 'نظر مدیریت' };
const EMPLOYEE_STATUS = { active: ['success', 'شاغل'], on_leave: ['warning', 'مرخصی'], terminated: ['danger', 'قطع همکاری'] };
const PRIORITIES = { low: 'کم', normal: 'عادی', high: 'زیاد', urgent: 'فوری' };
const PRIORITY_COLORS = { low: 'secondary', normal: 'primary', high: 'warning', urgent: 'danger' };
const EDUCATIONS = { diploma: 'دیپلم', associate: 'کاردانی', bachelor: 'کارشناسی', master: 'کارشناسی ارشد', phd: 'دکتری', other: 'سایر' };
const GENERIC_STATUS = { active: ['success', 'فعال'], inactive: ['secondary', 'غیرفعال'], pending: ['warning', 'در انتظار'], approved: ['success', 'تأیید شده'], rejected: ['danger', 'رد شده'], open: ['success', 'باز'], closed: ['secondary', 'بسته'], draft: ['warning', 'پیش‌نویس'], sent: ['success', 'ارسال شد'], failed: ['danger', 'ناموفق'], queued: ['warning', 'در صف'], completed: ['success', 'تکمیل‌شده'], assigned: ['info', 'تخصیص‌یافته'], in_progress: ['primary', 'در حال انجام'], expired: ['secondary', 'منقضی'], scheduled: ['info', 'زمان‌بندی‌شده'], done: ['success', 'انجام شد'], cancelled: ['secondary', 'لغو شد'], no_show: ['danger', 'عدم حضور'] };
function badgeOf(map, status) {
  const m = map && map[status];
  if (!m) return `<span class="badge badge-soft-secondary">${escapeHtml(status || '—')}</span>`;
  return `<span class="badge badge-soft-${m[0]}">${m[1]}</span>`;
}
function statusBadge(status, labels) {
  const m = (labels && labels[status]) ? [GENERIC_STATUS[status] ? GENERIC_STATUS[status][0] : 'secondary', labels[status]] : GENERIC_STATUS[status];
  if (!m) return `<span class="badge badge-soft-secondary">${escapeHtml(status || '—')}</span>`;
  return `<span class="badge badge-soft-${m[0]}">${m[1]}</span>`;
}
function appStatusBadge(status) { return badgeOf(APP_STATUS, status); }
function decisionBadge(d) { return badgeOf(DECISIONS, d); }
function positionStatusBadge(s) { return badgeOf(POSITION_STATUS, s); }
function priorityBadge(p) { return `<span class="badge badge-soft-${PRIORITY_COLORS[p] || 'secondary'}">${PRIORITIES[p] || p || '—'}</span>`; }
function roleBadge(role) { return `<span class="badge badge-soft-${ROLE_COLORS[role] || 'secondary'}">${ROLES[role] || escapeHtml(role || '—')}</span>`; }
/** تبدیل شمارهٔ موبایل ایرانی به قالب E.164 (+98…) برای ارسال پیامک */
function toE164(mobile) { const p = normalizePhone(mobile); return /^09\d{9}$/.test(p) ? '+98' + p.slice(1) : (p.startsWith('+') ? p : p); }
/** پنهان‌سازی بخشی از شمارهٔ موبایل: 0912***4567 */
function maskMobile(m) { m = normalizePhone(m); return m.length >= 10 ? m.slice(0, 4) + '***' + m.slice(-4) : m; }
/** تجزیهٔ امن JSON */
function parseJSON(v, def) { if (v == null || v === '') return def; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch (e) { return def; } }
/** سن از تاریخ تولد میلادی */
function ageOf(iso) { if (!iso) return null; const d = new Date(iso); if (Number.isNaN(d.getTime())) return null; const n = new Date(); let a = n.getFullYear() - d.getFullYear(); const m = n.getMonth() - d.getMonth(); if (m < 0 || (m === 0 && n.getDate() < d.getDate())) a--; return a; }

/** یکسان‌سازی حروف عربی/فارسی و فاصله‌ها */
function normalizePersian(str) {
  if (str == null) return str;
  return String(str).replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/ۀ/g, 'ه').replace(/\u200c+/g, '\u200c').replace(/\s+/g, ' ').trim();
}
function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function nl2br(str) { return escapeHtml(str).replace(/\r?\n/g, '<br>'); }
function truncate(str, n) { str = String(str || ''); return str.length > n ? str.slice(0, n - 1) + '…' : str; }
/** عدد با جداکنندهٔ هزارگان و ارقام فارسی */
function money(n, unit) {
  const v = Math.round(Number(n) || 0);
  return J.toPersianDigits(v.toLocaleString('en-US')) + (unit === false ? '' : ' ' + (unit || 'تومان'));
}
function num(n, decimals) {
  if (n == null || n === '') return '—';
  const v = Number(n);
  if (Number.isNaN(v)) return J.toPersianDigits(n);
  const s = decimals != null ? v.toFixed(decimals).replace(/\.?0+$/, '') : String(Math.round(v * 100) / 100);
  return J.toPersianDigits(s);
}
function percent(part, total, decimals) {
  if (!total) return 0;
  const p = (part / total) * 100;
  return Math.round(p * Math.pow(10, decimals || 0)) / Math.pow(10, decimals || 0);
}
function randomString(len, alphabet) {
  const chars = alphabet || 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += chars[bytes[i] % chars.length];
  return s;
}
function randomDigits(len) { return randomString(len, '0123456789'); }
function slugify(str) { return String(str || '').toLowerCase().replace(/[^\w\u0600-\u06FF]+/g, '-').replace(/^-+|-+$/g, ''); }

/** اعتبارسنجی کد ملی ایرانی */
function isValidNationalId(code) {
  code = J.toEnglishDigits(String(code || '')).trim();
  if (!/^\d{10}$/.test(code) || /^(\d)\1{9}$/.test(code)) return false;
  const check = +code[9];
  const sum = code.split('').slice(0, 9).reduce((acc, d, i) => acc + (+d) * (10 - i), 0) % 11;
  return sum < 2 ? check === sum : check === 11 - sum;
}
function normalizePhone(p) {
  p = J.toEnglishDigits(String(p || '')).replace(/[\s\-()]/g, '');
  if (p.startsWith('+98')) p = '0' + p.slice(3);
  if (p.startsWith('0098')) p = '0' + p.slice(4);
  if (/^9\d{9}$/.test(p)) p = '0' + p;
  return p;
}
function isValidMobile(p) { return /^09\d{9}$/.test(normalizePhone(p)); }
function isValidEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '')); }

/** تبدیل بدنهٔ فرم: رشته‌های خالی → null، ارقام فارسی → لاتین برای فیلدهای عددی/تاریخ */
function cleanBody(body, opts) {
  const out = {};
  const dateFields = (opts && opts.dates) || [];
  const numFields = (opts && opts.numbers) || [];
  const boolFields = (opts && opts.booleans) || [];
  const keep = (opts && opts.fields) || Object.keys(body);
  for (const k of keep) {
    let v = body[k];
    if (Array.isArray(v)) v = v[v.length - 1];
    if (boolFields.includes(k)) { out[k] = v === '1' || v === 'on' || v === 'true' || v === 1 || v === true ? 1 : 0; continue; }
    if (v === undefined) { if (!(opts && opts.fields)) continue; v = null; }
    if (typeof v === 'string') { v = normalizePersian(v); if (v === '') v = null; }
    if (v != null && dateFields.includes(k)) v = J.toGregorian(v);
    if (v != null && numFields.includes(k)) { const n = Number(J.toEnglishDigits(v)); v = Number.isNaN(n) ? null : n; }
    if (v != null && typeof v === 'string' && /(phone|mobile|national_id|postal_code|code|number|isbn)$/i.test(k)) v = J.toEnglishDigits(v);
    out[k] = v;
  }
  return out;
}

/** تولید CSV با BOM برای اکسل */
function toCSV(rows, columns) {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const header = columns.map((c) => esc(c.label)).join(',');
  const lines = rows.map((r) => columns.map((c) => esc(typeof c.value === 'function' ? c.value(r) : r[c.key])).join(','));
  return '\uFEFF' + [header, ...lines].join('\r\n');
}
/**
 * ارسال خروجی جدول به مرورگر: format = 'xlsx' → فایل Excel واقعی، در غیر این صورت CSV (با BOM برای Excel فارسی)
 * columns همان قالب toCSV است: [{ key|value, label, text? }]
 */
function sendExport(res, baseName, rows, columns, format) {
  const name = String(baseName || 'export').replace(/[^\w.\-\u0600-\u06FF]+/g, '-');
  const encoded = encodeURIComponent(name);
  if (String(format).toLowerCase() === 'xlsx') {
    const xlsx = require('./xlsx');
    res.setHeader('Content-Type', xlsx.MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${encoded}.xlsx"; filename*=UTF-8''${encoded}.xlsx`);
    return res.send(xlsx.fromColumns(rows, columns));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${encoded}.csv"; filename*=UTF-8''${encoded}.csv`);
  return res.send(toCSV(rows, columns));
}
/** تجزیهٔ CSV ساده (با پشتیبانی از کوتیشن) */
function parseCSV(text) {
  text = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',' || ch === ';' || ch === '\t') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}
/** CSV → آرایه‌ای از آبجکت‌ها (ردیف اول = سرستون). کلیدها trim می‌شوند. */
function parseCSVObjects(text) {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => String(h).trim());
  return rows.slice(1).map((r) => { const o = {}; header.forEach((h, i) => { if (h) o[h] = r[i] === undefined ? '' : String(r[i]).trim(); }); return o; });
}
function pick(obj, keys) { const o = {}; keys.forEach((k) => { if (obj[k] !== undefined) o[k] = obj[k]; }); return o; }
function groupBy(arr, key) { return arr.reduce((acc, x) => { const k = typeof key === 'function' ? key(x) : x[key]; (acc[k] = acc[k] || []).push(x); return acc; }, {}); }
function indexBy(arr, key) { const o = {}; for (const x of arr) o[typeof key === 'function' ? key(x) : x[key]] = x; return o; }
function sumBy(arr, key) { return arr.reduce((a, x) => a + (Number(typeof key === 'function' ? key(x) : x[key]) || 0), 0); }
function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function clampInt(v, min, max, def) { const n = parseInt(J.toEnglishDigits(v), 10); if (Number.isNaN(n)) return def; return Math.min(max, Math.max(min, n)); }
function fileSize(bytes) {
  bytes = Number(bytes) || 0;
  if (bytes < 1024) return J.toPersianDigits(bytes) + ' بایت';
  if (bytes < 1048576) return J.toPersianDigits((bytes / 1024).toFixed(1)) + ' کیلوبایت';
  return J.toPersianDigits((bytes / 1048576).toFixed(1)) + ' مگابایت';
}
function initials(name) { return String(name || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join(''); }
/** رنگ ثابت برای آواتار بر اساس نام */
function colorFor(str) {
  const colors = ['#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0d9488', '#0891b2', '#4f46e5'];
  let h = 0; for (const c of String(str || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return colors[h % colors.length];
}

module.exports = {
  sendExport, ROLES, ROLE_COLORS, GENDERS, EMPLOYMENT_TYPES, POSITION_STATUS, APP_STATUS, APP_STATUS_FLOW, DECISIONS, EVAL_STAGES, EMPLOYEE_STATUS, PRIORITIES, PRIORITY_COLORS, EDUCATIONS, GENERIC_STATUS,
  badgeOf, statusBadge, appStatusBadge, decisionBadge, positionStatusBadge, priorityBadge, roleBadge, toE164, maskMobile, parseJSON, ageOf,
  normalizePersian, escapeHtml, nl2br, truncate, money, num, percent, randomString, randomDigits, slugify,
  isValidNationalId, normalizePhone, isValidMobile, isValidEmail, cleanBody, toCSV, parseCSV, parseCSVObjects, pick, groupBy, indexBy, sumBy, avg, clampInt, fileSize, initials, colorFor
};
