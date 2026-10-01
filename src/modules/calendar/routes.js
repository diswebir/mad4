'use strict';
const path = require('path');
const express = require('express');
const db = require('../../core/db');
const auth = require('../../core/auth');
const modules = require('../../core/modules');
const crud = require('../../core/crud');
const people = require('../../core/people');
const J = require('../../core/jalali');

const router = express.Router();
const v = (n) => path.join(__dirname, 'views', n + '.ejs');
router.use(auth.requireAuth);
const E = modules.isEnabled;
const TYPES = { event: 'رویداد', holiday: 'تعطیل', meeting: 'جلسه', trip: 'اردو', ceremony: 'مراسم', exam: 'آزمون', deadline: 'مهلت', other: 'سایر' };
const COLORS = { event: '#2563eb', holiday: '#dc2626', meeting: '#7c3aed', trip: '#059669', ceremony: '#d97706', exam: '#0891b2', deadline: '#be123c', other: '#64748b' };
const AUD = { all: 'همه', students: 'دانش‌آموزان', parents: 'اولیا', teachers: 'معلمان', staff: 'کارکنان', class: 'یک کلاس' };

async function visibleEvents(req, from, to) {
  const q = db.table('events as e').leftJoin('classes as c', 'c.id', 'e.class_id').select('e.*', 'c.title as class_title').where('e.start_date', '<=', to).where((b) => b.where('e.end_date', '>=', from).orWhere((x) => x.whereNull('e.end_date').where('e.start_date', '>=', from))).orderBy('e.start_date').orderBy('e.start_time');
  if (!E('calendar.holidays')) q.where('e.type', '!=', 'holiday');
  const role = req.user.role;
  if (role === 'student' || role === 'parent') { const s = await people.studentOf(req); q.where((b) => { b.whereIn('e.audience', role === 'parent' ? ['all', 'students', 'parents'] : ['all', 'students']); if (s && s.class_id) b.orWhere((x) => x.where('e.audience', 'class').where('e.class_id', s.class_id)); }); }
  else if (role === 'teacher') { const ids = await people.teacherClassIds(req.user.id); q.where((b) => { b.whereIn('e.audience', ['all', 'teachers']).orWhere('e.created_by', req.user.id); if (ids.length) b.orWhere((x) => x.where('e.audience', 'class').whereIn('e.class_id', ids)); }); }
  return q.all();
}
async function extraItems(req, from, to) {
  const items = [];
  if (E('calendar.exam_days') && E('exams')) {
    const q = db.table('exams as e').join('subjects as s', 's.id', 'e.subject_id').join('classes as c', 'c.id', 'e.class_id').select('e.id', 'e.title', 'e.date', 'e.start_time', 's.title as subject', 'c.title as class_title', 'c.id as class_id').whereBetween('e.date', from, to).orderBy('e.date');
    if (req.user.role === 'student' || req.user.role === 'parent') { const s = await people.studentOf(req); q.where('e.class_id', s ? s.class_id : 0); }
    else if (req.user.role === 'teacher') q.whereIn('e.class_id', await people.teacherClassIds(req.user.id));
    (await q.all()).forEach((x) => items.push({ kind: 'exam', date: x.date, title: `آزمون ${x.subject} — ${x.class_title}`, sub: x.title, time: x.start_time, color: COLORS.exam, link: req.user.role === 'student' ? '/exams/schedule' : '/exams/' + x.id }));
  }
  if (E('calendar.homework_due') && E('homework')) {
    const q = db.table('homework as h').join('subjects as s', 's.id', 'h.subject_id').join('classes as c', 'c.id', 'h.class_id').select('h.id', 'h.title', 'h.due_date', 's.title as subject', 'c.title as class_title').whereBetween('h.due_date', from, to);
    if (req.user.role === 'student' || req.user.role === 'parent') { const s = await people.studentOf(req); q.where('h.class_id', s ? s.class_id : 0); }
    else if (req.user.role === 'teacher') q.whereIn('h.class_id', await people.teacherClassIds(req.user.id));
    else q.limit(0);
    if (req.user.role !== 'admin' && req.user.role !== 'staff') (await q.all()).forEach((x) => items.push({ kind: 'homework', date: x.due_date, title: `مهلت تکلیف ${x.subject}`, sub: x.title, color: COLORS.deadline, link: '/homework/' + x.id }));
  }
  return items;
}
router.get('/', async (req, res) => {
  const cur = J.currentJalali();
  const jy = Number(req.query.y) || cur.jy; const jm = Math.min(12, Math.max(1, Number(req.query.m) || cur.jm));
  const range = J.jalaliMonthRange(jy, jm);
  const events = await visibleEvents(req, range.start, range.end);
  const extra = await extraItems(req, range.start, range.end);
  const byDay = {};
  const put = (date, item) => { (byDay[date] = byDay[date] || []).push(item); };
  events.forEach((e) => { const end = e.end_date && e.end_date > e.start_date ? e.end_date : e.start_date; for (let d = e.start_date < range.start ? range.start : e.start_date; d <= end && d <= range.end; d = J.addDays(d, 1)) put(d, { kind: e.type, id: e.id, title: e.title, sub: e.class_title || AUD[e.audience], time: e.start_time, color: e.color || COLORS[e.type] || COLORS.other, link: '/calendar/' + e.id }); });
  extra.forEach((x) => put(x.date, x));
  const monthLen = J.monthLength(jy, jm);
  const firstWeekday = J.weekdayIndex(range.start); // 0 = شنبه
  const days = []; for (let d = 1; d <= monthLen; d++) { const iso = J.toGregorian(`${jy}/${jm}/${d}`); days.push({ d, iso, weekday: (firstWeekday + d - 1) % 7, items: byDay[iso] || [] }); }
  const prev = jm === 1 ? { y: jy - 1, m: 12 } : { y: jy, m: jm - 1 }; const next = jm === 12 ? { y: jy + 1, m: 1 } : { y: jy, m: jm + 1 };
  const upcoming = Object.keys(byDay).filter((d) => d >= J.todayISO()).sort().slice(0, 8).map((d) => ({ date: d, items: byDay[d] }));
  res.render(v('month'), { title: 'تقویم', jy, jm, days, firstWeekday, prev, next, today: J.todayISO(), MONTHS: J.MONTHS, WEEKDAYS: J.WEEKDAYS_SHORT, upcoming, canManage: ['admin', 'staff', 'teacher'].includes(req.user.role), TYPES, monthlyView: E('calendar.monthly_view') });
});
router.get('/ical', modules.requireEnabled('calendar.ical'), async (req, res) => {
  const from = J.addDays(J.todayISO(), -30); const to = J.addDays(J.todayISO(), 365);
  const events = await visibleEvents(req, from, to);
  const fmt = (d, t) => d.replace(/-/g, '') + (t ? 'T' + t.replace(':', '') + '00' : '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//madrese//calendar//FA'];
  events.forEach((e) => { lines.push('BEGIN:VEVENT', `UID:event-${e.id}@madrese`, `SUMMARY:${String(e.title).replace(/[\n,;]/g, ' ')}`, e.start_time ? `DTSTART:${fmt(e.start_date, e.start_time)}` : `DTSTART;VALUE=DATE:${fmt(e.start_date)}`, e.end_time || e.end_date ? (e.end_time ? `DTEND:${fmt(e.end_date || e.start_date, e.end_time)}` : `DTEND;VALUE=DATE:${fmt(J.addDays(e.end_date || e.start_date, 1))}`) : `DTEND;VALUE=DATE:${fmt(J.addDays(e.start_date, 1))}`, e.description ? `DESCRIPTION:${String(e.description).replace(/\n/g, '\\n')}` : '', 'END:VEVENT'); });
  lines.push('END:VCALENDAR');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="school-calendar.ics"');
  res.send(lines.filter(Boolean).join('\r\n'));
});
crud(router, {
  path: '/events', table: 'events', alias: 'e', title: 'رویداد', plural: 'رویدادها', icon: 'bi-calendar-event', feature: 'calendar.events', orderBy: 'start_date', dir: 'desc', roles: ['admin', 'staff', 'teacher'], viewRoles: ['admin', 'staff', 'teacher'],
  breadcrumbs: [{ title: 'تقویم', href: '/calendar' }],
  query: (q, req) => { q.leftJoin('classes as c', 'c.id', 'e.class_id').select('e.*', 'c.title as class_title'); if (req && req.user.role === 'teacher') q.where('e.created_by', req.user.id); return q; },
  fields: [
    { name: 'title', label: 'عنوان', type: 'text', required: true, list: true, search: true },
    { name: 'type', label: 'نوع', type: 'select', required: true, list: true, filter: true, options: (req) => (E('calendar.holidays') ? TYPES : Object.fromEntries(Object.entries(TYPES).filter(([k]) => k !== 'holiday'))), format: (val, row) => `<span class="badge" style="background:${row.color || COLORS[val] || COLORS.other}">${TYPES[val] || val}</span>` },
    { name: 'start_date', label: 'تاریخ شروع', type: 'date', required: true, list: true },
    { name: 'end_date', label: 'تاریخ پایان', type: 'date', list: true, help: 'برای رویداد یک‌روزه خالی بگذارید' },
    { name: 'start_time', label: 'ساعت شروع', type: 'time' }, { name: 'end_time', label: 'ساعت پایان', type: 'time' },
    { name: 'audience', label: 'مخاطب', type: 'select', required: true, list: true, options: (req) => (req.user.role === 'teacher' ? { class: AUD.class } : AUD) },
    { name: 'class_id', label: 'کلاس (برای مخاطب کلاس)', type: 'select', options: async (req) => [{ value: '', label: '—' }].concat(await people.classOptions(req)) },
    { name: 'color', label: 'رنگ', type: 'color' },
    { name: 'description', label: 'توضیحات', type: 'textarea', search: true }
  ],
  defaults: (req) => ({ start_date: J.todayISO(), type: 'event', audience: req.user.role === 'teacher' ? 'class' : 'all', color: COLORS.event }),
  validate: (val, d) => { if (d.start_date && d.end_date && d.end_date < d.start_date) val.custom(false, 'تاریخ پایان باید بعد از شروع باشد'); if (d.audience === 'class' && !d.class_id) val.custom(false, 'کلاس را انتخاب کنید'); },
  beforeSave: async (data, req, isNew) => { if (req.user.role === 'teacher') { data.audience = 'class'; if (!(await people.teacherClassIds(req.user.id)).includes(Number(data.class_id))) throw new Error('فقط برای کلاس خودتان'); } if (data.audience !== 'class') data.class_id = null; if (!data.color) data.color = COLORS[data.type] || COLORS.other; if (data.type === 'holiday' && !E('calendar.holidays')) data.type = 'event'; if (isNew) data.created_by = req.user.id; return data; },
  afterSaveRedirect: () => '/calendar',
  pageActions: () => [{ href: '/calendar', label: 'نمای تقویم', icon: 'bi-calendar3', class: 'btn-outline-primary' }]
});
router.get('/:id', async (req, res) => {
  const e = await db.table('events as e').leftJoin('classes as c', 'c.id', 'e.class_id').leftJoin('users as u', 'u.id', 'e.created_by').select('e.*', 'c.title as class_title', 'u.name as creator').where('e.id', req.params.id).first();
  if (!e) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  res.render(v('show'), { title: e.title, e, TYPES, AUD, canManage: ['admin', 'staff'].includes(req.user.role) || e.created_by === req.user.id });
});
module.exports = router;
module.exports.TYPES = TYPES;
