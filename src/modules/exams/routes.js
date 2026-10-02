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
const notify = require('../../core/notify');

const router = express.Router();
const v = (n) => path.join(__dirname, 'views', n + '.ejs');
router.use(auth.requireAuth);
const E = modules.isEnabled;

const TYPES = { quiz: 'کوئیز', classwork: 'فعالیت کلاسی', oral: 'پرسش شفاهی', practical: 'عملی', midterm: 'میان‌ترم', written: 'کتبی', final: 'پایان‌ترم', project: 'پروژه' };
const isStaff = (req) => req.user.role === 'admin' || req.can('exams.manage_all');
const isViewer = (req) => req.user.role === 'admin' || req.can('exams.view_all', 'exams.manage_all');

// ---------- کمکی ----------
async function teacherCtx(req) {
  if (req.user.role !== 'teacher') return null;
  const t = await db.table('teachers').where('user_id', req.user.id).first();
  if (!t) return { id: -1, csIds: [], classIds: [], homeroom: [] };
  const cs = await db.table('class_subjects').select('id', 'class_id').where('teacher_id', t.id).all();
  const homeroom = await db.table('classes').where('teacher_id', t.id).pluck('id');
  return { id: t.id, csIds: cs.map((x) => x.id), classIds: [...new Set(cs.map((x) => x.class_id).concat(homeroom))], homeroom };
}
async function studentCtx(req) { if (req.user.role !== 'student' && req.user.role !== 'parent') return null; return people.studentOf(req); }
async function currentTerm() { return (await db.table('terms').where('is_current', 1).first()) || (await db.table('terms').orderBy('id', 'desc').first()); }
async function terms() { return db.table('terms as t').join('academic_years as y', 'y.id', 't.academic_year_id').select('t.*', 'y.title as year_title').orderBy('t.id', 'desc').all(); }
async function classesFor(req) {
  const q = db.table('classes as c').leftJoin('grade_levels as g', 'g.id', 'c.grade_level_id').select('c.*', 'g.title as grade_title', 'g.grading_type').where('c.is_active', 1).orderBy('g.sort_order').orderBy('c.title');
  const tc = await teacherCtx(req);
  if (tc) q.whereIn('c.id', tc.classIds);
  return q.all();
}
async function classSubjectsFor(req, classId) {
  const q = db.table('class_subjects as cs').join('subjects as s', 's.id', 'cs.subject_id').leftJoin('teachers as t', 't.id', 'cs.teacher_id').leftJoin('users as u', 'u.id', 't.user_id').select('cs.*', 's.title as subject_title', 'u.name as teacher_name').orderBy('s.title');
  if (classId) q.where('cs.class_id', classId);
  const tc = await teacherCtx(req);
  if (tc) q.where((b) => { b.whereIn('cs.id', tc.csIds); if (tc.homeroom.length) b.orWhereIn('cs.class_id', tc.homeroom); });
  return q.all();
}
// ---------- قفل نمرات نوبت ----------
const canUnlock = (req) => req.user.role === 'admin' || req.can('exams.lock');
async function termOfExam(exam) {
  if (exam.term_id) return db.findById('terms', exam.term_id);
  if (exam.date) return db.table('terms').where('start_date', '<=', exam.date).where('end_date', '>=', exam.date).orderBy('id', 'desc').first();
  return null;
}
/** وضعیت قفل برای یک آزمون: { locked, term } — وقتی قابلیت غیرفعال باشد همیشه باز است */
async function lockInfo(exam) {
  if (!E('exams.lock')) return { locked: false, term: null };
  const term = await termOfExam(exam);
  return { locked: !!(term && Number(term.is_locked)), term };
}
function lockedResponse(res, term) {
  return res.status(403).render('errors/403', { title: 'نمرات نهایی شده', message: `نمرات «${term ? term.title : 'این نوبت'}» نهایی و قفل شده است. تغییر فقط توسط مدیر (با ثبت دلیل) امکان‌پذیر است.` });
}
async function logGradeChange(tx, req, exam, sid, gradeId, prev, next, reason) {
  if (!E('exams.history')) return;
  await tx.insert('grade_changes', { grade_id: gradeId || null, exam_id: exam.id, student_id: sid, old_score: prev ? prev.score : null, new_score: next ? next.score : null, old_descriptive: prev ? prev.descriptive : null, new_descriptive: next ? next.descriptive : null, reason: reason || null, changed_by: req.user.id, created_at: db.now() });
}

function baseQuery() {
  return db.table('exams as e').join('classes as c', 'c.id', 'e.class_id').join('subjects as s', 's.id', 'e.subject_id').leftJoin('terms as t', 't.id', 'e.term_id').leftJoin('users as u', 'u.id', 'e.created_by')
    .select('e.*', 'c.title as class_title', 's.title as subject_title', 't.title as term_title', 'u.name as creator_name', '(SELECT COUNT(*) FROM grades g WHERE g.exam_id = e.id AND (g.score IS NOT NULL OR g.descriptive IS NOT NULL)) as graded_count', '(SELECT COUNT(*) FROM students st WHERE st.class_id = e.class_id AND st.status = \'active\') as students_count', '(SELECT AVG(g.score) FROM grades g WHERE g.exam_id = e.id) as avg_score');
}
async function canManageExam(req, exam) {
  if (isStaff(req)) return true;
  const tc = await teacherCtx(req);
  return !!tc && (tc.csIds.includes(exam.class_subject_id) || tc.homeroom.includes(exam.class_id));
}
async function canViewClass(req, classId) {
  if (isViewer(req)) return true;
  const tc = await teacherCtx(req); if (tc) return tc.classIds.includes(Number(classId));
  const s = await studentCtx(req); return !!s && s.class_id === Number(classId);
}
const { to20, computeClassGrades } = require('./service');

// ---------- فهرست آزمون‌ها ----------
router.get('/', async (req, res) => {
  if (req.user.role === 'student' || req.user.role === 'parent') return res.redirect('/exams/my');
  const classes = await classesFor(req);
  const tc = await teacherCtx(req);
  const f = { class_id: req.query.class_id || '', term_id: req.query.term_id || '', type: req.query.type || '', q: utils.normalizePersian(req.query.q || ''), status: req.query.status || '' };
  const q = baseQuery();
  if (tc) q.where((b) => { b.whereIn('e.class_subject_id', tc.csIds); if (tc.homeroom.length) b.orWhereIn('e.class_id', tc.homeroom); });
  if (f.class_id) q.where('e.class_id', f.class_id);
  if (f.term_id) q.where('e.term_id', f.term_id);
  if (f.type) q.where('e.type', f.type);
  if (f.status === 'upcoming') q.where('e.date', '>=', J.todayISO());
  if (f.status === 'ungraded') q.whereRaw('(SELECT COUNT(*) FROM grades g WHERE g.exam_id = e.id) = 0');
  if (f.status === 'unpublished') q.where('e.is_published', 0);
  if (f.q) q.search(f.q, ['e.title', 's.title', 'c.title']);
  const result = await q.orderBy('e.date', 'desc').orderBy('e.id', 'desc').paginate(req.query.page, settings.getInt('items_per_page', 20));
  const upcoming = await (tc ? baseQuery().where((b) => { b.whereIn('e.class_subject_id', tc.csIds); if (tc.homeroom.length) b.orWhereIn('e.class_id', tc.homeroom); }) : baseQuery()).where('e.date', '>=', J.todayISO()).orderBy('e.date').limit(5).all();
  res.render(v('index'), { title: 'آزمون‌ها و نمرات', result, classes, terms: await terms(), f, TYPES, upcoming, query: req.query, isStaff: isStaff(req) });
});

// ---------- پنل دانش‌آموز ----------
router.get('/my', auth.requireRole('student', 'parent'), modules.requireEnabled('exams.student_view'), async (req, res) => {
  const s = await studentCtx(req);
  if (!s) return res.render('errors/404', { title: 'پرونده یافت نشد' });
  const termId = req.query.term_id || ((await currentTerm()) || {}).id;
  const q = db.table('grades as g').join('exams as e', 'e.id', 'g.exam_id').join('subjects as s', 's.id', 'e.subject_id').select('g.*', 'e.title', 'e.type', 'e.date', 'e.max_score', 'e.weight', 'e.term_id', 's.title as subject_title', '(SELECT AVG(g2.score) FROM grades g2 WHERE g2.exam_id = e.id) as class_avg').where('g.student_id', s.id).orderBy('e.date', 'desc');
  if (E('exams.publish')) q.where('e.is_published', 1);
  if (termId) q.where('e.term_id', termId);
  const grades = await q.all();
  const bySubject = utils.groupBy(grades, 'subject_title');
  const report = s.class_id && E('exams.gpa') ? await computeClassGrades(s.class_id, termId, { publishedOnly: E('exams.publish') }) : null;
  const mine = report ? report.rows.find((r) => r.student.id === s.id) : null;
  const upcoming = s.class_id && E('exams.schedule') ? await baseQuery().where('e.class_id', s.class_id).where('e.date', '>=', J.todayISO()).orderBy('e.date').limit(8).all() : [];
  res.render(v('my'), { title: 'نمرات من', s, grades, bySubject, mine, report, upcoming, termId, terms: await terms(), TYPES, to20 });
});

// ---------- برنامهٔ آزمون‌ها ----------
router.get('/schedule', modules.requireEnabled('exams.schedule'), async (req, res) => {
  const q = baseQuery().where('e.date', '>=', J.addDays(J.todayISO(), -7)).orderBy('e.date').orderBy('e.start_time');
  const tc = await teacherCtx(req); const s = await studentCtx(req);
  if (tc) q.whereIn('e.class_id', tc.classIds);
  if (s) { if (!s.class_id) return res.render(v('schedule'), { title: 'برنامهٔ آزمون‌ها', days: [], classes: [] }); q.where('e.class_id', s.class_id); }
  if (req.query.class_id) q.where('e.class_id', req.query.class_id);
  const rows = await q.limit(300).all();
  const days = Object.entries(utils.groupBy(rows, 'date')).map(([date, exams]) => ({ date, exams }));
  res.render(v('schedule'), { title: 'برنامهٔ آزمون‌ها', days, classes: s ? [] : await classesFor(req), classId: req.query.class_id || '', TYPES });
});

// ---------- تحلیل ----------
router.get('/analytics', auth.requireRoleOrPermission(['admin', 'teacher'], 'exams.view_all', 'exams.manage_all'), modules.requireEnabled('exams.analytics'), async (req, res) => {
  const classes = await classesFor(req);
  const classId = Number(req.query.class_id) || (classes[0] && classes[0].id);
  const termId = req.query.term_id || ((await currentTerm()) || {}).id;
  if (!classId || !(await canViewClass(req, classId))) return res.status(403).render('errors/403', { title: 'غیرمجاز' });
  const report = await computeClassGrades(classId, termId);
  // توزیع معدل‌ها
  const buckets = [0, 0, 0, 0, 0]; // <10, 10-12, 12-15, 15-18, 18-20
  report.rows.forEach((r) => { if (r.gpa == null) return; buckets[r.gpa < 10 ? 0 : r.gpa < 12 ? 1 : r.gpa < 15 ? 2 : r.gpa < 18 ? 3 : 4]++; });
  // مقایسهٔ کلاس‌ها (همان پایه)
  const cls = await db.findById('classes', classId);
  const siblings = await db.table('classes').where('grade_level_id', cls.grade_level_id).where('is_active', 1).all();
  const compare = [];
  for (const c of siblings) { if (!isViewer(req) && !(await canViewClass(req, c.id))) continue; const r = c.id === classId ? report : await computeClassGrades(c.id, termId); compare.push({ title: c.title, avg: r.classAvg }); }
  const pass = settings.getInt('grading_pass_score', 10);
  const failing = report.rows.filter((r) => Object.values(r.per).some((p) => p.val != null && p.val < pass)).map((r) => ({ student: r.student, subjects: report.subjects.filter((sb) => r.per[sb.subject_id].val != null && r.per[sb.subject_id].val < pass).map((sb) => sb.title + ' (' + J.toPersianDigits(r.per[sb.subject_id].val) + ')') }));
  const top = report.rows.filter((r) => r.rank && r.rank <= 5).sort((a, b) => a.rank - b.rank);
  res.render(v('analytics'), { title: 'تحلیل نمرات', classes, classId, termId, terms: await terms(), report, buckets, compare, failing, top, pass });
});

// ---------- کارنامه ----------
router.get('/report-card/:studentId', modules.requireEnabled('exams.report_card'), async (req, res) => {
  const s = await db.table('students as s').leftJoin('classes as c', 'c.id', 's.class_id').leftJoin('grade_levels as g', 'g.id', 's.grade_level_id').select('s.*', 'c.title as class_title', 'g.title as grade_title', 'g.grading_type').where('s.id', req.params.studentId).first();
  if (!s) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  if (req.user.role === 'student' || req.user.role === 'parent') { const me = await studentCtx(req); if (!me || me.id !== s.id || !E('exams.student_view')) return res.status(403).render('errors/403', { title: 'غیرمجاز' }); }
  else if (!(await canViewClass(req, s.class_id))) return res.status(403).render('errors/403', { title: 'غیرمجاز' });
  const allTerms = await terms();
  const termId = Number(req.query.term_id) || ((await currentTerm()) || {}).id;
  const term = allTerms.find((t) => t.id === termId) || null;
  const publishedOnly = (req.user.role === 'student' || req.user.role === 'parent') && E('exams.publish');
  const report = s.class_id ? await computeClassGrades(s.class_id, termId, { publishedOnly }) : { rows: [], subjects: [], subjectAvg: {} };
  const mine = report.rows.find((r) => r.student.id === s.id) || { per: {}, gpa: null, rank: null };
  const remark = E('exams.remarks') ? await db.table('term_remarks as r').leftJoin('users as u', 'u.id', 'r.author_id').select('r.*', 'u.name as author_name').where({ 'r.student_id': s.id, 'r.term_id': termId }).first() : null;
  let att = null;
  if (E('attendance') && term) { const rows = await db.table('attendance').select('status', 'COUNT(*) as c').where('student_id', s.id).where('session_key', 'daily').whereBetween('date', term.start_date, term.end_date).groupBy('status').all(); att = Object.fromEntries(rows.map((r) => [r.status, Number(r.c)])); }
  const discipline = E('discipline') ? await db.table('discipline_records').where('student_id', s.id).sum('points') : null;
  const homeroom = s.class_id ? await db.table('classes as c').leftJoin('teachers as t', 't.id', 'c.teacher_id').leftJoin('users as u', 'u.id', 't.user_id').select('u.name').where('c.id', s.class_id).first() : null;
  const canRemark = E('exams.remarks') && (isStaff(req) || ((await teacherCtx(req)) || { homeroom: [] }).homeroom.includes(s.class_id));
  const print = req.query.print === '1' && E('exams.print');
  res.render(v('report-card'), { title: 'کارنامه ' + s.first_name + ' ' + s.last_name, layout: print ? 'layouts/print' : undefined, print, s, term, termId, terms: allTerms, report, mine, remark, att, discipline, homeroom, canRemark, pass: settings.getInt('grading_pass_score', 10), total: report.rows.filter((r) => r.gpa != null).length });
});
router.post('/remarks/:studentId', auth.requireRoleOrPermission(['admin', 'teacher'], 'exams.view_all', 'exams.manage_all'), modules.requireEnabled('exams.remarks'), async (req, res) => {
  const s = await db.findById('students', req.params.studentId);
  const termId = Number(req.body.term_id);
  if (!s || !termId) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  if (!isStaff(req) && !((await teacherCtx(req)) || { homeroom: [] }).homeroom.includes(s.class_id)) return res.status(403).render('errors/403', { title: 'غیرمجاز' });
  const remark = utils.normalizePersian(req.body.remark || '').trim();
  const ex = await db.findOne('term_remarks', { student_id: s.id, term_id: termId });
  if (ex) await db.update('term_remarks', { remark, author_id: req.user.id }, { id: ex.id }); else await db.insert('term_remarks', { student_id: s.id, term_id: termId, remark, author_id: req.user.id, created_at: db.now() });
  req.flash('success', 'نظر معلم ذخیره شد.'); res.redirect(`/exams/report-card/${s.id}?term_id=${termId}`);
});

// ---------- ریزنمرات کلاس ----------
router.get('/class/:classId', auth.requireRoleOrPermission(['admin', 'teacher'], 'exams.view_all', 'exams.manage_all'), modules.requireEnabled('exams.class_sheet'), async (req, res) => {
  const cls = await db.table('classes as c').leftJoin('grade_levels as g', 'g.id', 'c.grade_level_id').select('c.*', 'g.title as grade_title', 'g.grading_type').where('c.id', req.params.classId).first();
  if (!cls) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  if (!(await canViewClass(req, cls.id))) return res.status(403).render('errors/403', { title: 'غیرمجاز' });
  const termId = Number(req.query.term_id) || ((await currentTerm()) || {}).id;
  const report = await computeClassGrades(cls.id, termId);
  if (req.query.export === '1' && E('exams.export')) {
    const cols = [{ label: 'شماره', value: (r) => r.student.student_number }, { label: 'نام', value: (r) => r.student.first_name + ' ' + r.student.last_name }];
    report.subjects.forEach((sb) => cols.push({ label: sb.title, value: (r) => (r.per[sb.subject_id].val != null ? r.per[sb.subject_id].val : (r.per[sb.subject_id].desc ? utils.DESCRIPTIVE_GRADES[r.per[sb.subject_id].desc] : '')) }));
    cols.push({ label: 'معدل', value: (r) => r.gpa != null ? r.gpa : '' }, { label: 'رتبه', value: (r) => r.rank || '' });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="grades-class-${cls.id}.csv"`);
    return res.send(utils.toCSV(report.rows, cols));
  }
  const print = req.query.print === '1';
  res.render(v('class-sheet'), { title: 'ریزنمرات ' + cls.title, layout: print ? 'layouts/print' : undefined, print, cls, termId, terms: await terms(), report, pass: settings.getInt('grading_pass_score', 10) });
});

// ---------- ایجاد / ویرایش ----------
async function examForm(req, res, exam) {
  const classes = await classesFor(req);
  const classId = Number((exam && exam.class_id) || req.query.class_id || (classes[0] && classes[0].id)) || null;
  const cs = await classSubjectsFor(req, classId);
  const allCs = await classSubjectsFor(req, null);
  res.render(v('form'), { title: exam ? 'ویرایش آزمون' : 'آزمون جدید', exam: exam || {}, classes, classId, cs, allCs, terms: await terms(), currentTermId: ((await currentTerm()) || {}).id, TYPES, prefill: { class_subject_id: req.query.class_subject_id || '' } });
}
router.get('/new', auth.requireRoleOrPermission(['admin', 'teacher'], 'exams.view_all', 'exams.manage_all'), modules.requireEnabled('exams.manage'), (req, res) => examForm(req, res, null));
async function saveExam(req, res, exam) {
  const b = utils.cleanBody(req.body, { fields: ['class_subject_id', 'term_id', 'title', 'type', 'date', 'start_time', 'max_score', 'weight', 'description'], dates: ['date'], numbers: ['max_score', 'weight'] });
  const back = exam ? `/exams/${exam.id}/edit` : '/exams/new' + (b.class_subject_id ? '?class_subject_id=' + b.class_subject_id : '');
  const cs = await db.table('class_subjects').where('id', b.class_subject_id).first();
  if (!cs || !b.title || !b.date) { req.flash('danger', 'درس، عنوان و تاریخ الزامی است'); req.keepInput(); return res.redirect(back); }
  if (!(await canManageExam(req, { class_subject_id: cs.id, class_id: cs.class_id }))) return res.status(403).render('errors/403', { title: 'غیرمجاز' });
  if (!canUnlock(req)) { const li = await lockInfo(exam || { term_id: b.term_id || null, date: b.date }); if (li.locked) return lockedResponse(res, li.term); }
  const data = { class_id: cs.class_id, subject_id: cs.subject_id, class_subject_id: cs.id, term_id: b.term_id || null, title: b.title, type: TYPES[b.type] ? b.type : 'quiz', date: b.date, start_time: b.start_time || null, max_score: b.max_score || settings.getInt('grading_max_score', 20), weight: b.weight || 1, description: b.description || null };
  if (exam) { await db.update('exams', data, { id: exam.id }); await activity.log(req, 'update', 'exams', exam.id, 'ویرایش آزمون ' + data.title); req.flash('success', 'آزمون ویرایش شد.'); return res.redirect('/exams/' + exam.id); }
  data.created_by = req.user.id; data.is_published = 0; data.created_at = db.now();
  const id = await db.insert('exams', data);
  await activity.log(req, 'create', 'exams', id, 'تعریف آزمون ' + data.title);
  if (E('exams.schedule') && E('notifications.inapp') && req.body.notify === '1') {
    const uids = await db.table('students').where('class_id', cs.class_id).where('status', 'active').whereNotNull('user_id').pluck('user_id');
    const subj = await db.findById('subjects', cs.subject_id);
    await notify.push(uids, { title: 'آزمون جدید', body: `${data.title} — ${subj ? subj.title : ''} در ${J.formatLong(data.date)}`, link: '/exams/schedule', type: 'info' });
  }
  req.flash('success', 'آزمون تعریف شد. اکنون می‌توانید نمرات را وارد کنید.');
  res.redirect('/exams/' + id);
}
router.post('/', auth.requireRoleOrPermission(['admin', 'teacher'], 'exams.view_all', 'exams.manage_all'), modules.requireEnabled('exams.manage'), (req, res) => saveExam(req, res, null));
router.get('/:id/edit', auth.requireRoleOrPermission(['admin', 'teacher'], 'exams.view_all', 'exams.manage_all'), modules.requireEnabled('exams.manage'), async (req, res) => {
  const exam = await db.findById('exams', req.params.id);
  if (!exam) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  if (!(await canManageExam(req, exam))) return res.status(403).render('errors/403', { title: 'غیرمجاز' });
  examForm(req, res, exam);
});
router.post('/:id', auth.requireRoleOrPermission(['admin', 'teacher'], 'exams.view_all', 'exams.manage_all'), modules.requireEnabled('exams.manage'), async (req, res) => {
  const exam = await db.findById('exams', req.params.id);
  if (!exam) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  if (!(await canManageExam(req, exam))) return res.status(403).render('errors/403', { title: 'غیرمجاز' });
  saveExam(req, res, exam);
});
router.post('/:id/delete', auth.requireRoleOrPermission(['admin', 'teacher'], 'exams.view_all', 'exams.manage_all'), modules.requireEnabled('exams.manage'), async (req, res) => {
  const exam = await db.findById('exams', req.params.id);
  if (!exam) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  if (!(await canManageExam(req, exam))) return res.status(403).render('errors/403', { title: 'غیرمجاز' });
  { const li = await lockInfo(exam); if (li.locked && !canUnlock(req)) return lockedResponse(res, li.term); }
  await db.remove('grades', { exam_id: exam.id }); await db.remove('exams', { id: exam.id });
  await activity.log(req, 'delete', 'exams', exam.id, 'حذف آزمون ' + exam.title);
  req.flash('success', 'آزمون و نمرات آن حذف شد.'); res.redirect('/exams');
});
router.post('/:id/publish', auth.requireRoleOrPermission(['admin', 'teacher'], 'exams.view_all', 'exams.manage_all'), modules.requireEnabled('exams.publish'), async (req, res) => {
  const exam = await baseQuery().where('e.id', req.params.id).first();
  if (!exam) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  if (!(await canManageExam(req, exam))) return res.status(403).render('errors/403', { title: 'غیرمجاز' });
  const val = exam.is_published ? 0 : 1;
  await db.update('exams', { is_published: val }, { id: exam.id });
  if (val && E('exams.notify') && E('notifications.inapp')) {
    const uids = await db.table('grades as g').join('students as s', 's.id', 'g.student_id').where('g.exam_id', exam.id).whereNotNull('s.user_id').pluck('s.user_id');
    await notify.push(uids, { title: 'نمرهٔ جدید', body: `نمرهٔ ${exam.title} (${exam.subject_title}) منتشر شد.`, link: '/exams/my', type: 'success' });
  }
  await activity.log(req, 'update', 'exams', exam.id, (val ? 'انتشار' : 'لغو انتشار') + ' نمرات ' + exam.title);
  req.flash('success', val ? 'نمرات منتشر شد.' : 'انتشار نمرات لغو شد.'); res.redirect('/exams/' + exam.id);
});

// ---------- برگهٔ نمره ----------
// ---------- تاریخچهٔ تغییر نمرات ----------
function changesQuery() {
  return db.table('grade_changes as gc').join('exams as e', 'e.id', 'gc.exam_id').join('students as s', 's.id', 'gc.student_id').join('subjects as sb', 'sb.id', 'e.subject_id').join('classes as c', 'c.id', 'e.class_id').leftJoin('users as u', 'u.id', 'gc.changed_by').leftJoin('terms as t', 't.id', 'e.term_id')
    .select('gc.*', 'e.title as exam_title', 'e.max_score', 'e.class_id', 'sb.title as subject_title', 'c.title as class_title', 's.first_name', 's.last_name', 's.student_number', 'u.name as changer_name', 't.title as term_title', 't.is_locked as term_locked');
}
router.get('/changes', auth.requireRoleOrPermission(['admin', 'teacher'], 'exams.view_all', 'exams.manage_all', 'exams.lock'), modules.requireEnabled('exams.history'), async (req, res) => {
  const f = { term_id: req.query.term_id || '', class_id: req.query.class_id || '', q: utils.normalizePersian(req.query.q || '').trim() };
  const q = changesQuery();
  const tc = await teacherCtx(req);
  if (tc) q.whereIn('e.class_id', tc.classIds.length ? tc.classIds : [-1]);
  if (f.term_id) q.where('e.term_id', f.term_id);
  if (f.class_id) q.where('e.class_id', f.class_id);
  if (f.q) q.where((b) => b.where('s.first_name', 'like', `%${f.q}%`).orWhere('s.last_name', 'like', `%${f.q}%`).orWhere('e.title', 'like', `%${f.q}%`).orWhere('gc.reason', 'like', `%${f.q}%`));
  const page = Math.max(1, parseInt(req.query.page, 10) || 1), per = 40;
  const total = await q.clone().count();
  const rows = await q.orderBy('gc.id', 'desc').limit(per).offset((page - 1) * per).all();
  res.render(v('changes'), { title: 'تاریخچهٔ تغییر نمرات', rows, total, page, pages: Math.max(1, Math.ceil(total / per)), f, terms: await terms(), classes: await classesFor(req) });
});
router.get('/:id/history', auth.requireRoleOrPermission(['admin', 'teacher'], 'exams.view_all', 'exams.manage_all', 'exams.lock'), modules.requireEnabled('exams.history'), async (req, res) => {
  const exam = await baseQuery().where('e.id', req.params.id).first();
  if (!exam) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  if (!(await canViewClass(req, exam.class_id))) return res.status(403).render('errors/403', { title: 'غیرمجاز' });
  const rows = await changesQuery().where('gc.exam_id', exam.id).orderBy('gc.id', 'desc').all();
  res.render(v('history'), { title: 'تاریخچهٔ نمرات — ' + exam.title, exam, rows, lock: await lockInfo(exam) });
});
router.get('/:id', auth.requireRoleOrPermission(['admin', 'teacher'], 'exams.view_all', 'exams.manage_all'), async (req, res) => {
  const exam = await baseQuery().where('e.id', req.params.id).first();
  if (!exam) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  if (!(await canViewClass(req, exam.class_id))) return res.status(403).render('errors/403', { title: 'غیرمجاز' });
  const canManage = await canManageExam(req, exam);
  const grade = await db.table('classes as c').join('grade_levels as g', 'g.id', 'c.grade_level_id').select('g.grading_type').where('c.id', exam.class_id).first();
  const descriptive = E('exams.descriptive') && grade && grade.grading_type === 'descriptive';
  const students = await db.table('students').select('id', 'first_name', 'last_name', 'student_number', 'photo').where('class_id', exam.class_id).where('status', 'active').orderBy('last_name').orderBy('first_name').all();
  const grades = utils.indexBy(await db.table('grades').where('exam_id', exam.id).all(), 'student_id');
  const scores = Object.values(grades).map((g) => g.score).filter((x) => x != null).map(Number);
  const stats = scores.length ? { n: scores.length, avg: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 100) / 100, max: Math.max(...scores), min: Math.min(...scores), pass: scores.filter((x) => to20(x, exam.max_score) >= settings.getInt('grading_pass_score', 10)).length } : null;
  const dist = [0, 0, 0, 0, 0];
  scores.forEach((x) => { const t = to20(x, exam.max_score); dist[t < 10 ? 0 : t < 12 ? 1 : t < 15 ? 2 : t < 18 ? 3 : 4]++; });
  const lock = await lockInfo(exam);
  const changesCount = E('exams.history') ? await db.table('grade_changes').where('exam_id', exam.id).count() : 0;
  res.render(v('show'), { title: exam.title, exam, students, grades, stats, dist, descriptive, canManage, TYPES, pass: settings.getInt('grading_pass_score', 10), lock, canUnlock: canUnlock(req), changesCount });
});
router.post('/:id/grades', auth.requireRoleOrPermission(['admin', 'teacher'], 'exams.view_all', 'exams.manage_all'), modules.requireEnabled('exams.grades'), async (req, res) => {
  const exam = await db.findById('exams', req.params.id);
  if (!exam) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  if (!(await canManageExam(req, exam))) return res.status(403).render('errors/403', { title: 'غیرمجاز' });
  const lock = await lockInfo(exam);
  const reason = utils.normalizePersian(req.body.change_reason || '').trim() || null;
  if (lock.locked) {
    if (!canUnlock(req)) return lockedResponse(res, lock.term);
    if (!reason) { req.flash('danger', 'برای تغییر نمرات نوبت نهایی‌شده، ثبت «دلیل تغییر» الزامی است.'); return res.redirect('/exams/' + exam.id); }
  }
  const students = await db.table('students').select('id').where('class_id', exam.class_id).pluck('id');
  const existing = utils.indexBy(await db.table('grades').where('exam_id', exam.id).all(), 'student_id');
  const now = db.now(); let saved = 0, errors = 0, changed = 0;
  const same = (a, b) => (a == null ? null : Number(a)) === (b == null ? null : Number(b));
  await db.transaction(async (tx) => {
    for (const sid of students) {
      const rawScore = J.toEnglishDigits(req.body['score_' + sid] || '').trim().replace('/', '.').replace('٫', '.');
      const desc = req.body['desc_' + sid] || '';
      const note = utils.normalizePersian(req.body['note_' + sid] || '').trim() || null;
      const absent = req.body['absent_' + sid] === '1';
      let score = rawScore === '' ? null : Number(rawScore);
      if (score != null && (Number.isNaN(score) || score < 0 || score > Number(exam.max_score))) { errors++; continue; }
      if (absent) score = null;
      const row = { score, descriptive: utils.DESCRIPTIVE_GRADES[desc] ? desc : null, note: absent ? (note ? 'غایب — ' + note : 'غایب') : note, graded_by: req.user.id, updated_at: now };
      const prev = existing[sid];
      if (score == null && !row.descriptive && !row.note) {
        if (prev) { if (prev.score != null || prev.descriptive) { await logGradeChange(tx, req, exam, sid, prev.id, prev, null, reason); changed++; } await tx.remove('grades', { id: prev.id }); }
        continue;
      }
      if (prev) {
        if (!same(prev.score, row.score) || (prev.descriptive || null) !== (row.descriptive || null)) { await logGradeChange(tx, req, exam, sid, prev.id, prev, row, reason); changed++; }
        await tx.update('grades', row, { id: prev.id });
      } else {
        const gid = await tx.insert('grades', Object.assign({ exam_id: exam.id, student_id: sid, created_at: now }, row));
        if (lock.locked) { await logGradeChange(tx, req, exam, sid, gid, null, row, reason); changed++; }
      }
      saved++;
    }
  });
  await activity.log(req, 'grade', 'exams', exam.id, `ثبت ${saved} نمره برای ${exam.title}` + (lock.locked ? ` (پس از قفل — ${changed} تغییر، دلیل: ${reason})` : ''));
  req.flash(errors ? 'warning' : 'success', `${J.toPersianDigits(saved)} نمره ذخیره شد.` + (errors ? ` ${J.toPersianDigits(errors)} مقدار نامعتبر (خارج از ۰ تا ${J.toPersianDigits(exam.max_score)}) نادیده گرفته شد.` : ''));
  res.redirect('/exams/' + exam.id);
});

router.get('/api/class-subjects/:classId', auth.requireRoleOrPermission(['admin', 'teacher'], 'exams.view_all', 'exams.manage_all'), async (req, res) => res.json(await classSubjectsFor(req, req.params.classId)));

module.exports = router;
module.exports.computeClassGrades = computeClassGrades;
module.exports.TYPES = TYPES;
