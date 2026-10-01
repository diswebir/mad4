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
const crud = require('../../core/crud');
const settings = require('../../core/settings');

const router = express.Router();
const v = (n) => path.join(__dirname, 'views', n + '.ejs');
router.use(auth.requireAuth);
// شناسهٔ معلم جاری (برای محدودسازی دسترسی)
router.use(async (req, res, next) => { if (req.user.role === 'teacher') { const t = await db.table('teachers').where('user_id', req.user.id).first(); req._teacherId = t ? t.id : -1; } next(); });

// ---------- داده‌های کمکی ----------
const optYears = async () => (await db.table('academic_years').orderBy('start_date', 'desc').all()).map((r) => ({ value: r.id, label: r.title + (r.is_current ? ' (جاری)' : '') }));
const optGrades = async () => (await db.table('grade_levels').orderBy('sort_order').all()).map((r) => ({ value: r.id, label: r.title }));
const optTeachers = async () => (await db.table('teachers as t').join('users as u', 'u.id', 't.user_id').where('t.status', 'active').orderBy('u.name').select('t.id', 'u.name').all()).map((r) => ({ value: r.id, label: r.name }));
const optRooms = async () => (await db.table('rooms').orderBy('title').all()).map((r) => ({ value: r.id, label: r.title }));
const optSubjects = async () => (await db.table('subjects as s').leftJoin('grade_levels as g', 'g.id', 's.grade_level_id').orderBy('g.sort_order').orderBy('s.title').select('s.id', 's.title', 'g.title as grade').all()).map((r) => ({ value: r.id, label: r.title + (r.grade ? ' — ' + r.grade : '') }));
const currentYearId = async () => { const y = await db.table('academic_years').where('is_current', 1).first(); return y ? y.id : null; };

// ---------- سال تحصیلی ----------
crud(router, {
  path: '/years', table: 'academic_years', title: 'سال تحصیلی', plural: 'سال‌های تحصیلی', icon: 'bi-calendar-range', feature: 'academic.years', orderBy: 'start_date', dir: 'desc',
  fields: [
    { name: 'title', label: 'عنوان', type: 'text', required: true, list: true, search: true, placeholder: 'مثال: ۱۴۰۵-۱۴۰۶' },
    { name: 'start_date', label: 'تاریخ شروع', type: 'date', required: true, list: true },
    { name: 'end_date', label: 'تاریخ پایان', type: 'date', required: true, list: true },
    { name: 'is_current', label: 'سال جاری', type: 'checkbox', list: true }
  ],
  validate: (val, d) => { if (d.start_date && d.end_date && d.end_date < d.start_date) val.custom(false, 'تاریخ پایان باید بعد از شروع باشد'); },
  afterSave: async (id, data) => { if (Number(data.is_current)) { await db.table('academic_years').where('id', '!=', id).update({ is_current: 0 }); await settings.set('current_year_id', id); } },
  beforeDelete: async (row) => (await db.exists('classes', { academic_year_id: row.id }) ? 'برای این سال کلاس تعریف شده است' : true),
  rowActions: (row) => (Number(row.is_current) ? [] : [{ post: '/academic/years/' + row.id + '/current', icon: 'bi-check2-circle', label: 'تعیین به‌عنوان سال جاری', confirm: `«${row.title}» سال جاری شود؟` }]),
  pageActions: () => [{ href: '/academic/terms', label: 'نوبت‌ها', icon: 'bi-calendar3-range', class: 'btn-outline-primary' }]
});
router.post('/years/:id/current', auth.requireRoleOrPermission(['admin'], 'academic.manage'), async (req, res) => {
  const y = await db.findById('academic_years', req.params.id);
  if (y) { await db.table('academic_years').update({ is_current: 0 }); await db.update('academic_years', { is_current: 1 }, { id: y.id }); await settings.set('current_year_id', y.id); await activity.log(req, 'update', 'academic_years', y.id, 'تغییر سال جاری به ' + y.title); req.flash('success', `سال «${y.title}» به‌عنوان سال جاری تنظیم شد.`); }
  res.redirect('/academic/years');
});

// ---------- نوبت‌ها ----------
crud(router, {
  path: '/terms', table: 'terms', alias: 't', title: 'نوبت', plural: 'نوبت‌های تحصیلی', icon: 'bi-calendar3-range', feature: 'academic.years', orderBy: 'start_date', breadcrumbs: [{ title: 'سال تحصیلی', href: '/academic/years' }],
  query: (q) => q.leftJoin('academic_years as y', 'y.id', 't.academic_year_id').select('t.*', 'y.title as year_title'),
  fields: [
    { name: 'academic_year_id', label: 'سال تحصیلی', type: 'select', required: true, options: optYears, list: true, filter: true, format: (v, r) => utils.escapeHtml(r.year_title || '') },
    { name: 'title', label: 'عنوان', type: 'text', required: true, list: true, placeholder: 'نوبت اول' },
    { name: 'number', label: 'شماره نوبت', type: 'number', required: true, min: 1, max: 4, list: true, col: 3 },
    { name: 'start_date', label: 'شروع', type: 'date', required: true, list: true },
    { name: 'end_date', label: 'پایان', type: 'date', required: true, list: true },
    { name: 'is_current', label: 'نوبت جاری', type: 'checkbox', list: true }
  ],
  defaults: async () => ({ academic_year_id: await currentYearId(), number: 1 }),
  afterSave: async (id, data) => { if (Number(data.is_current)) await db.table('terms').where('id', '!=', id).update({ is_current: 0 }); }
});

// ---------- پایه‌ها ----------
crud(router, {
  path: '/grade-levels', table: 'grade_levels', title: 'پایه تحصیلی', plural: 'پایه‌های تحصیلی', icon: 'bi-layers', feature: 'academic.grade_levels', orderBy: 'sort_order', viewRoles: ['admin'], permission: 'academic.manage', viewPermission: ['academic.manage', 'academic.schedule', 'students.view'],
  fields: [
    { name: 'title', label: 'عنوان', type: 'text', required: true, list: true, search: true, placeholder: 'پایه هفتم' },
    { name: 'stage', label: 'دوره', type: 'select', required: true, options: utils.STAGES, list: true, filter: true },
    { name: 'grading_type', label: 'نوع ارزشیابی', type: 'select', required: true, options: { numeric: 'نمره‌ای (۰ تا ۲۰)', descriptive: 'توصیفی (خیلی خوب تا نیاز به تلاش)' }, list: true, default: 'numeric' },
    { name: 'sort_order', label: 'ترتیب', type: 'number', required: true, min: 0, list: true, col: 3, default: 1 }
  ],
  beforeDelete: async (row) => (await db.exists('classes', { grade_level_id: row.id }) ? 'برای این پایه کلاس تعریف شده است' : true),
  listData: async (req, rows) => { const counts = await db.table('classes').select('grade_level_id', 'COUNT(*) as c').groupBy('grade_level_id').all(); const m = Object.fromEntries(counts.map((c) => [c.grade_level_id, c.c])); rows.forEach((r) => { r._classes = m[r.id] || 0; }); return {}; },
  rowActions: (row) => [{ href: '/academic/classes?f_grade_level_id=' + row.id, icon: 'bi-door-open', label: `کلاس‌ها (${J.toPersianDigits(row._classes || 0)})` }, { href: '/academic/subjects?f_grade_level_id=' + row.id, icon: 'bi-book', label: 'دروس این پایه' }]
});

// ---------- دروس ----------
crud(router, {
  path: '/subjects', table: 'subjects', alias: 's', title: 'درس', plural: 'دروس', icon: 'bi-book', feature: 'academic.subjects', orderBy: 'title', viewRoles: ['admin'], permission: 'academic.manage', viewPermission: ['academic.manage', 'academic.schedule', 'students.view'],
  query: (q) => q.leftJoin('grade_levels as g', 'g.id', 's.grade_level_id').select('s.*', 'g.title as grade_title'),
  fields: [
    { name: 'title', label: 'نام درس', type: 'text', required: true, list: true, search: true },
    { name: 'code', label: 'کد درس', type: 'en', list: true, search: true, col: 3 },
    { name: 'grade_level_id', label: 'پایه', type: 'select', options: optGrades, list: true, filter: true, format: (v, r) => utils.escapeHtml(r.grade_title || 'عمومی') },
    { name: 'weekly_hours', label: 'ساعت در هفته', type: 'number', min: 0, max: 20, list: true, col: 3, default: 2 },
    { name: 'is_active', label: 'فعال', type: 'checkbox', list: true, default: 1 }
  ],
  beforeDelete: async (row) => (await db.exists('class_subjects', { subject_id: row.id }) ? 'این درس به کلاس‌ها تخصیص داده شده است' : true)
});

// ---------- اتاق‌ها ----------
crud(router, {
  path: '/rooms', table: 'rooms', title: 'اتاق', plural: 'اتاق‌ها و فضاها', icon: 'bi-building', feature: 'academic.rooms', orderBy: 'title', viewRoles: ['admin'], permission: 'academic.manage', viewPermission: ['academic.manage', 'academic.schedule', 'students.view'],
  fields: [
    { name: 'title', label: 'عنوان', type: 'text', required: true, list: true, search: true, placeholder: 'کلاس ۱۰۱' },
    { name: 'type', label: 'نوع', type: 'select', required: true, options: { class: 'کلاس درس', lab: 'آزمایشگاه', workshop: 'کارگاه', hall: 'سالن', library: 'کتابخانه', gym: 'سالن ورزش' }, list: true, filter: true, default: 'class' },
    { name: 'capacity', label: 'ظرفیت', type: 'number', min: 0, list: true, col: 3, default: 30 },
    { name: 'floor', label: 'طبقه', type: 'text', list: true, col: 3 },
    { name: 'equipment', label: 'تجهیزات', type: 'textarea', rows: 2, col: 12 }
  ]
});

// ---------- کلاس‌ها ----------
const classAccess = async (req, classId) => {
  if (['admin', 'staff'].includes(req.user.role)) return true;
  if (req.user.role === 'teacher') {
    const t = await db.table('teachers').where('user_id', req.user.id).first();
    if (!t) return false;
    if (await db.exists('classes', { id: classId, teacher_id: t.id })) return true;
    return db.exists('class_subjects', { class_id: classId, teacher_id: t.id });
  }
  if (req.user.role === 'student' || req.user.role === 'parent') { const s = await people.studentOf(req); return !!(s && Number(s.class_id) === Number(classId)); }
  return false;
};

crud(router, {
  path: '/classes', table: 'classes', alias: 'c', title: 'کلاس', plural: 'کلاس‌ها', icon: 'bi-door-open', feature: 'academic.classes', orderBy: 'title', viewRoles: ['admin', 'teacher'], permission: 'academic.manage', viewPermission: ['academic.manage', 'academic.schedule', 'students.view'],
  query: (q, req) => {
    q.leftJoin('grade_levels as g', 'g.id', 'c.grade_level_id').leftJoin('academic_years as y', 'y.id', 'c.academic_year_id').leftJoin('teachers as t', 't.id', 'c.teacher_id').leftJoin('users as u', 'u.id', 't.user_id').leftJoin('rooms as r', 'r.id', 'c.room_id')
      .select('c.*', 'g.title as grade_title', 'y.title as year_title', 'u.name as teacher_name', 'r.title as room_title', '(SELECT COUNT(*) FROM students st WHERE st.class_id = c.id AND st.status = \'active\') as students_count');
    if (req && req.user.role === 'teacher' && req._teacherId) q.where((b) => b.where('c.teacher_id', req._teacherId).orWhereRaw('c.id IN (SELECT class_id FROM class_subjects WHERE teacher_id = ?)', [req._teacherId]));
    return q;
  },
  fields: [
    { name: 'title', label: 'نام کلاس', type: 'text', required: true, list: true, search: true, placeholder: 'هفتم الف', format: (v, r) => `<a href="/academic/classes/${r.id}" class="fw-semibold">${utils.escapeHtml(v)}</a>` },
    { name: 'grade_level_id', label: 'پایه', type: 'select', required: true, options: optGrades, list: true, filter: true, format: (v, r) => utils.escapeHtml(r.grade_title || '') },
    { name: 'academic_year_id', label: 'سال تحصیلی', type: 'select', required: true, options: optYears, filter: true, format: (v, r) => utils.escapeHtml(r.year_title || '') },
    { name: 'teacher_id', label: 'معلم راهنما (سرپرست)', type: 'select', options: optTeachers, list: true, format: (v, r) => (r.teacher_name ? `<a href="/teachers/${v}">${utils.escapeHtml(r.teacher_name)}</a>` : '<span class="text-muted">—</span>') },
    { name: 'room_id', label: 'اتاق', type: 'select', options: optRooms, format: (v, r) => utils.escapeHtml(r.room_title || '—') },
    { name: 'capacity', label: 'ظرفیت', type: 'number', min: 1, max: 60, default: 30, col: 3 },
    { name: 'shift', label: 'شیفت', type: 'select', options: { morning: 'صبح', afternoon: 'عصر' }, default: 'morning', col: 3, list: true, filter: true },
    { name: 'is_active', label: 'فعال', type: 'checkbox', default: 1, list: true },
    { name: 'students_count', label: 'دانش‌آموزان', type: 'number', virtual: true, hideInForm: true, list: true, format: (v, r) => `<span class="badge badge-soft-primary">${J.toPersianDigits(v || 0)} / ${J.toPersianDigits(r.capacity || 0)}</span>` }
  ],
  defaults: async () => ({ academic_year_id: await currentYearId(), capacity: 30 }),
  filterHook: async (q, req) => { /* teacher scope handled in query */ },
  beforeDelete: async (row) => (await db.exists('students', { class_id: row.id }) ? 'ابتدا دانش‌آموزان این کلاس را منتقل کنید' : true),
  afterDelete: async (row) => { await db.remove('class_subjects', { class_id: row.id }); await db.remove('schedule_slots', { class_id: row.id }); },
  rowActions: (row) => [{ href: '/academic/classes/' + row.id, icon: 'bi-eye', label: 'مشاهده' }, ...(modules.isEnabled('academic.schedule') ? [{ href: '/academic/schedule/class/' + row.id, icon: 'bi-table', label: 'برنامه هفتگی' }] : [])],
  pageActions: (req) => (req.user.role === 'admin' && modules.isEnabled('academic.promote') ? [{ href: '/academic/promote', label: 'ارتقای گروهی', icon: 'bi-arrow-up-right-square', class: 'btn-outline-primary' }] : [])
});


// صفحهٔ کلاس
router.get('/classes/:id', modules.requireEnabled('academic.classes'), async (req, res) => {
  const cls = await db.table('classes as c').leftJoin('grade_levels as g', 'g.id', 'c.grade_level_id').leftJoin('academic_years as y', 'y.id', 'c.academic_year_id').leftJoin('teachers as t', 't.id', 'c.teacher_id').leftJoin('users as u', 'u.id', 't.user_id').leftJoin('rooms as r', 'r.id', 'c.room_id')
    .select('c.*', 'g.title as grade_title', 'g.grading_type', 'y.title as year_title', 'u.name as teacher_name', 'u.phone as teacher_phone', 'u.avatar as teacher_avatar', 'r.title as room_title').where('c.id', req.params.id).first();
  if (!cls) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  if (!(await classAccess(req, cls.id))) return res.status(403).render('errors/403', { title: 'دسترسی غیرمجاز' });
  const students = await db.table('students').where('class_id', cls.id).orderBy('last_name').orderBy('first_name').all();
  const subjects = await db.table('class_subjects as cs').join('subjects as s', 's.id', 'cs.subject_id').leftJoin('teachers as t', 't.id', 'cs.teacher_id').leftJoin('users as u', 'u.id', 't.user_id')
    .select('cs.*', 's.title as subject_title', 's.code', 'u.name as teacher_name').where('cs.class_id', cls.id).orderBy('s.title').all();
  const stats = {};
  if (modules.isEnabled('academic.class_stats')) {
    stats.boys = students.filter((s) => s.gender === 'male').length; stats.girls = students.filter((s) => s.gender === 'female').length; stats.active = students.filter((s) => s.status === 'active').length;
    if (modules.isEnabled('attendance')) {
      const att = await db.table('attendance').select('status', 'COUNT(*) as c').where('class_id', cls.id).groupBy('status').all();
      const total = att.reduce((a, r) => a + Number(r.c), 0); const present = att.filter((r) => ['present', 'late'].includes(r.status)).reduce((a, r) => a + Number(r.c), 0);
      stats.attendanceRate = total ? Math.round((present / total) * 100) : null; stats.absences = (att.find((r) => r.status === 'absent') || {}).c || 0;
    }
    if (modules.isEnabled('exams')) {
      const g = await db.table('grades as gr').join('exams as e', 'e.id', 'gr.exam_id').select('AVG(gr.score * 20.0 / e.max_score) as avg', 'COUNT(DISTINCT e.id) as exams').where('e.class_id', cls.id).whereNotNull('gr.score').first();
      stats.avgScore = g && g.avg != null ? Math.round(g.avg * 100) / 100 : null; stats.exams = g ? g.exams : 0;
    }
  }
  const teachersOpts = req.user.role === 'admin' ? await optTeachers() : [];
  const subjectsOpts = req.user.role === 'admin' ? await optSubjects() : [];
  const schedule = modules.isEnabled('academic.schedule') ? await db.table('schedule_slots as ss').leftJoin('class_subjects as cs', 'cs.id', 'ss.class_subject_id').leftJoin('subjects as s', 's.id', 'cs.subject_id').select('ss.*', 's.title as subject_title').where('ss.class_id', cls.id).orderBy('ss.day_of_week').orderBy('ss.period').all() : [];
  const studentExtra = {};
  if (students.length && modules.isEnabled('attendance')) {
    const abs = await db.table('attendance').select('student_id', 'COUNT(*) as c').where('class_id', cls.id).where('status', 'absent').groupBy('student_id').all();
    abs.forEach((a) => { studentExtra[a.student_id] = { absent: a.c }; });
  }
  res.render(v('class'), { title: 'کلاس ' + cls.title, cls, students, subjects, stats, teachersOpts, subjectsOpts, schedule, studentExtra, isAdmin: req.user.role === 'admin' });
});

// تخصیص درس و معلم به کلاس
router.post('/classes/:id/subjects', auth.requireRoleOrPermission(['admin'], 'academic.manage'), modules.requireEnabled('academic.class_subjects'), async (req, res) => {
  const cls = await db.findById('classes', req.params.id);
  if (!cls) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const subject_id = Number(req.body.subject_id), teacher_id = req.body.teacher_id ? Number(req.body.teacher_id) : null;
  if (!subject_id) { req.flash('danger', 'درس را انتخاب کنید'); return res.redirect(`/academic/classes/${cls.id}#subjects`); }
  const existing = await db.table('class_subjects').where({ class_id: cls.id, subject_id }).first();
  const subj = await db.findById('subjects', subject_id);
  const data = { teacher_id, weekly_hours: req.body.weekly_hours ? Number(J.toEnglishDigits(req.body.weekly_hours)) : (subj ? subj.weekly_hours : 2) };
  if (existing) await db.update('class_subjects', data, { id: existing.id });
  else await db.insert('class_subjects', Object.assign({ class_id: cls.id, subject_id, created_at: db.now() }, data));
  await activity.log(req, 'update', 'class_subjects', cls.id, `تخصیص درس ${subj ? subj.title : subject_id} به کلاس ${cls.title}`);
  req.flash('success', 'تخصیص درس ذخیره شد.');
  res.redirect(`/academic/classes/${cls.id}#subjects`);
});
router.post('/classes/:id/subjects/:csId/delete', auth.requireRoleOrPermission(['admin'], 'academic.manage'), modules.requireEnabled('academic.class_subjects'), async (req, res) => {
  const cs = await db.table('class_subjects').where({ id: req.params.csId, class_id: req.params.id }).first();
  if (cs) {
    if (await db.exists('exams', { class_subject_id: cs.id })) { req.flash('danger', 'برای این درس آزمون ثبت شده و قابل حذف نیست'); return res.redirect(`/academic/classes/${req.params.id}#subjects`); }
    await db.remove('schedule_slots', { class_subject_id: cs.id });
    await db.remove('class_subjects', { id: cs.id });
    req.flash('success', 'درس از کلاس حذف شد.');
  }
  res.redirect(`/academic/classes/${req.params.id}#subjects`);
});

// ---------- برنامه هفتگی ----------
const PERIODS = () => Math.min(12, Math.max(1, settings.getInt('weekly_periods', 4)));
const periodTimes = () => { const t = settings.getList('period_times'); return t.length ? t : ['07:45-08:30', '08:40-09:25', '09:45-10:30', '10:40-11:25', '11:35-12:20', '12:30-13:15']; };
const SCHOOL_DAYS = () => { const d = settings.getList('school_days'); const n = d.map(Number).filter((x) => x >= 0 && x <= 6); return n.length ? n : [0, 1, 2, 3, 4]; };

function buildGrid(slots) {
  const grid = {};
  for (const s of slots) { grid[s.day_of_week] = grid[s.day_of_week] || {}; grid[s.day_of_week][s.period] = s; }
  return grid;
}

router.get('/schedule', modules.requireEnabled('academic.schedule'), async (req, res) => {
  if (req.user.role === 'student' || req.user.role === 'parent') { const s = await people.studentOf(req); return s && s.class_id ? res.redirect('/academic/schedule/class/' + s.class_id) : res.render('errors/404', { title: 'کلاس تعریف نشده' }); }
  if (req.user.role === 'teacher') return res.redirect('/academic/schedule/teacher/' + req._teacherId);
  const yearId = await currentYearId();
  const classes = await db.table('classes as c').leftJoin('grade_levels as g', 'g.id', 'c.grade_level_id').select('c.*', 'g.title as grade_title', '(SELECT COUNT(*) FROM schedule_slots ss WHERE ss.class_id = c.id) as slots').where('c.is_active', 1).where((b) => (yearId ? b.where('c.academic_year_id', yearId) : b)).orderBy('g.sort_order').orderBy('c.title').all();
  const teachers = await db.table('teachers as t').join('users as u', 'u.id', 't.user_id').select('t.id', 'u.name', '(SELECT COUNT(*) FROM schedule_slots ss JOIN class_subjects cs ON cs.id = ss.class_subject_id WHERE cs.teacher_id = t.id) as slots').where('t.status', 'active').orderBy('u.name').all();
  res.render(v('schedule-index'), { title: 'برنامه هفتگی', classes, teachers });
});

router.get('/schedule/class/:id', modules.requireEnabled('academic.schedule'), async (req, res) => {
  const cls = await db.table('classes as c').leftJoin('grade_levels as g', 'g.id', 'c.grade_level_id').select('c.*', 'g.title as grade_title').where('c.id', req.params.id).first();
  if (!cls) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  if (!(await classAccess(req, cls.id))) return res.status(403).render('errors/403', { title: 'دسترسی غیرمجاز' });
  const slots = await db.table('schedule_slots as ss').leftJoin('class_subjects as cs', 'cs.id', 'ss.class_subject_id').leftJoin('subjects as s', 's.id', 'cs.subject_id').leftJoin('teachers as t', 't.id', 'cs.teacher_id').leftJoin('users as u', 'u.id', 't.user_id').leftJoin('rooms as r', 'r.id', 'ss.room_id')
    .select('ss.*', 's.title as subject_title', 'u.name as teacher_name', 'r.title as room_title').where('ss.class_id', cls.id).all();
  const classSubjects = req.user.role === 'admin' ? await db.table('class_subjects as cs').join('subjects as s', 's.id', 'cs.subject_id').leftJoin('teachers as t', 't.id', 'cs.teacher_id').leftJoin('users as u', 'u.id', 't.user_id').select('cs.id', 's.title', 'u.name as teacher_name').where('cs.class_id', cls.id).orderBy('s.title').all() : [];
  const print = req.query.print === '1' && modules.isEnabled('academic.schedule_print');
  res.render(v('schedule-class'), { title: 'برنامه هفتگی ' + cls.title, layout: print ? 'layouts/print' : undefined, print, cls, grid: buildGrid(slots), periods: PERIODS(), times: periodTimes(), days: SCHOOL_DAYS(), classSubjects, rooms: req.user.role === 'admin' ? await db.table('rooms').orderBy('title').all() : [], isAdmin: req.user.role === 'admin' });
});

router.get('/schedule/teacher/:id', modules.requireEnabled('academic.schedule'), async (req, res) => {
  const teacher = await db.table('teachers as t').join('users as u', 'u.id', 't.user_id').select('t.*', 'u.name').where('t.id', req.params.id).first();
  if (!teacher) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  if (req.user.role === 'teacher' && teacher.id !== req._teacherId) return res.status(403).render('errors/403', { title: 'دسترسی غیرمجاز' });
  if (req.user.role === 'student' || req.user.role === 'parent') return res.status(403).render('errors/403', { title: 'دسترسی غیرمجاز' });
  const slots = await db.table('schedule_slots as ss').join('class_subjects as cs', 'cs.id', 'ss.class_subject_id').join('subjects as s', 's.id', 'cs.subject_id').join('classes as c', 'c.id', 'ss.class_id').leftJoin('rooms as r', 'r.id', 'ss.room_id')
    .select('ss.*', 's.title as subject_title', 'c.title as class_title', 'r.title as room_title').where('cs.teacher_id', teacher.id).all();
  const print = req.query.print === '1' && modules.isEnabled('academic.schedule_print');
  res.render(v('schedule-teacher'), { title: 'برنامه هفتگی ' + teacher.name, layout: print ? 'layouts/print' : undefined, print, teacher, grid: buildGrid(slots), periods: PERIODS(), times: periodTimes(), days: SCHOOL_DAYS(), totalHours: slots.length });
});

router.post('/schedule/class/:id/slot', auth.requireRoleOrPermission(['admin'], 'academic.schedule'), modules.requireEnabled('academic.schedule'), async (req, res) => {
  const cls = await db.findById('classes', req.params.id);
  if (!cls) return res.status(404).json({ ok: false, message: 'کلاس یافت نشد' });
  const day = Number(req.body.day), period = Number(req.body.period), csId = req.body.class_subject_id ? Number(req.body.class_subject_id) : null, roomId = req.body.room_id ? Number(req.body.room_id) : null;
  const wantsJson = req.is('json') || (req.get('accept') || '').includes('json');
  const back = `/academic/schedule/class/${cls.id}`;
  const fail = (m) => (wantsJson ? res.status(400).json({ ok: false, message: m }) : (req.flash('danger', m), res.redirect(back)));
  if (!(day >= 0 && day <= 6) || !(period >= 1 && period <= 12)) return fail('روز/زنگ نامعتبر');
  const existing = await db.table('schedule_slots').where({ class_id: cls.id, day_of_week: day, period }).first();
  if (!csId) { if (existing) await db.remove('schedule_slots', { id: existing.id }); return wantsJson ? res.json({ ok: true, cleared: true }) : res.redirect(back); }
  const cs = await db.table('class_subjects as cs').join('subjects as s', 's.id', 'cs.subject_id').leftJoin('teachers as t', 't.id', 'cs.teacher_id').leftJoin('users as u', 'u.id', 't.user_id').select('cs.*', 's.title as subject_title', 'u.name as teacher_name').where('cs.id', csId).where('cs.class_id', cls.id).first();
  if (!cs) return fail('درس یافت نشد');
  // تداخل معلم
  if (cs.teacher_id) {
    const conflict = await db.table('schedule_slots as ss').join('class_subjects as c2', 'c2.id', 'ss.class_subject_id').join('classes as c', 'c.id', 'ss.class_id').select('c.title').where('c2.teacher_id', cs.teacher_id).where('ss.day_of_week', day).where('ss.period', period).where('ss.class_id', '!=', cls.id).first();
    if (conflict) return fail(`تداخل: ${cs.teacher_name} در این زنگ در کلاس «${conflict.title}» درس دارد`);
  }
  const times = periodTimes()[period - 1] || '';
  const [start_time, end_time] = times.split('-');
  const data = { class_subject_id: cs.id, room_id: roomId, start_time: start_time || null, end_time: end_time || null };
  if (existing) await db.update('schedule_slots', data, { id: existing.id }); else await db.insert('schedule_slots', Object.assign({ class_id: cls.id, day_of_week: day, period, created_at: db.now() }, data));
  await activity.log(req, 'update', 'schedule_slots', cls.id, `برنامه ${cls.title}: ${J.WEEKDAYS[day]} زنگ ${period} → ${cs.subject_title}`);
  if (wantsJson) return res.json({ ok: true, slot: { subject_title: cs.subject_title, teacher_name: cs.teacher_name } });
  req.flash('success', 'برنامه ذخیره شد.'); res.redirect(back);
});
router.post('/schedule/class/:id/clear', auth.requireRoleOrPermission(['admin'], 'academic.schedule'), modules.requireEnabled('academic.schedule'), async (req, res) => {
  await db.remove('schedule_slots', { class_id: req.params.id });
  req.flash('success', 'برنامهٔ کلاس پاک شد.'); res.redirect(`/academic/schedule/class/${req.params.id}`);
});
router.post('/schedule/class/:id/copy', auth.requireRoleOrPermission(['admin'], 'academic.schedule'), modules.requireEnabled('academic.schedule'), async (req, res) => {
  // کپی برنامه از کلاس دیگر (فقط دروس هم‌نام)
  const src = Number(req.body.source_id); const dst = Number(req.params.id);
  const srcSlots = await db.table('schedule_slots as ss').join('class_subjects as cs', 'cs.id', 'ss.class_subject_id').select('ss.*', 'cs.subject_id').where('ss.class_id', src).all();
  const dstCs = await db.table('class_subjects').where('class_id', dst).all();
  const map = Object.fromEntries(dstCs.map((c) => [c.subject_id, c.id]));
  await db.remove('schedule_slots', { class_id: dst });
  let n = 0;
  for (const s of srcSlots) if (map[s.subject_id]) { await db.insert('schedule_slots', { class_id: dst, class_subject_id: map[s.subject_id], day_of_week: s.day_of_week, period: s.period, start_time: s.start_time, end_time: s.end_time, room_id: null, created_at: db.now() }); n++; }
  req.flash('success', `${J.toPersianDigits(n)} زنگ کپی شد.`); res.redirect(`/academic/schedule/class/${dst}`);
});

// ---------- ارتقای گروهی ----------
router.get('/promote', auth.requireRoleOrPermission(['admin'], 'academic.manage'), modules.requireEnabled('academic.promote'), async (req, res) => {
  const classes = await db.table('classes as c').leftJoin('grade_levels as g', 'g.id', 'c.grade_level_id').leftJoin('academic_years as y', 'y.id', 'c.academic_year_id').select('c.id', 'c.title', 'g.title as grade_title', 'y.title as year_title', '(SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.status = \'active\') as cnt').orderBy('y.start_date', 'desc').orderBy('g.sort_order').all();
  res.render(v('promote'), { title: 'ارتقای گروهی دانش‌آموزان', classes });
});
router.post('/promote', auth.requireRoleOrPermission(['admin'], 'academic.manage'), modules.requireEnabled('academic.promote'), async (req, res) => {
  const from = Number(req.body.from_class), to = Number(req.body.to_class);
  if (!from || !to || from === to) { req.flash('danger', 'کلاس مبدأ و مقصد را به‌درستی انتخاب کنید'); return res.redirect('/academic/promote'); }
  const target = await db.findById('classes', to);
  const ids = (req.body.student_ids ? (Array.isArray(req.body.student_ids) ? req.body.student_ids : [req.body.student_ids]) : []).map(Number).filter(Boolean);
  let q = db.table('students').where('class_id', from).where('status', 'active');
  if (ids.length) q = q.whereIn('id', ids);
  const students = await q.all();
  for (const s of students) {
    await db.update('students', { class_id: to, grade_level_id: target.grade_level_id, updated_at: db.now() }, { id: s.id });
    await db.insert('student_transfers', { student_id: s.id, from_class_id: from, to_class_id: to, reason: req.body.reason || 'ارتقای گروهی', transferred_by: req.user.id, created_at: db.now() });
  }
  await activity.log(req, 'promote', 'classes', to, `ارتقای ${students.length} دانش‌آموز به ${target.title}`);
  req.flash('success', `${J.toPersianDigits(students.length)} دانش‌آموز به کلاس «${target.title}» منتقل شدند.`);
  res.redirect('/academic/classes/' + to);
});
router.get('/api/classes', auth.requireRoleOrPermission(['admin', 'teacher', 'staff']), async (req, res) => {
  const yearId = await currentYearId();
  res.json(await db.table('classes as c').leftJoin('grade_levels as g', 'g.id', 'c.grade_level_id').select('c.id', 'c.title', 'c.grade_level_id', 'g.title as grade_title').where('c.is_active', 1).where((b) => (yearId ? b.where('c.academic_year_id', yearId) : b)).orderBy('g.sort_order').orderBy('c.title').all());
});
router.get('/promote/students/:classId', auth.requireRoleOrPermission(['admin'], 'academic.manage'), async (req, res) => {
  res.json(await db.table('students').select('id', 'first_name', 'last_name', 'student_number').where('class_id', req.params.classId).where('status', 'active').orderBy('last_name').all());
});

module.exports = router;
