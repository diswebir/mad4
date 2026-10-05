'use strict';
/**
 * ابزارهای تاریخ شمسی (جلالی) — بدون وابستگی به ICU
 * تاریخ‌ها در پایگاه داده میلادی (YYYY-MM-DD) و در رابط کاربری شمسی هستند.
 */
const jalaali = require('jalaali-js');

const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const WEEKDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه']; // 0 = شنبه
const WEEKDAYS_SHORT = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

let tzOffsetMinutes = 210; // +03:30 تهران

function setTimezoneOffset(str) {
  const m = /^([+-])(\d{1,2}):(\d{2})$/.exec(String(str || '').trim());
  if (!m) return;
  tzOffsetMinutes = (m[1] === '-' ? -1 : 1) * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
}

function pad(n, l) { return String(n).padStart(l || 2, '0'); }

function toEnglishDigits(str) {
  if (str == null) return str;
  return String(str).replace(/[۰-۹]/g, (d) => PERSIAN_DIGITS.indexOf(d)).replace(/[٠-٩]/g, (d) => ARABIC_DIGITS.indexOf(d));
}
function toPersianDigits(str) {
  if (str == null) return '';
  return String(str).replace(/\d/g, (d) => PERSIAN_DIGITS[d]);
}

/** تاریخ/زمان فعلی در منطقهٔ زمانی تنظیم‌شده (به‌صورت Date شیفت‌داده‌شده؛ از متدهای getUTC* استفاده کنید) */
function nowLocal() { return new Date(Date.now() + tzOffsetMinutes * 60000); }
function todayISO() { const d = nowLocal(); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
function nowISO() { const d = nowLocal(); return `${todayISO()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; }
function nowTime() { const d = nowLocal(); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; }

/** تجزیهٔ رشتهٔ میلادی ISO به اجزا */
function parseISO(str) {
  if (!str) return null;
  if (str instanceof Date) return { gy: str.getUTCFullYear(), gm: str.getUTCMonth() + 1, gd: str.getUTCDate(), h: str.getUTCHours(), i: str.getUTCMinutes(), s: str.getUTCSeconds() };
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(String(str));
  if (!m) return null;
  return { gy: +m[1], gm: +m[2], gd: +m[3], h: m[4] != null ? +m[4] : null, i: m[5] != null ? +m[5] : null, s: m[6] != null ? +m[6] : 0 };
}

/** میلادی ISO → شمسی 'YYYY/MM/DD' */
function toJalali(iso, sep) {
  const p = parseISO(iso);
  if (!p) return '';
  const j = jalaali.toJalaali(p.gy, p.gm, p.gd);
  return `${j.jy}${sep || '/'}${pad(j.jm)}${sep || '/'}${pad(j.jd)}`;
}
function toJalaliParts(iso) {
  const p = parseISO(iso);
  if (!p) return null;
  const j = jalaali.toJalaali(p.gy, p.gm, p.gd);
  return { jy: j.jy, jm: j.jm, jd: j.jd, weekday: weekdayIndex(iso) };
}

/** شمسی (با هر جداکننده و ارقام فارسی/لاتین) → میلادی ISO 'YYYY-MM-DD' ؛ در صورت نامعتبر بودن null */
function toGregorian(jstr) {
  if (!jstr) return null;
  const s = toEnglishDigits(String(jstr)).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) && parseInt(s.slice(0, 4), 10) > 1700) return s; // قبلاً میلادی است
  const m = /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/.exec(s);
  if (!m) return null;
  const jy = +m[1], jm = +m[2], jd = +m[3];
  if (jm < 1 || jm > 12 || jd < 1 || jd > 31) return null;
  if (!jalaali.isValidJalaaliDate(jy, jm, jd)) return null;
  const g = jalaali.toGregorian(jy, jm, jd);
  return `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`;
}

/** روز هفته: 0 = شنبه ... 6 = جمعه */
function weekdayIndex(iso) {
  const p = parseISO(iso);
  if (!p) return null;
  const d = new Date(Date.UTC(p.gy, p.gm - 1, p.gd));
  return (d.getUTCDay() + 1) % 7;
}
function weekdayName(iso) { const i = weekdayIndex(iso); return i == null ? '' : WEEKDAYS[i]; }

/** نمایش کامل: «سه‌شنبه ۹ مهر ۱۴۰۵» */
function formatLong(iso, opts) {
  const p = toJalaliParts(iso);
  if (!p) return '';
  const base = `${toPersianDigits(p.jd)} ${MONTHS[p.jm - 1]} ${toPersianDigits(p.jy)}`;
  return (opts && opts.weekday === false) ? base : `${WEEKDAYS[p.weekday]} ${base}`;
}
function formatDate(iso, persianDigits) { const s = toJalali(iso); return persianDigits === false ? s : toPersianDigits(s); }
function formatTime(str) {
  if (!str) return '';
  const p = parseISO(str);
  if (p && p.h != null) { const d = new Date(Date.UTC(p.gy, p.gm - 1, p.gd, p.h, p.i, p.s) + tzOffsetMinutes * 60000); return toPersianDigits(`${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`); }
  const m = /^(\d{1,2}):(\d{2})/.exec(String(str));
  return m ? toPersianDigits(`${pad(m[1])}:${m[2]}`) : '';
}
/** datetime ذخیره‌شده (UTC) → شمسی با ساعت محلی */
function formatDateTime(iso) {
  const p = parseISO(iso);
  if (!p) return '';
  if (p.h == null) return formatDate(iso);
  const d = new Date(Date.UTC(p.gy, p.gm - 1, p.gd, p.h, p.i, p.s) + tzOffsetMinutes * 60000);
  const j = jalaali.toJalaali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  return toPersianDigits(`${j.jy}/${pad(j.jm)}/${pad(j.jd)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`);
}
/** datetime ذخیره‌شده (UTC) → رشتهٔ datetime محلی `YYYY-MM-DD HH:mm:ss` */
function utcToLocal(iso) {
  const p = parseISO(iso);
  if (!p) return '';
  const d = new Date(Date.UTC(p.gy, p.gm - 1, p.gd, p.h || 0, p.i || 0, p.s || 0) + tzOffsetMinutes * 60000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
/** datetime ذخیره‌شده (UTC) → تاریخ محلی `YYYY-MM-DD` (برای مقایسه با todayISO) */
function localDateOf(iso) { const s = utcToLocal(iso); return s ? s.slice(0, 10) : ''; }
/** datetime محلی (ورودی کاربر) → UTC برای ذخیره */
function localToUtc(iso) {
  const p = parseISO(iso);
  if (!p) return '';
  return new Date(Date.UTC(p.gy, p.gm - 1, p.gd, p.h || 0, p.i || 0, p.s || 0) - tzOffsetMinutes * 60000).toISOString().slice(0, 19).replace('T', ' ');
}
/** زمان نسبی: «۵ دقیقه پیش» */
function timeAgo(iso) {
  const p = parseISO(iso);
  if (!p) return '';
  const t = Date.UTC(p.gy, p.gm - 1, p.gd, p.h || 0, p.i || 0, p.s || 0);
  const diff = Math.max(0, Date.now() - t) / 1000;
  if (diff < 60) return 'لحظاتی پیش';
  if (diff < 3600) return toPersianDigits(Math.floor(diff / 60)) + ' دقیقه پیش';
  if (diff < 86400) return toPersianDigits(Math.floor(diff / 3600)) + ' ساعت پیش';
  if (diff < 86400 * 30) return toPersianDigits(Math.floor(diff / 86400)) + ' روز پیش';
  return formatDate(iso);
}

/** افزودن روز به تاریخ ISO */
function addDays(iso, days) {
  const p = parseISO(iso);
  const d = new Date(Date.UTC(p.gy, p.gm - 1, p.gd + days));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function diffDays(a, b) {
  const pa = parseISO(a), pb = parseISO(b);
  return Math.round((Date.UTC(pb.gy, pb.gm - 1, pb.gd) - Date.UTC(pa.gy, pa.gm - 1, pa.gd)) / 86400000);
}
/** سن به سال */
function age(birthIso) {
  const p = parseISO(birthIso);
  if (!p) return null;
  const t = parseISO(todayISO());
  let a = t.gy - p.gy;
  if (t.gm < p.gm || (t.gm === p.gm && t.gd < p.gd)) a--;
  return a;
}
/** اولین و آخرین روز ماه شمسی به میلادی */
function jalaliMonthRange(jy, jm) {
  const start = jalaali.toGregorian(jy, jm, 1);
  const len = jalaali.jalaaliMonthLength(jy, jm);
  const end = jalaali.toGregorian(jy, jm, len);
  return { start: `${start.gy}-${pad(start.gm)}-${pad(start.gd)}`, end: `${end.gy}-${pad(end.gm)}-${pad(end.gd)}`, length: len };
}
function currentJalali() { return toJalaliParts(todayISO()); }
/** سال تحصیلی جاری بر اساس تاریخ امروز، مثل «۱۴۰۵-۱۴۰۶» */
function currentAcademicYear() {
  const j = currentJalali();
  const start = j.jm >= 7 ? j.jy : j.jy - 1;
  return { startYear: start, title: `${start}-${start + 1}`, startDate: toGregorian(`${start}/07/01`), endDate: toGregorian(`${start + 1}/06/31`) };
}
function jalaliYear(iso) { const p = toJalaliParts(iso); return p ? p.jy : null; }
function jalaliMonth(iso) { const p = toJalaliParts(iso); return p ? p.jm : null; }

module.exports = {
  MONTHS, WEEKDAYS, WEEKDAYS_SHORT, setTimezoneOffset, toEnglishDigits, toPersianDigits,
  nowLocal, todayISO, nowISO, nowTime, parseISO, toJalali, toJalaliParts, toGregorian, weekdayIndex, weekdayName,
  formatLong, formatDate, formatTime, formatDateTime, utcToLocal, localDateOf, localToUtc, timeAgo, addDays, diffDays, age, jalaliMonthRange, currentJalali, currentAcademicYear,
  jalaliYear, jalaliMonth, isValid: (jy, jm, jd) => jalaali.isValidJalaaliDate(jy, jm, jd), monthLength: (jy, jm) => jalaali.jalaaliMonthLength(jy, jm)
};
