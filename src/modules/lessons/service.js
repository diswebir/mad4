'use strict';
/** سرویس دفتر کلاسی: جلسات مورد انتظار از برنامهٔ هفتگی، تعطیلات، پیشرفت سرفصل‌ها */
const db = require('../../core/db');
const settings = require('../../core/settings');
const modules = require('../../core/modules');
const J = require('../../core/jalali');

const schoolDays = () => { const n = settings.getList('school_days').map(Number).filter((x) => x >= 0 && x <= 6); return n.length ? n : [0, 1, 2, 3, 4]; };

/** مجموعهٔ روزهای تعطیل (رویدادهای نوع holiday) در بازه */
async function holidaysBetween(from, to) {
  const set = new Set();
  if (!modules.isEnabled('calendar.holidays')) return set;
  const rows = await db.table('events').select('start_date', 'end_date').where('type', 'holiday').where('start_date', '<=', to).all();
  for (const r of rows) { let d = r.start_date; const end = r.end_date || r.start_date; let guard = 0; while (d <= end && guard++ < 60) { if (d >= from) set.add(d); d = J.addDays(d, 1); } }
  return set;
}
/** روزهای مدرسه در بازه (بدون تعطیلات) */
async function schoolDates(from, to) {
  const days = schoolDays(); const hol = await holidaysBetween(from, to); const out = [];
  let d = from; let guard = 0;
  while (d <= to && guard++ < 400) { const w = J.weekdayIndex(d); if (days.includes(w) && !hol.has(d)) out.push(d); d = J.addDays(d, 1); }
  return out;
}
/**
 * جلسات مورد انتظار در بازه بر اساس برنامهٔ هفتگی، همراه با گزارش ثبت‌شده (در صورت وجود)
 * filters: { classId, teacherId, classSubjectId }
 */
async function expectedSessions(from, to, filters) {
  filters = filters || {};
  const dates = await schoolDates(from, to);
  if (!dates.length) return [];
  const q = db.table('schedule_slots as ss').join('class_subjects as cs', 'cs.id', 'ss.class_subject_id').join('classes as c', 'c.id', 'ss.class_id').join('subjects as s', 's.id', 'cs.subject_id').leftJoin('teachers as t', 't.id', 'cs.teacher_id').leftJoin('users as tu', 'tu.id', 't.user_id')
    .select('ss.class_id', 'ss.class_subject_id', 'ss.day_of_week', 'ss.period', 'ss.start_time', 'ss.end_time', 'c.title as class_title', 's.title as subject_title', 'cs.teacher_id', 'tu.name as teacher_name', 't.user_id as teacher_user_id', 'cs.subject_id')
    .where('c.is_active', 1);
  if (filters.classId) q.where('ss.class_id', filters.classId);
  if (filters.teacherId) q.where('cs.teacher_id', filters.teacherId);
  if (filters.classSubjectId) q.where('ss.class_subject_id', filters.classSubjectId);
  const slots = await q.all();
  if (!slots.length) return [];
  const lq = db.table('lesson_logs').whereBetween('date', from, to);
  if (filters.classId) lq.where('class_id', filters.classId);
  if (filters.teacherId) lq.where('teacher_id', filters.teacherId);
  if (filters.classSubjectId) lq.where('class_subject_id', filters.classSubjectId);
  const logs = await lq.all();
  const logMap = new Map(); logs.forEach((l) => logMap.set(`${l.class_subject_id}|${l.date}|${l.period}`, l));
  const byDay = {}; slots.forEach((s) => { (byDay[s.day_of_week] = byDay[s.day_of_week] || []).push(s); });
  const out = [];
  for (const d of dates) {
    const w = J.weekdayIndex(d);
    for (const s of byDay[w] || []) out.push(Object.assign({ date: d, log: logMap.get(`${s.class_subject_id}|${d}|${s.period}`) || null }, s));
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.period - b.period));
  return out;
}
/** پیشرفت سرفصل‌ها برای یک کلاس-درس */
async function coverageFor(cs) {
  const items = await db.table('syllabus_items').where('subject_id', cs.subject_id).orderBy('sort_order').orderBy('id').all();
  const logs = await db.table('lesson_logs').where('class_subject_id', cs.id).orderBy('date').all();
  const today = J.todayISO();
  const firstBy = new Map(); const countBy = new Map();
  logs.forEach((l) => { if (l.syllabus_item_id) { if (!firstBy.has(l.syllabus_item_id)) firstBy.set(l.syllabus_item_id, l.date); countBy.set(l.syllabus_item_id, (countBy.get(l.syllabus_item_id) || 0) + 1); } });
  items.forEach((it) => { it.first_date = firstBy.get(it.id) || null; it.sessions = countBy.get(it.id) || 0; it.state = it.first_date ? 'done' : (it.planned_to && it.planned_to < today ? 'late' : (it.planned_from && it.planned_from <= today ? 'current' : 'upcoming')); });
  const done = items.filter((i) => i.state === 'done').length;
  const plannedHours = items.reduce((a, b) => a + (Number(b.planned_hours) || 0), 0);
  const dueByNow = items.filter((i) => i.planned_to && i.planned_to < today).length;
  return { items, total: items.length, done, late: items.filter((i) => i.state === 'late').length, percent: items.length ? Math.round(done / items.length * 100) : null, sessions: logs.length, plannedHours, dueByNow, lastLog: logs.length ? logs[logs.length - 1] : null };
}
module.exports = { schoolDays, holidaysBetween, schoolDates, expectedSessions, coverageFor };
