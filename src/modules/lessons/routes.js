'use strict';
const path = require('path');
const express = require('express');
const db = require('../../core/db');
const people = require('../../core/people');
const auth = require('../../core/auth');
const modules = require('../../core/modules');
const activity = require('../../core/activity');
const utils = require('../../core/utils');
const J = require('../../core/jalali');
const settings = require('../../core/settings');
const crud = require('../../core/crud');
const svc = require('./service');

const router = express.Router();
const v = (n) => path.join(__dirname, 'views', n + '.ejs');
router.use(auth.requireAuth);
const E = modules.isEnabled;
const isStaff = (req) => req.user.role === 'admin' || req.can('lessons.manage');

async function teacherCtx(req) {
  if (req.user.role !== 'teacher') return null;
  const t = await db.table('teachers').where('user_id', req.user.id).first();
  if (!t) return { id: -1, csIds: [], classIds: [] };
  const cs = await db.table('class_subjects').select('id', 'class_id').where('teacher_id', t.id).all();
  const homeroom = await db.table('classes').where('teacher_id', t.id).pluck('id');
  return { id: t.id, csIds: cs.map((x) => x.id), classIds: [...new Set(cs.map((x) => x.class_id).concat(homeroom))] };
}
async function csList(req, classId) {
  const q = db.table('class_subjects as cs').join('subjects as s', 's.id', 'cs.subject_id').join('classes as c', 'c.id', 'cs.class_id').leftJoin('teachers as t', 't.id', 'cs.teacher_id').leftJoin('users as u', 'u.id', 't.user_id')
    .select('cs.*', 's.title as subject_title', 'c.title as class_title', 'u.name as teacher_name').where('c.is_active', 1).orderBy('c.title').orderBy('s.title');
  if (classId) q.where('cs.class_id', classId);
  const tc = await teacherCtx(req); if (tc) q.whereIn('cs.id', tc.csIds);
  return q.all();
}
async function csOne(id) {
  return db.table('class_subjects as cs').join('subjects as s', 's.id', 'cs.subject_id').join('classes as c', 'c.id', 'cs.class_id').leftJoin('teachers as t', 't.id', 'cs.teacher_id').leftJoin('users as u', 'u.id', 't.user_id')
    .select('cs.*', 's.title as subject_title', 'c.title as class_title', 'u.name as teacher_name').where('cs.id', id).first();
}
function baseQuery() {
  return db.table('lesson_logs as l').join('classes as c', 'c.id', 'l.class_id').join('subjects as s', 's.id', 'l.subject_id').leftJoin('teachers as t', 't.id', 'l.teacher_id').leftJoin('users as u', 'u.id', 't.user_id').leftJoin('syllabus_items as si', 'si.id', 'l.syllabus_item_id')
    .select('l.*', 'c.title as class_title', 's.title as subject_title', 'u.name as teacher_name', 'si.title as syllabus_title');
}
const editDays = () => Math.max(0, settings.getInt('lesson_log_edit_days', 7));
/** آیا کاربر اجازهٔ ویرایش/حذف این گزارش را دارد؟ */
async function canEdit(req, log) {
  if (isStaff(req)) return { ok: true };
  const tc = await teacherCtx(req);
  if (!tc || !tc.csIds.includes(log.class_subject_id)) return { ok: false, reason: 'این گزارش متعلق به کلاس/درس شما نیست.' };
  if (E('lessons.edit_window') && J.addDays(log.date, editDays()) < J.todayISO()) return { ok: false, reason: `مهلت ویرایش گزارش (${J.toPersianDigits(editDays())} روز پس از جلسه) به پایان رسیده است؛ برای اصلاح به مدیر مراجعه کنید.` };
  return { ok: true };
}
function parseMonth(q) {
  const cur = J.toJalaliParts(J.todayISO());
  const m = /^(\d{4})\/(\d{1,2})$/.exec(J.toEnglishDigits(String(q || '')));
  const jy = m ? Number(m[1]) : cur.jy; const jm = m ? Math.min(12, Math.max(1, Number(m[2]))) : cur.jm;
  return { jy, jm, label: `${J.MONTHS[jm - 1]} ${J.toPersianDigits(jy)}`, key: `${jy}/${jm}`, prev: jm === 1 ? `${jy - 1}/12` : `${jy}/${jm - 1}`, next: jm === 12 ? `${jy + 1}/1` : `${jy}/${jm + 1}`, range: J.jalaliMonthRange(jy, jm) };
}
const collect = (req) => {
  const d = utils.cleanBody(req.body, { fields: ['topic', 'description', 'homework', 'syllabus_item_id', 'date', 'period'], dates: ['date'], numbers: ['syllabus_item_id', 'period'] });
  return d;
};

// ---------- درس‌های من (دانش‌آموز/ولی) ----------
router.get('/my', auth.requireRole('student', 'parent'), modules.requireEnabled('lessons.student_view'), async (req, res) => {
  const s = await people.studentOf(req);
  const from = req.query.from && J.toGregorian(req.query.from) ? J.toGregorian(req.query.from) : J.addDays(J.todayISO(), -30);
  const to = J.todayISO();
  let rows = [], subjects = [];
  if (s && s.class_id) {
    if (!s.class_title) { const c = await db.findById('classes', s.class_id); s.class_title = c ? c.title : ''; }
    const q = baseQuery().where('l.class_id', s.class_id).whereBetween('l.date', from, to).orderBy('l.date', 'desc').orderBy('l.period');
    if (req.query.subject_id) q.where('l.subject_id', req.query.subject_id);
    rows = await q.all();
    subjects = await db.table('class_subjects as cs').join('subjects as s', 's.id', 'cs.subject_id').select('s.id', 's.title').where('cs.class_id', s.class_id).orderBy('s.title').all();
  }
  const byDate = {}; rows.forEach((r) => { (byDate[r.date] = byDate[r.date] || []).push(r); });
  res.render(v('my'), { title: 'درس‌های من', s, byDate, dates: Object.keys(byDate), subjects, f: { from: J.toJalali(from), subject_id: req.query.subject_id || '' }, total: rows.length });
});

// ---------- سرفصل‌ها (CRUD) ----------
crud(router, {
  path: '/syllabus', table: 'syllabus_items', alias: 'si', title: 'سرفصل', plural: 'سرفصل‌ها و بودجه‌بندی', icon: 'bi-list-check', feature: 'lessons.syllabus',
  roles: ['admin'], permission: 'lessons.manage', viewRoles: ['admin', 'teacher'], orderBy: 'sort_order', dir: 'asc', perPage: 50,
  query: (q) => q.leftJoin('subjects as s', 's.id', 'si.subject_id').leftJoin('grade_levels as g', 'g.id', 's.grade_level_id').select('si.*', 's.title as subject_title', 'g.title as grade_title'),
  fields: [
    { name: 'subject_id', label: 'درس', type: 'select', required: true, list: true, filter: true, options: async () => (await db.table('subjects as s').leftJoin('grade_levels as g', 'g.id', 's.grade_level_id').select('s.id', 's.title', 'g.title as grade').orderBy('g.sort_order').orderBy('s.title').all()).map((r) => ({ value: r.id, label: `${r.title}${r.grade ? ' — ' + r.grade : ''}` })) },
    { name: 'sort_order', label: 'ترتیب', type: 'number', list: true, help: 'شمارهٔ فصل/ترتیب تدریس' },
    { name: 'title', label: 'عنوان سرفصل', type: 'text', required: true, list: true, search: true },
    { name: 'description', label: 'شرح / اهداف', type: 'textarea' },
    { name: 'planned_hours', label: 'ساعت پیش‌بینی‌شده', type: 'number', list: true },
    { name: 'planned_from', label: 'شروع برنامه‌ریزی‌شده', type: 'date', list: true },
    { name: 'planned_to', label: 'پایان برنامه‌ریزی‌شده', type: 'date', list: true }
  ],
  beforeSave: async (data) => { if (!data.academic_year_id) { const y = await db.table('academic_years').where('is_current', 1).first(); data.academic_year_id = y ? y.id : null; } if (data.subject_id) { const sb = await db.findById('subjects', data.subject_id); if (sb) data.grade_level_id = sb.grade_level_id; } return data; },
  pageActions: () => (E('lessons.coverage') ? [{ href: '/lessons/coverage', label: 'پیشرفت تدریس', icon: 'bi-bar-chart-steps', class: 'btn-light' }] : [])
});

// ---------- فهرست گزارش‌ها ----------
router.use(auth.requireRoleOrPermission(['admin', 'teacher'], 'lessons.manage'));
async function filtersOf(req) {
  const tc = await teacherCtx(req);
  const f = { class_id: req.query.class_id || '', class_subject_id: req.query.class_subject_id || '', teacher_id: isStaff(req) ? (req.query.teacher_id || '') : '', from: req.query.from ? J.toGregorian(req.query.from) : '', to: req.query.to ? J.toGregorian(req.query.to) : '', q: utils.normalizePersian(req.query.q || '').trim() };
  const apply = (q) => {
    if (tc) q.whereIn('l.class_subject_id', tc.csIds.length ? tc.csIds : [-1]);
    if (f.class_id) q.where('l.class_id', f.class_id);
    if (f.class_subject_id) q.where('l.class_subject_id', f.class_subject_id);
    if (f.teacher_id) q.where('l.teacher_id', f.teacher_id);
    if (f.from) q.where('l.date', '>=', f.from);
    if (f.to) q.where('l.date', '<=', f.to);
    if (f.q) q.where((b) => b.where('l.topic', 'like', `%${f.q}%`).orWhere('l.description', 'like', `%${f.q}%`).orWhere('l.homework', 'like', `%${f.q}%`));
    return q;
  };
  return { f, apply, tc };
}
router.get('/', async (req, res) => {
  const { f, apply, tc } = await filtersOf(req);
  const result = await apply(baseQuery()).orderBy('l.date', 'desc').orderBy('l.period', 'desc').paginate(req.query.page, 30);
  const classes = tc ? await db.table('classes').whereIn('id', tc.classIds.length ? tc.classIds : [-1]).orderBy('title').all() : await db.table('classes').where('is_active', 1).orderBy('title').all();
  const teachers = isStaff(req) ? await db.table('teachers as t').join('users as u', 'u.id', 't.user_id').select('t.id', 'u.name').orderBy('u.name').all() : [];
  const subjects = await csList(req, f.class_id || null);
  // آمار هفتهٔ جاری
  const weekStart = J.addDays(J.todayISO(), -J.weekdayIndex(J.todayISO()));
  const stats = { week: 0, missingWeek: null };
  const wq = db.table('lesson_logs as l').whereBetween('l.date', weekStart, J.todayISO()); if (tc) wq.whereIn('l.class_subject_id', tc.csIds.length ? tc.csIds : [-1]);
  stats.week = await wq.count();
  if (E('lessons.missing')) { const exp = await svc.expectedSessions(weekStart, J.todayISO(), tc ? { teacherId: tc.id } : {}); stats.expectedWeek = exp.length; stats.missingWeek = exp.filter((e) => !e.log).length; }
  res.render(v('index'), { title: 'دفتر کلاسی', result, f: Object.assign({}, f, { from: f.from ? J.toJalali(f.from) : '', to: f.to ? J.toJalali(f.to) : '' }), classes, teachers, subjects, stats, isTeacher: !!tc, staff: isStaff(req), editDays: editDays() });
});
router.get('/export.csv', modules.requireEnabled('lessons.export'), async (req, res) => {
  const { apply } = await filtersOf(req);
  const rows = await apply(baseQuery()).orderBy('l.date', 'desc').orderBy('l.period').limit(5000).all();
  const cols = [{ label: 'تاریخ', value: (r) => J.toJalali(r.date) }, { label: 'روز', value: (r) => J.weekdayName(r.date) }, { label: 'زنگ', key: 'period' }, { label: 'کلاس', key: 'class_title' }, { label: 'درس', key: 'subject_title' }, { label: 'معلم', key: 'teacher_name' }, { label: 'موضوع', key: 'topic' }, { label: 'سرفصل', key: 'syllabus_title' }, { label: 'شرح', key: 'description' }, { label: 'تکلیف', key: 'homework' }];
  await activity.log(req, 'export', 'lesson_logs', null, 'خروجی دفتر کلاسی');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="lesson-logs-${J.todayISO()}.csv"`);
  res.send(utils.toCSV(rows, cols));
});

// ---------- تدریس امروز ----------
router.get('/today', modules.requireEnabled('lessons.today'), async (req, res) => {
  const tc = await teacherCtx(req);
  const date = (req.query.date && J.toGregorian(req.query.date)) || J.todayISO();
  if (date > J.todayISO()) { req.flash('warning', 'برای روزهای آینده نمی‌توان گزارش ثبت کرد.'); return res.redirect('/lessons/today'); }
  const filters = tc ? { teacherId: tc.id } : {};
  if (!tc && req.query.teacher_id) filters.teacherId = req.query.teacher_id;
  if (req.query.class_id) filters.classId = req.query.class_id;
  const sessions = await svc.expectedSessions(date, date, filters);
  const isSchoolDay = svc.schoolDays().includes(J.weekdayIndex(date));
  const holiday = (await svc.holidaysBetween(date, date)).has(date);
  // سرفصل‌های هر درس برای انتخاب سریع
  const subjIds = [...new Set(sessions.map((s) => s.subject_id))];
  const syl = subjIds.length && E('lessons.syllabus') ? await db.table('syllabus_items').whereIn('subject_id', subjIds).orderBy('sort_order').orderBy('id').all() : [];
  const sylBy = {}; syl.forEach((i) => { (sylBy[i.subject_id] = sylBy[i.subject_id] || []).push(i); });
  const teachers = tc ? [] : await db.table('teachers as t').join('users as u', 'u.id', 't.user_id').select('t.id', 'u.name').orderBy('u.name').all();
  const byTeacher = {}; if (!tc) sessions.forEach((s) => { const k = s.teacher_name || '—'; (byTeacher[k] = byTeacher[k] || { total: 0, done: 0 }); byTeacher[k].total++; if (s.log) byTeacher[k].done++; });
  res.render(v('today'), { title: tc ? 'تدریس امروز' : 'وضعیت ثبت گزارش تدریس', date, jdate: J.toJalali(date), weekday: J.weekdayName(date), isSchoolDay, holiday, sessions, sylBy, isTeacher: !!tc, teachers, f: { teacher_id: req.query.teacher_id || '', class_id: req.query.class_id || '' }, byTeacher, prev: J.toJalali(J.addDays(date, -1)), next: date < J.todayISO() ? J.toJalali(J.addDays(date, 1)) : null, done: sessions.filter((s) => s.log).length });
});
/** ثبت سریع از صفحهٔ «تدریس امروز» */
router.post('/quick', modules.requireEnabled('lessons.today'), async (req, res) => {
  const cs = await csOne(req.body.class_subject_id);
  const tc = await teacherCtx(req);
  const back = '/lessons/today?date=' + encodeURIComponent(req.body.date || '');
  if (!cs || (tc && !tc.csIds.includes(cs.id))) { req.flash('danger', 'کلاس/درس نامعتبر است.'); return res.redirect(back); }
  const data = collect(req);
  if (!data.topic || !data.date || !data.period) { req.flash('danger', 'موضوع تدریس الزامی است.'); return res.redirect(back); }
  if (data.date > J.todayISO()) { req.flash('danger', 'تاریخ آینده مجاز نیست.'); return res.redirect(back); }
  const existing = await db.table('lesson_logs').where({ class_subject_id: cs.id, date: data.date, period: data.period }).first();
  if (existing) {
    const ce = await canEdit(req, existing); if (!ce.ok) { req.flash('danger', ce.reason); return res.redirect(back); }
    await db.update('lesson_logs', { topic: data.topic, description: data.description, homework: data.homework, syllabus_item_id: data.syllabus_item_id || null, updated_at: db.now() }, { id: existing.id });
    await activity.log(req, 'update', 'lesson_logs', existing.id, `ویرایش گزارش تدریس ${cs.class_title} — ${cs.subject_title} (${J.toJalali(data.date)})`);
  } else {
    const id = await db.insert('lesson_logs', { class_id: cs.class_id, class_subject_id: cs.id, subject_id: cs.subject_id, teacher_id: tc ? tc.id : cs.teacher_id, date: data.date, period: data.period, topic: data.topic, description: data.description, homework: data.homework, syllabus_item_id: data.syllabus_item_id || null, created_by: req.user.id, created_at: db.now() });
    await activity.log(req, 'create', 'lesson_logs', id, `گزارش تدریس ${cs.class_title} — ${cs.subject_title} (${J.toJalali(data.date)} زنگ ${data.period})`);
  }
  req.flash('success', `گزارش «${cs.subject_title} — ${cs.class_title}» ثبت شد.`);
  res.redirect(back);
});

// ---------- ثبت/ویرایش کامل ----------
async function formCtx(req, log) {
  const subjects = await csList(req);
  const csId = log ? log.class_subject_id : (req.query.class_subject_id || (subjects[0] && subjects[0].id));
  const cs = csId ? subjects.find((x) => x.id === Number(csId)) : null;
  const syllabus = cs && E('lessons.syllabus') ? await db.table('syllabus_items').where('subject_id', cs.subject_id).orderBy('sort_order').orderBy('id').all() : [];
  return { subjects, cs, syllabus, periods: Math.max(1, settings.getInt('weekly_periods', 4)) };
}
router.get('/new', async (req, res) => {
  const ctx = await formCtx(req, null);
  res.render(v('form'), Object.assign({ title: 'ثبت گزارش تدریس', log: { date: req.query.date ? J.toGregorian(req.query.date) : J.todayISO(), period: Number(req.query.period) || 1, class_subject_id: ctx.cs ? ctx.cs.id : '' } }, ctx));
});
router.post('/', async (req, res) => {
  const tc = await teacherCtx(req);
  const cs = await csOne(req.body.class_subject_id);
  if (!cs || (tc && !tc.csIds.includes(cs.id))) { req.flash('danger', 'کلاس/درس نامعتبر است.'); req.keepInput(); return res.redirect('/lessons/new'); }
  const data = collect(req);
  if (!data.topic || !data.date || !data.period) { req.flash('danger', 'موضوع، تاریخ و زنگ الزامی است.'); req.keepInput(); return res.redirect('/lessons/new?class_subject_id=' + cs.id); }
  if (data.date > J.todayISO()) { req.flash('danger', 'تاریخ آینده مجاز نیست.'); req.keepInput(); return res.redirect('/lessons/new?class_subject_id=' + cs.id); }
  const existing = await db.table('lesson_logs').where({ class_subject_id: cs.id, date: data.date, period: data.period }).first();
  if (existing) { req.flash('warning', 'برای این جلسه قبلاً گزارش ثبت شده است؛ می‌توانید آن را ویرایش کنید.'); return res.redirect('/lessons/' + existing.id + '/edit'); }
  const id = await db.insert('lesson_logs', { class_id: cs.class_id, class_subject_id: cs.id, subject_id: cs.subject_id, teacher_id: tc ? tc.id : cs.teacher_id, date: data.date, period: data.period, topic: data.topic, description: data.description, homework: data.homework, syllabus_item_id: data.syllabus_item_id || null, created_by: req.user.id, created_at: db.now() });
  await activity.log(req, 'create', 'lesson_logs', id, `گزارش تدریس ${cs.class_title} — ${cs.subject_title} (${J.toJalali(data.date)} زنگ ${data.period})`);
  req.flash('success', 'گزارش تدریس ثبت شد.');
  res.redirect(req.body.another ? '/lessons/new?class_subject_id=' + cs.id + '&date=' + J.toJalali(data.date) : '/lessons');
});
router.get('/:id/edit', async (req, res) => {
  const log = await baseQuery().where('l.id', req.params.id).first();
  if (!log) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const ce = await canEdit(req, log); if (!ce.ok) return res.status(403).render('errors/403', { title: 'دسترسی غیرمجاز', message: ce.reason });
  const ctx = await formCtx(req, log);
  res.render(v('form'), Object.assign({ title: 'ویرایش گزارش تدریس', log }, ctx));
});
router.post('/:id', async (req, res) => {
  const log = await db.findById('lesson_logs', req.params.id);
  if (!log) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const ce = await canEdit(req, log); if (!ce.ok) return res.status(403).render('errors/403', { title: 'دسترسی غیرمجاز', message: ce.reason });
  const data = collect(req);
  if (!data.topic) { req.flash('danger', 'موضوع تدریس الزامی است.'); return res.redirect('/lessons/' + log.id + '/edit'); }
  const upd = { topic: data.topic, description: data.description, homework: data.homework, syllabus_item_id: data.syllabus_item_id || null, updated_at: db.now() };
  if (isStaff(req) && data.date && data.period) {
    if (data.date > J.todayISO()) { req.flash('danger', 'تاریخ آینده مجاز نیست.'); return res.redirect('/lessons/' + log.id + '/edit'); }
    const dup = await db.table('lesson_logs').where({ class_subject_id: log.class_subject_id, date: data.date, period: data.period }).where('id', '!=', log.id).first();
    if (dup) { req.flash('danger', 'برای این تاریخ و زنگ گزارش دیگری وجود دارد.'); return res.redirect('/lessons/' + log.id + '/edit'); }
    upd.date = data.date; upd.period = data.period;
  }
  await db.update('lesson_logs', upd, { id: log.id });
  await activity.log(req, 'update', 'lesson_logs', log.id, `ویرایش گزارش تدریس #${log.id}`);
  req.flash('success', 'گزارش ویرایش شد.');
  res.redirect('/lessons');
});
router.post('/:id/delete', async (req, res) => {
  const log = await db.findById('lesson_logs', req.params.id);
  if (!log) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const ce = await canEdit(req, log); if (!ce.ok) return res.status(403).render('errors/403', { title: 'دسترسی غیرمجاز', message: ce.reason });
  await db.remove('lesson_logs', { id: log.id });
  await activity.log(req, 'delete', 'lesson_logs', log.id, `حذف گزارش تدریس #${log.id} (${J.toJalali(log.date)})`);
  req.flash('success', 'گزارش حذف شد.');
  res.redirect(req.get('referer') && /\/lessons\/today/.test(req.get('referer')) ? req.get('referer') : '/lessons');
});

// ---------- دفتر کلاسی ماهانه ----------
router.get('/class/:classId', modules.requireEnabled('lessons.register'), async (req, res) => {
  const cls = await db.findById('classes', req.params.classId);
  if (!cls) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const tc = await teacherCtx(req);
  if (tc && !tc.classIds.includes(cls.id)) return res.status(403).render('errors/403', { title: 'دسترسی غیرمجاز' });
  const m = parseMonth(req.query.month);
  const to = m.range.end > J.todayISO() ? J.todayISO() : m.range.end;
  const sessions = m.range.start <= to ? await svc.expectedSessions(m.range.start, to, { classId: cls.id }) : [];
  const extra = await baseQuery().where('l.class_id', cls.id).whereBetween('l.date', m.range.start, m.range.end).all(); // گزارش‌های خارج از برنامه
  const key = (d, p) => d + '|' + p;
  const grid = {}; const dates = [];
  sessions.forEach((s) => { if (!grid[s.date]) { grid[s.date] = {}; dates.push(s.date); } grid[s.date][s.period] = s; });
  extra.forEach((l) => { if (!grid[l.date]) { grid[l.date] = {}; dates.push(l.date); } if (!grid[l.date][l.period]) grid[l.date][l.period] = { date: l.date, period: l.period, subject_title: l.subject_title, teacher_name: l.teacher_name, log: l, unscheduled: true }; else if (!grid[l.date][l.period].log) grid[l.date][l.period].log = l; });
  dates.sort();
  const periods = Math.max(settings.getInt('weekly_periods', 4), ...sessions.map((s) => s.period), ...extra.map((l) => l.period));
  const total = sessions.length, done = sessions.filter((s) => s.log).length;
  const print = req.query.print === '1';
  res.render(v('class'), Object.assign(print ? { layout: 'layouts/print' } : {}, { title: `دفتر کلاسی ${cls.title} — ${m.label}`, cls, m, dates, grid, periods, total, done, print, key, isTeacher: !!tc }));
});

// ---------- پیشرفت تدریس ----------
router.get('/coverage', modules.requireEnabled('lessons.coverage'), async (req, res) => {
  const tc = await teacherCtx(req);
  const classes = tc ? await db.table('classes').whereIn('id', tc.classIds.length ? tc.classIds : [-1]).orderBy('title').all() : await db.table('classes').where('is_active', 1).orderBy('title').all();
  const classId = Number(req.query.class_id) || (classes[0] && classes[0].id);
  const list = classId ? await csList(req, classId) : [];
  const rows = [];
  for (const cs of list) rows.push(Object.assign({ cs }, await svc.coverageFor(cs)));
  const detail = req.query.class_subject_id ? rows.find((r) => r.cs.id === Number(req.query.class_subject_id)) : null;
  res.render(v('coverage'), { title: 'پیشرفت تدریس', classes, classId, rows, detail, isTeacher: !!tc });
});

// ---------- جلسات ثبت‌نشده ----------
router.get('/missing', modules.requireEnabled('lessons.missing'), async (req, res) => {
  const tc = await teacherCtx(req);
  const to = (req.query.to && J.toGregorian(req.query.to)) || J.todayISO();
  const from = (req.query.from && J.toGregorian(req.query.from)) || J.addDays(to, -13);
  const filters = tc ? { teacherId: tc.id } : {};
  if (!tc && req.query.teacher_id) filters.teacherId = req.query.teacher_id;
  if (req.query.class_id) filters.classId = req.query.class_id;
  const sessions = from <= to ? await svc.expectedSessions(from, to > J.todayISO() ? J.todayISO() : to, filters) : [];
  const missing = sessions.filter((s) => !s.log);
  const byTeacher = {};
  sessions.forEach((s) => { const k = s.teacher_id || 0; byTeacher[k] = byTeacher[k] || { teacher_id: k, name: s.teacher_name || 'بدون معلم', total: 0, missing: 0, classes: new Set() }; byTeacher[k].total++; if (!s.log) { byTeacher[k].missing++; byTeacher[k].classes.add(s.class_title); } });
  const teacherRows = Object.values(byTeacher).map((t) => Object.assign(t, { classes: [...t.classes], percent: t.total ? Math.round((t.total - t.missing) / t.total * 100) : 100 })).sort((a, b) => b.missing - a.missing);
  const teachers = tc ? [] : await db.table('teachers as t').join('users as u', 'u.id', 't.user_id').select('t.id', 'u.name').orderBy('u.name').all();
  const classes = tc ? await db.table('classes').whereIn('id', tc.classIds.length ? tc.classIds : [-1]).orderBy('title').all() : await db.table('classes').where('is_active', 1).orderBy('title').all();
  res.render(v('missing'), { title: 'جلسات ثبت‌نشده', from: J.toJalali(from), to: J.toJalali(to), sessions, missing, teacherRows, teachers, classes, f: { teacher_id: req.query.teacher_id || '', class_id: req.query.class_id || '' }, isTeacher: !!tc });
});

module.exports = router;
