'use strict';
/** روزهای کاری مدرسه و تعطیلات رسمی (رویدادهای تقویم از نوع holiday) — مشترک بین حضور و غیاب، دفتر کلاسی و گزارش‌ها */
const db = require('./db');
const settings = require('./settings');
const modules = require('./modules');
const J = require('./jalali');

const schoolDays = () => { const n = settings.getList('school_days').map(Number).filter((x) => x >= 0 && x <= 6); return n.length ? n : [0, 1, 2, 3, 4]; };
const isSchoolDay = (iso) => schoolDays().includes(J.weekdayIndex(iso));

/** نقشهٔ تاریخ → عنوان تعطیلی در بازه (فقط اگر calendar.holidays فعال باشد) */
async function holidaysBetween(from, to) {
  const map = new Map();
  if (!modules.isEnabled('calendar.holidays')) return map;
  const rows = await db.table('events').select('title', 'start_date', 'end_date').where('type', 'holiday').where('start_date', '<=', to).all();
  for (const r of rows) {
    let d = r.start_date; const end = r.end_date && r.end_date >= r.start_date ? r.end_date : r.start_date; let guard = 0;
    while (d <= end && guard++ < 60) { if (d >= from && !map.has(d)) map.set(d, r.title || 'تعطیل'); d = J.addDays(d, 1); }
  }
  return map;
}
/** عنوان تعطیلی یک روز یا null */
async function holidayOn(iso) { const m = await holidaysBetween(iso, iso); return m.get(iso) || null; }
/** وضعیت یک روز: { school, weekend, holiday } */
async function dayInfo(iso) { const holiday = await holidayOn(iso); const weekend = !isSchoolDay(iso); return { iso, weekend, holiday, school: !weekend && !holiday }; }
/** فهرست روزهای آموزشی بازه (بدون آخر هفته و تعطیلات) */
async function schoolDates(from, to) {
  const days = schoolDays(); const hol = await holidaysBetween(from, to); const out = [];
  let d = from; let guard = 0;
  while (d <= to && guard++ < 400) { if (days.includes(J.weekdayIndex(d)) && !hol.has(d)) out.push(d); d = J.addDays(d, 1); }
  return out;
}
module.exports = { schoolDays, isSchoolDay, holidaysBetween, holidayOn, dayInfo, schoolDates };
