'use strict';
/**
 * موتور فرم استخدام پویا: بارگذاری تعریف از DB، اعتبارسنجی/جمع‌آوری پاسخ‌ها، محاسبهٔ پیشرفت
 */
const db = require('../../core/db');
const utils = require('../../core/utils');
const J = require('../../core/jalali');
const { SECTIONS, FIELDS } = require('./formdef');

const TYPES = { text: 'متن کوتاه', textarea: 'متن بلند', number: 'عدد', money: 'مبلغ (تومان)', date: 'تاریخ (شمسی)', year: 'سال', select: 'فهرست کشویی', radio: 'تک‌انتخابی', multi: 'چندانتخابی', checkbox: 'بله/خیر', mobile: 'موبایل', email: 'ایمیل', national_id: 'کد ملی', accept: 'تأیید / اقرار' };
const OPTION_TYPES = ['select', 'radio', 'multi'];

let cache = null;
function invalidate() { cache = null; }

/** ساخت/تکمیل تعریف پیش‌فرض در DB (idempotent) */
async function ensureDefaults(log) {
  const now = db.now();
  const existingS = new Set((await db.table('form_sections').all()).map((s) => s.key));
  let n = 0;
  for (let i = 0; i < SECTIONS.length; i++) {
    const s = SECTIONS[i];
    if (existingS.has(s.key)) continue;
    await db.insert('form_sections', { key: s.key, title: s.title, description: s.description || null, icon: s.icon, sort_order: (i + 1) * 10, enabled: 1, repeatable: s.repeatable ? 1 : 0, min_rows: s.min_rows || 0, max_rows: s.max_rows || 5, is_system: 1, created_at: now, updated_at: now });
    n++;
  }
  const existingF = new Set((await db.table('form_fields').all()).map((f) => f.section_key + '.' + f.key));
  let order = {};
  for (const f of FIELDS) {
    order[f.section_key] = (order[f.section_key] || 0) + 10;
    if (existingF.has(f.section_key + '.' + f.key)) continue;
    await db.insert('form_fields', { section_key: f.section_key, key: f.key, label: f.label, type: f.type, options: f.options ? JSON.stringify(f.options) : null, placeholder: f.placeholder || null, help: f.help || null, required: f.required ? 1 : 0, enabled: 1, sort_order: order[f.section_key], width: f.width || 6, is_system: f.locked ? 2 : 1, validation: null, show_if: f.show_if || null, created_at: now, updated_at: now });
    n++;
  }
  invalidate();
  if (n && log) log(`فرم استخدام: ${n} بخش/فیلد پیش‌فرض ساخته شد`);
  return n;
}

/** تعریف کامل (همهٔ بخش‌ها و فیلدها، شامل غیرفعال‌ها) */
async function definition(opts) {
  opts = opts || {};
  if (!cache) {
    const sections = await db.table('form_sections').orderBy('sort_order').orderBy('id').all();
    const fields = await db.table('form_fields').orderBy('sort_order').orderBy('id').all();
    for (const f of fields) { f.opts = utils.parseJSON(f.options, []); f.required = Number(f.required) ? 1 : 0; f.enabled = Number(f.enabled) ? 1 : 0; f.locked = Number(f.is_system) === 2; }
    for (const s of sections) { s.fields = fields.filter((f) => f.section_key === s.key); s.enabled = Number(s.enabled) ? 1 : 0; s.repeatable = Number(s.repeatable) ? 1 : 0; }
    cache = sections;
  }
  if (opts.all) return cache;
  return cache.filter((s) => s.enabled && s.fields.some((f) => f.enabled)).map((s) => Object.assign({}, s, { fields: s.fields.filter((f) => f.enabled) }));
}

/** مراحل فرم برای متقاضی (بخش‌های فعال؛ «تأیید» همیشه آخر است) */
async function steps() { return definition(); }

function visible(field, values) {
  if (!field.show_if) return true;
  const m = /^([\w-]+)\s*=\s*(.+)$/.exec(field.show_if);
  if (!m) return true;
  const v = values ? values[m[1]] : undefined;
  if (Array.isArray(v)) return v.includes(m[2]);
  return String(v == null ? '' : v) === m[2];
}

function normalizeValue(field, raw) {
  if (raw === undefined || raw === null) return null;
  if (field.type === 'multi') { const arr = (Array.isArray(raw) ? raw : [raw]).map((x) => utils.normalizePersian(String(x))).filter(Boolean); return arr.length ? arr : null; }
  if (Array.isArray(raw)) raw = raw[raw.length - 1];
  if (field.type === 'checkbox' || field.type === 'accept') return raw === '1' || raw === 'on' || raw === 'true' || raw === 1 ? 1 : 0;
  let v = utils.normalizePersian(String(raw));
  if (v === '') return null;
  if (field.type === 'number' || field.type === 'money' || field.type === 'year') { v = J.toEnglishDigits(v).replace(/[,\s٬]/g, ''); if (!/^-?\d+(\.\d+)?$/.test(v)) return { __invalid: true, raw }; return Number(v); }
  if (field.type === 'date') { const g = J.toGregorian(v); return g || { __invalid: true, raw }; }
  if (field.type === 'mobile') return utils.normalizePhone(v);
  if (field.type === 'national_id') return J.toEnglishDigits(v).replace(/\D/g, '');
  if (field.type === 'email') return v.toLowerCase();
  if (OPTION_TYPES.includes(field.type) && field.opts.length && !field.opts.includes(v)) return { __invalid: true, raw };
  return v.slice(0, field.type === 'textarea' ? 4000 : 300);
}

/** اعتبارسنجی یک ردیف از یک بخش → { values, errors } */
function validateRow(section, body, opts) {
  opts = opts || {};
  const values = {}; const errors = [];
  for (const f of section.fields) values[f.key] = normalizeValue(f, body[f.key]);
  for (const f of section.fields) {
    const v = values[f.key];
    if (v && typeof v === 'object' && v.__invalid) { errors.push(`مقدار «${f.label}» معتبر نیست`); values[f.key] = null; continue; }
    if (!visible(f, values)) { values[f.key] = f.type === 'multi' ? null : (f.type === 'checkbox' ? 0 : null); continue; }
    const empty = v === null || v === undefined || v === '' || (f.type === 'accept' && !v) || (f.type === 'checkbox' && opts.strictCheckbox && !v);
    if (f.required && empty && !opts.draft) errors.push(f.type === 'accept' ? `برای ادامه باید «${f.label}» را تیک بزنید` : `«${f.label}» الزامی است`);
    if (!empty) {
      if (f.type === 'mobile' && !utils.isValidMobile(v)) errors.push(`شمارهٔ موبایل «${f.label}» معتبر نیست`);
      if (f.type === 'email' && !utils.isValidEmail(v)) errors.push(`ایمیل معتبر نیست`);
      if (f.type === 'national_id' && !utils.isValidNationalId(v)) errors.push(`کد ملی معتبر نیست`);
      if (f.type === 'year' && (v < 1300 || v > 1500)) errors.push(`سال «${f.label}» معتبر نیست`);
      if (f.type === 'number' && f.key === 'gpa' && (v < 0 || v > 20)) errors.push('معدل باید بین ۰ تا ۲۰ باشد');
    }
  }
  return { values, errors };
}

/** جمع‌آوری پاسخ‌های یک بخش از بدنهٔ فرم. برای بخش تکرارشونده، ورودی‌ها به شکل rows[i][key] می‌آیند. */
function collectSection(section, body, opts) {
  opts = opts || {};
  if (!section.repeatable) return validateRow(section, body, opts);
  let rows = body.rows;
  if (!rows || typeof rows !== 'object') rows = {};
  const list = Array.isArray(rows) ? rows : Object.keys(rows).sort((a, b) => Number(a) - Number(b)).map((k) => rows[k]);
  const out = []; let errors = [];
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const anyValue = section.fields.some((f) => { const v = r[f.key]; return v !== undefined && v !== null && String(Array.isArray(v) ? v.join('') : v).trim() !== ''; });
    if (!anyValue) continue; // ردیف خالی نادیده گرفته می‌شود
    const res = validateRow(section, r, opts);
    out.push(res.values);
    errors = errors.concat(res.errors.map((e) => `ردیف ${J.toPersianDigits(out.length)}: ${e}`));
  }
  if (!opts.draft && out.length < (section.min_rows || 0)) errors.push(`حداقل ${J.toPersianDigits(section.min_rows)} ردیف در «${section.title}» لازم است`);
  if (out.length > (section.max_rows || 50)) errors.push(`حداکثر ${J.toPersianDigits(section.max_rows)} ردیف مجاز است`);
  return { values: out.slice(0, section.max_rows || 50), errors };
}

/** آیا بخش با داده‌های موجود کامل است؟ */
function sectionComplete(section, data) {
  const val = data[section.key];
  if (section.repeatable) {
    const rows = Array.isArray(val) ? val : [];
    if (rows.length < (section.min_rows || 0)) return false;
    return rows.every((r) => validateRow(section, rowToBody(section, r)).errors.length === 0);
  }
  return validateRow(section, rowToBody(section, val || {})).errors.length === 0;
}
/** مقادیر ذخیره‌شده → بدنهٔ فرم (برای اعتبارسنجی مجدد) */
function rowToBody(section, row) {
  const b = {};
  for (const f of section.fields) {
    const v = row ? row[f.key] : undefined;
    if (v === null || v === undefined) continue;
    if (f.type === 'date') b[f.key] = J.toJalali(v) || v;
    else if (f.type === 'checkbox' || f.type === 'accept') b[f.key] = v ? '1' : '0';
    else b[f.key] = v;
  }
  return b;
}
async function progress(data) {
  const secs = await definition();
  const done = secs.filter((s) => sectionComplete(s, data || {})).map((s) => s.key);
  return { done, total: secs.length, percent: secs.length ? Math.round((done.length / secs.length) * 100) : 0 };
}

/** نمایش مقدار برای HR/چاپ */
function display(field, v) {
  if (v === null || v === undefined || v === '' ) return '';
  if (field.type === 'multi') return (Array.isArray(v) ? v : [v]).join('، ');
  if (field.type === 'date') return J.toPersianDigits(J.toJalali(v) || v);
  if (field.type === 'money') return utils.money(v);
  if (field.type === 'checkbox' || field.type === 'accept') return v ? 'بله' : 'خیر';
  if (field.type === 'number' || field.type === 'year') return J.toPersianDigits(String(v));
  if (field.type === 'mobile' || field.type === 'national_id') return J.toPersianDigits(String(v));
  return String(v);
}

/** ستون‌های غیرنرمال پرونده از بخش «مشخصات» */
function denormalize(data) {
  const p = (data && data.personal) || {};
  const out = { first_name: p.first_name || null, last_name: p.last_name || null, national_id: p.national_id || null, email: p.email || null, birth_date: p.birth_date || null };
  if (p.mobile) out.mobile = p.mobile;
  return out;
}

module.exports = { TYPES, OPTION_TYPES, ensureDefaults, definition, steps, invalidate, visible, validateRow, collectSection, sectionComplete, progress, display, denormalize, rowToBody };
