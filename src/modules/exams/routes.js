'use strict';
const path = require('path');
const express = require('express');
const db = require('../../core/db');
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
const isStaff = (req) => ['admin', 'staff'].includes(req.user.role);

// ---------- کمکی ----------
async function teacherCtx(req) {
  if (req.user.role !== 'teacher') return null;
  const t = await db.table('teachers').where('user_id', req.user.id).first();
  if (!t) return { id: -1, csIds: [], classIds: [], homeroom: [] };
  const cs = await db.table('class_subjects').select('id', 'class_id').where('teacher_id', t.id).all();
  const homeroom = await db.table('classes').where('teacher_id', t.id).pluck('id');
  return { id: t.id, csIds: cs.map((x) => x.id), classIds: [...new Set(cs.map((x) => x.class_id).concat(homeroom))], homeroom };
}
async function studentCtx(req) { if (req.user.role !== 'student') return null; return db.table('students').where('user_id', req.user.id).first(); }
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
  if (isStaff(req)) return true;
  const tc = await teacherCtx(req); if (tc) return tc.classIds.includes(Number(classId));
  const s = await studentCtx(req); return !!s && s.class_id === Number(classId);
}
const to20 = (score, max) => (score == null || !max ? null : Math.round(score / max * 20 * 100) / 100);

/** محاسبهٔ نمرات یک کلاس برای یک نوبت: به ازای هر دانش‌آموز و درس، میانگین وزنی (از ۲۰) */
async function computeClassGrades(classId, termId, { publishedOnly = false } = {}) {
  const students = await db.table('students').select('id', 'first_name', 'last_name', 'student_number', 'photo').where('class_id', classId).where('status', 'active').orderBy('last_name').orderBy('first_name').all();
  const subjects = await db.table('class_subjects as cs').join('subjects as s', 's.id', 'cs.subject_id').select('cs.id as cs_id', 's.id as subject_id', 's.title', 'cs.weekly_hours').where('cs.class_id', classId).orderBy('s.title').all();
  const eq = db.table('exams').where('class_id', classId);
  if (termId) eq.where('term_id', termId);
  if (publishedOnly) eq.where('is_published', 1);
  const exams = await eq.all();
  const examIds = exams.map((e) => e.id);
  const grades = examIds.length ? await db.table('grades').whereIn('exam_id', examIds).all() : [];
  const byExam = utils.indexBy(exams, 'id');
  const acc = {}; // sid -> subject_id -> {w, sum, n, desc[]}
  for (const g of grades) {
    const e = byExam[g.exam_id]; if (!e) continue;
    const a = (acc[g.student_id] = acc[g.student_id] || {}); const s = (a[e.subject_id] = a[e.subject_id] || { w: 0, sum: 0, n: 0, desc: [] });
    if (g.score != null && e.max_score) { const w = Number(e.weight) || 1; s.w += w; s.sum += to20(g.score, e.max_score) * w; s.n++; }
    if (g.descriptive) s.desc.push(Number(g.descriptive));
  }
  const rows = students.map((st) => {
    const per = {}; let tot = 0, cnt = 0;
    for (const sb of subjects) {
      const s = acc[st.id] && acc[st.id][sb.subject_id];
      let val = null, desc = null;
      if (s) { if (s.w) val = Math.round(s.sum / s.w * 100) / 100; if (s.desc.length) desc = Math.round(s.desc.reduce((x, y) => x + y, 0) / s.desc.length); }
      per[sb.subject_id] = { val, desc, n: s ? s.n : 0 };
      if (val != null) { tot += val; cnt++; }
    }
    return { student: st, per, gpa: cnt ? Math.round(tot / cnt * 100) / 100 : null, count: cnt };
  });
  const ranked = rows.filter((r) => r.gpa != null).sort((a, b) => b.gpa - a.gpa);
  ranked.forEach((r, i) => { r.rank = i > 0 && ranked[i - 1].gpa === r.gpa ? ranked[i - 1].rank : i + 1; });
  const subjectAvg = {};
  for (const sb of subjects) { const vals = rows.map((r) => r.per[sb.subject_id].val).filter((x) => x != null); subjectAvg[sb.subject_id] = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100) / 100 : null; }
  const gpas = rows.map((r) => r.gpa).filter((x) => x != null);
  return { students, subjects, rows, subjectAvg, classAvg: gpas.length ? Math.round(gpas.reduce((a, b) => a + b, 0) / gpas.length * 100) / 100 : null, examsCount: exams.length };
}

// ---------- فهرست آزمون‌ها ----------
router.get('/', async (req, res) => {
  if (req.user.role === 'student') return res.redirect('/exams/my');
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
router.get('/my', auth.requireRole('student'), modules.requireEnabled('exams.student_view'), async (req, res) => {
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
router.get('/analytics', auth.requireRole('admin', 'staff', 'teacher'), modules.requireEnabled('exams.analytics'), async (req, res) => {
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
  for (const c of siblings) { if (!isStaff(req) && !(await canViewClass(req, c.id))) continue; const r = c.id === classId ? report : await computeClassGrades(c.id, termId); compare.push({ title: c.title, avg: r.classAvg }); }
  const pass = settings.getInt('grading_pass_score', 10);
  const failing = report.rows.filter((r) => Object.values(r.per).some((p) => p.val != null && p.val < pass)).map((r) => ({ student: r.student, subjects: report.subjects.filter((sb) => r.per[sb.subject_id].val != null && r.per[sb.subject_id].val < pass).map((sb) => sb.title + ' (' + J.toPersianDigits(r.per[sb.subject_id].val) + ')') }));
  const top = report.rows.filter((r) => r.rank && r.rank <= 5).sort((a, b) => a.rank - b.rank);
  res.render(v('analytics'), { title: 'تحلیل نمرات', classes, classId, termId, terms: await terms(), report, buckets, compare, failing, top, pass });
});

// ---------- کارنامه ----------
router.get('/report-card/:studentId', modules.requireEnabled('exams.report_card'), async (req, res) => {
  const s = await db.table('students as s').leftJoin('classes as c', 'c.id', 's.class_id').leftJoin('grade_levels as g', 'g.id', 's.grade_level_id').select('s.*', 'c.title as class_title', 'g.title as grade_title', 'g.grading_type').where('s.id', req.params.studentId).first();
  if (!s) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  if (req.user.role === 'student') { const me = await studentCtx(req); if (!me || me.id !== s.id || !E('exams.student_view')) return res.status(403).render('errors/403', { title: 'غیرمجاز' }); }
  else if (!(await canViewClass(req, s.class_id))) return res.status(403).render('errors/403', { title: 'غیرمجاز' });
  const allTerms = await terms();
  const termId = Number(req.query.term_id) || ((await currentTerm()) || {}).id;
  const term = allTerms.find((t) => t.id === termId) || null;
  const publishedOnly = req.user.role === 'student' && E('exams.publish');
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
router.post('/remarks/:studentId', auth.requireRole('admin', 'staff', 'teacher'), modules.requireEnabled('exams.remarks'), async (req, res) => {
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
router.get('/class/:classId', auth.requireRole('admin', 'staff', 'teacher'), modules.requireEnabled('exams.class_sheet'), async (req, res) => {
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
router.get('/new', auth.requireRole('admin', 'staff', 'teacher'), modules.requireEnabled('exams.manage'), (req, res) => examForm(req, res, null));
async function saveExam(req, res, exam) {
  const b = utils.cleanBody(req.body, { fields: ['class_subject_id', 'term_id', 'title', 'type', 'date', 'start_time', 'max_score', 'weight', 'description'], dates: ['date'], numbers: ['max_score', 'weight'] });
  const back = exam ? `/exams/${exam.id}/edit` : '/exams/new' + (b.class_subject_id ? '?class_subject_id=' + b.class_subject_id : '');
  const cs = await db.table('class_subjects').where('id', b.class_subject_id).first();
  if (!cs || !b.title || !b.date) { req.flash('danger', 'درس، عنوان و تاریخ الزامی است'); req.keepInput(); return res.redirect(back); }
  if (!(await canManageExam(req, { class_subject_id: cs.id, class_id: cs.class_id }))) return res.status(403).render('errors/403', { title: 'غیرمجاز' });
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
router.post('/', auth.requireRole('admin', 'staff', 'teacher'), modules.requireEnabled('exams.manage'), (req, res) => saveExam(req, res, null));
router.get('/:id/edit', auth.requireRole('admin', 'staff', 'teacher'), modules.requireEnabled('exams.manage'), async (req, res) => {
  const exam = await db.findById('exams', req.params.id);
  if (!exam) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  if (!(await canManageExam(req, exam))) return res.status(403).render('errors/403', { title: 'غیرمجاز' });
  examForm(req, res, exam);
});
router.post('/:id', auth.requireRole('admin', 'staff', 'teacher'), modules.requireEnabled('exams.manage'), async (req, res) => {
  const exam = await db.findById('exams', req.params.id);
  if (!exam) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  if (!(await canManageExam(req, exam))) return res.status(403).render('errors/403', { title: 'غیرمجاز' });
  saveExam(req, res, exam);
});
router.post('/:id/delete', auth.requireRole('admin', 'staff', 'teacher'), modules.requireEnabled('exams.manage'), async (req, res) => {
  const exam = await db.findById('exams', req.params.id);
  if (!exam) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  if (!(await canManageExam(req, exam))) return res.status(403).render('errors/403', { title: 'غیرمجاز' });
  await db.remove('grades', { exam_id: exam.id }); await db.remove('exams', { id: exam.id });
  await activity.log(req, 'delete', 'exams', exam.id, 'حذف آزمون ' + exam.title);
  req.flash('success', 'آزمون و نمرات آن حذف شد.'); res.redirect('/exams');
});
router.post('/:id/publish', auth.requireRole('admin', 'staff', 'teacher'), modules.requireEnabled('exams.publish'), async (req, res) => {
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
router.get('/:id', auth.requireRole('admin', 'staff', 'teacher'), async (req, res) => {
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
  res.render(v('show'), { title: exam.title, exam, students, grades, stats, dist, descriptive, canManage, TYPES, pass: settings.getInt('grading_pass_score', 10) });
});
router.post('/:id/grades', auth.requireRole('admin', 'staff', 'teacher'), modules.requireEnabled('exams.grades'), async (req, res) => {
  const exam = await db.findById('exams', req.params.id);
  if (!exam) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  if (!(await canManageExam(req, exam))) return res.status(403).render('errors/403', { title: 'غیرمجاز' });
  const students = await db.table('students').select('id').where('class_id', exam.class_id).pluck('id');
  const existing = utils.indexBy(await db.table('grades').where('exam_id', exam.id).all(), 'student_id');
  const now = db.now(); let saved = 0, errors = 0;
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
      if (score == null && !row.descriptive && !row.note) { if (existing[sid]) await tx.remove('grades', { id: existing[sid].id }); continue; }
      if (existing[sid]) await tx.update('grades', row, { id: existing[sid].id }); else await tx.insert('grades', Object.assign({ exam_id: exam.id, student_id: sid, created_at: now }, row));
      saved++;
    }
  });
  await activity.log(req, 'grade', 'exams', exam.id, `ثبت ${saved} نمره برای ${exam.title}`);
  req.flash(errors ? 'warning' : 'success', `${J.toPersianDigits(saved)} نمره ذخیره شد.` + (errors ? ` ${J.toPersianDigits(errors)} مقدار نامعتبر (خارج از ۰ تا ${J.toPersianDigits(exam.max_score)}) نادیده گرفته شد.` : ''));
  res.redirect('/exams/' + exam.id);
});

router.get('/api/class-subjects/:classId', auth.requireRole('admin', 'staff', 'teacher'), async (req, res) => res.json(await classSubjectsFor(req, req.params.classId)));

module.exports = router;
module.exports.computeClassGrades = computeClassGrades;
module.exports.TYPES = TYPES;
