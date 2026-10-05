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
const people = require('../../core/people');
const svc = require('./service');

const router = express.Router();
const v = (n) => path.join(__dirname, 'views', n + '.ejs');
const E = modules.isEnabled;
const { TYPES } = svc;

// ---------- استعلام عمومی (بدون ورود) ----------
router.get('/verify/:code', modules.requireEnabled('documents.verify'), async (req, res) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  const doc = code ? await svc.baseQuery().where('d.verify_code', code).first() : null;
  res.status(doc ? 200 : 404).render(v('verify'), { layout: 'layouts/auth', title: 'استعلام اصالت سند', doc, code, TYPES });
});
router.get('/verify', modules.requireEnabled('documents.verify'), (req, res) => {
  const code = String(req.query.code || '').trim();
  if (code) return res.redirect('/documents/verify/' + encodeURIComponent(J.toEnglishDigits(code).toUpperCase()));
  res.render(v('verify'), { layout: 'layouts/auth', title: 'استعلام اصالت سند', doc: null, code: '', TYPES });
});

router.use(auth.requireAuth);
const canIssue = (req) => req.user.role === 'admin' || req.can('documents.issue');
const requireIssuer = (req, res, next) => (canIssue(req) ? next() : res.status(403).render('errors/403', { title: 'غیرمجاز', message: 'صدور و مدیریت اسناد رسمی نیازمند مجوز «صدور گواهی و اسناد» است.' }));
const isOwnerRole = (req) => req.user.role === 'student' || req.user.role === 'parent';
async function teacherClassIds(req) { return req.user.role === 'teacher' ? people.teacherClassIds(req.user.id) : []; }
const typeEnabled = (type) => TYPES[type] && E(TYPES[type].feature);
const enabledTypes = () => Object.keys(TYPES).filter(typeEnabled);

// ---------- فهرست / بایگانی ----------
router.get('/', requireIssuer, async (req, res) => {
  const f = { type: TYPES[req.query.type] ? req.query.type : '', status: ['valid', 'revoked'].includes(req.query.status) ? req.query.status : '', q: utils.normalizePersian(req.query.q || '').trim() };
  const q = svc.baseQuery();
  if (f.type) q.where('d.type', f.type);
  if (f.status) q.where('d.status', f.status);
  if (f.q) { const qq = J.toEnglishDigits(f.q); q.where((b) => b.where('d.serial', 'like', `%${qq}%`).orWhere('d.title', 'like', `%${f.q}%`).orWhere('d.recipient', 'like', `%${f.q}%`).orWhere('s.first_name', 'like', `%${f.q}%`).orWhere('s.last_name', 'like', `%${f.q}%`).orWhere('s.student_number', 'like', `%${qq}%`).orWhere('d.verify_code', 'like', `%${qq.toUpperCase()}%`)); }
  const result = await q.orderBy('d.id', 'desc').paginate(req.query.page, 25);
  const statRows = await db.table('documents').select('type', 'COUNT(*) as c').groupBy('type').all();
  const stats = {}; statRows.forEach((r) => { stats[r.type] = Number(r.c); });
  res.render(v('index'), { title: 'اسناد و گواهی‌ها', result, f, stats, TYPES, types: enabledTypes(), classes: await db.table('classes').where('is_active', 1).orderBy('title').all() });
});

// ---------- اسناد من (دانش‌آموز / ولی) ----------
router.get('/my', auth.requireRole('student', 'parent'), modules.requireEnabled('documents.student_view'), async (req, res) => {
  const me = await people.studentOf(req);
  const rows = me ? await svc.baseQuery().where('d.student_id', me.id).orderBy('d.id', 'desc').all() : [];
  res.render(v('my'), { title: 'گواهی‌های من', rows, me, TYPES });
});

// ---------- صدور گواهی / نامه ----------
async function newForm(req, res, type, data, errors) {
  const studentId = Number(req.query.student_id || (data && data.student_id)) || null;
  let ctx = null;
  if (studentId) ctx = await svc.studentContext(studentId, { recipient: (data && data.recipient) || '{recipient}' });
  const body = data && data.body != null ? data.body : (type === 'certificate' && ctx ? svc.fill(settings.get('certificate_template', ''), Object.assign({}, ctx.vars, { recipient: '{recipient}' })) : '');
  res.render(v('new'), { title: type === 'letter' ? 'نامه / معرفی‌نامه جدید' : 'صدور گواهی اشتغال به تحصیل', type, TYPES, student: ctx ? ctx.student : null, vars: ctx ? ctx.vars : null, data: Object.assign({ title: TYPES[type].title, recipient: '', purpose: '', body }, data || {}), errors: errors || [], students: await people.studentOptions(req) });
}
router.get('/new', requireIssuer, async (req, res) => {
  const type = req.query.type === 'letter' ? 'letter' : 'certificate';
  if (!typeEnabled(type)) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  newForm(req, res, type);
});
router.post('/', requireIssuer, async (req, res) => {
  const type = req.body.type === 'letter' ? 'letter' : 'certificate';
  if (!typeEnabled(type)) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const b = utils.cleanBody(req.body, { fields: ['student_id', 'title', 'recipient', 'purpose', 'body'], numbers: ['student_id'] });
  const errors = [];
  if (type === 'certificate' && !b.student_id) errors.push('برای گواهی باید دانش‌آموز انتخاب شود.');
  if (!b.title) errors.push('عنوان سند الزامی است.');
  if (!b.body || b.body.trim().length < 10) errors.push('متن سند باید وارد شود.');
  const ctx = b.student_id ? await svc.studentContext(b.student_id, { recipient: b.recipient || 'مراجع ذی‌صلاح' }) : null;
  if (b.student_id && !ctx) errors.push('دانش‌آموز یافت نشد.');
  if (errors.length) { req.query.student_id = b.student_id; return newForm(req, res, type, b, errors); }
  const vars = Object.assign({ school: settings.get('school_name', ''), date: J.formatDate(J.todayISO()), principal: settings.get('principal_name', ''), recipient: b.recipient || 'مراجع ذی‌صلاح' }, ctx ? ctx.vars : {}, { recipient: b.recipient || 'مراجع ذی‌صلاح' });
  const text = svc.fill(b.body, vars);
  const doc = await svc.issue({ type, studentId: b.student_id || null, title: b.title, recipient: b.recipient, body: text, purpose: b.purpose, userId: req.user.id, classId: ctx ? ctx.student.class_id : null, data: ctx ? { student: ctx.vars } : null });
  await activity.log(req, 'issue', 'documents', doc.id, `صدور ${TYPES[type].title} ${doc.serial}` + (ctx ? ` برای ${ctx.vars.student}` : ''));
  req.flash('success', `سند با شمارهٔ ${J.toPersianDigits(doc.serial)} صادر شد.`);
  res.redirect('/documents/' + doc.id);
});

// ---------- کارنامهٔ رسمی ----------
async function reportCardData(studentId, termId) {
  const exams = require('../exams/service');
  const s = await db.table('students as s').leftJoin('classes as c', 'c.id', 's.class_id').leftJoin('grade_levels as g', 'g.id', 's.grade_level_id').select('s.*', 'c.title as class_title', 'g.title as grade_title', 'g.grading_type').where('s.id', studentId).first();
  if (!s) return null;
  const term = termId ? await db.table('terms as t').join('academic_years as y', 'y.id', 't.academic_year_id').select('t.*', 'y.title as year_title').where('t.id', termId).first() : null;
  if (!term) return null;
  const report = s.class_id ? await exams.computeClassGrades(s.class_id, term.id) : { rows: [], subjects: [], subjectAvg: {}, classAvg: null };
  const mine = report.rows.find((r) => r.student.id === s.id) || { per: {}, gpa: null, rank: null };
  const subjects = report.subjects.map((sb) => ({ title: sb.title, hours: sb.weekly_hours, score: mine.per[sb.subject_id] ? mine.per[sb.subject_id].val : null, desc: mine.per[sb.subject_id] ? mine.per[sb.subject_id].desc : null, classAvg: report.subjectAvg[sb.subject_id] }));
  let att = null;
  if (E('attendance')) {
    const rows = await db.table('attendance').select('status', 'COUNT(*) as c').where('student_id', s.id).where('session_key', 'daily').whereBetween('date', term.start_date, term.end_date).groupBy('status').all();
    att = {}; rows.forEach((r) => { att[r.status] = Number(r.c); });
  }
  const remark = E('exams.remarks') ? await db.table('term_remarks').where({ student_id: s.id, term_id: term.id }).first() : null;
  return {
    student: { id: s.id, name: `${s.first_name} ${s.last_name}`, father: s.father_name, student_number: s.student_number, national_id: s.national_id, class: s.class_title, grade: s.grade_title, grading_type: s.grading_type, class_id: s.class_id },
    term: { id: term.id, title: term.title, year: term.year_title, is_locked: Number(term.is_locked) || 0 },
    subjects, gpa: mine.gpa, rank: mine.rank, classSize: report.rows.length, classAvg: report.classAvg, attendance: att, remark: remark ? remark.remark : null, pass: settings.getInt('grading_pass_score', 10), descriptive: s.grading_type === 'descriptive'
  };
}
async function canSeeStudent(req, studentId) {
  if (canIssue(req)) return true;
  if (isOwnerRole(req)) { const me = await people.studentOf(req); return !!me && me.id === Number(studentId); }
  if (req.user.role === 'teacher') { const st = await db.findById('students', studentId); const ids = await teacherClassIds(req); return !!st && ids.includes(st.class_id); }
  return false;
}
router.get('/report-card/:studentId', modules.requireEnabled('documents.report_card'), async (req, res) => {
  if (!E('exams')) return res.status(404).render('errors/404', { title: 'یافت نشد', message: 'ماژول آزمون‌ها غیرفعال است.' });
  if (!canIssue(req) && req.user.role !== 'teacher') return res.status(403).render('errors/403', { title: 'غیرمجاز' });
  if (!(await canSeeStudent(req, req.params.studentId))) return res.status(403).render('errors/403', { title: 'غیرمجاز' });
  const terms = await db.table('terms as t').join('academic_years as y', 'y.id', 't.academic_year_id').select('t.*', 'y.title as year_title').orderBy('t.id', 'desc').all();
  let termId = Number(req.query.term_id) || ((terms.find((t) => t.is_current) || {}).id);
  if (!termId) { const st = await db.findById('students', req.params.studentId); const last = st ? await db.table('exams').where('class_id', st.class_id).whereNotNull('term_id').orderBy('date', 'desc').first() : null; termId = last ? last.term_id : (terms[0] || {}).id; }
  const data = await reportCardData(req.params.studentId, termId);
  if (!data) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const issued = await svc.baseQuery().where('d.type', 'report_card').where('d.student_id', data.student.id).where('d.term_id', termId).where('d.status', 'valid').orderBy('d.id', 'desc').first();
  res.render(v('report-card'), { title: 'کارنامهٔ رسمی — ' + data.student.name, data, terms, termId, issued, canIssue: canIssue(req), lh: svc.letterhead() });
});
router.post('/report-card/:studentId', requireIssuer, modules.requireEnabled('documents.report_card'), async (req, res) => {
  const termId = Number(req.body.term_id);
  const data = await reportCardData(req.params.studentId, termId);
  if (!data) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const doc = await svc.issue({ type: 'report_card', studentId: data.student.id, title: `کارنامهٔ ${data.term.title} — ${data.student.name}`, recipient: null, body: null, purpose: req.body.purpose || null, userId: req.user.id, termId, classId: data.student.class_id, data });
  await activity.log(req, 'issue', 'documents', doc.id, `صدور کارنامهٔ رسمی ${doc.serial} برای ${data.student.name} (${data.term.title})`);
  req.flash('success', `کارنامهٔ رسمی با شمارهٔ ${J.toPersianDigits(doc.serial)} صادر شد.`);
  res.redirect('/documents/' + doc.id);
});

// ---------- ریزنمرات رسمی درس ----------
router.get('/grade-sheet/:classSubjectId', modules.requireEnabled('documents.grade_sheet'), async (req, res) => {
  if (!E('exams')) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const exams = require('../exams/service');
  const cs = await db.table('class_subjects as cs').join('classes as c', 'c.id', 'cs.class_id').join('subjects as sb', 'sb.id', 'cs.subject_id').leftJoin('teachers as t', 't.id', 'cs.teacher_id').leftJoin('users as u', 'u.id', 't.user_id')
    .select('cs.*', 'c.title as class_title', 'sb.title as subject_title', 'u.name as teacher_name').where('cs.id', req.params.classSubjectId).first();
  if (!cs) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  if (!canIssue(req)) { const ids = await teacherClassIds(req); if (!ids.includes(cs.class_id)) return res.status(403).render('errors/403', { title: 'غیرمجاز' }); }
  const terms = await db.table('terms as t').join('academic_years as y', 'y.id', 't.academic_year_id').select('t.*', 'y.title as year_title').orderBy('t.id', 'desc').all();
  let termId = Number(req.query.term_id) || ((terms.find((t) => t.is_current) || {}).id);
  if (!termId) { const last = await db.table('exams').where('class_subject_id', cs.id).whereNotNull('term_id').orderBy('date', 'desc').first(); termId = last ? last.term_id : (terms[0] || {}).id; }
  const term = terms.find((t) => t.id === termId) || null;
  const eq = db.table('exams').where('class_subject_id', cs.id); if (termId) eq.where('term_id', termId);
  const examRows = await eq.orderBy('date').all();
  const students = await db.table('students').select('id', 'first_name', 'last_name', 'student_number').where('class_id', cs.class_id).where('status', 'active').orderBy('last_name').orderBy('first_name').all();
  const grades = examRows.length ? await db.table('grades').whereIn('exam_id', examRows.map((e) => e.id)).all() : [];
  const map = {}; grades.forEach((g) => { map[g.student_id + ':' + g.exam_id] = g; });
  const rows = students.map((s) => {
    let sum = 0, w = 0;
    const cells = examRows.map((e) => { const g = map[s.id + ':' + e.id]; if (g && g.score != null) { const ww = Number(e.weight) || 1; sum += exams.to20(g.score, e.max_score) * ww; w += ww; } return g || null; });
    return { s, cells, final: w ? Math.round(sum / w * 100) / 100 : null };
  });
  const serial = `${TYPES.grade_sheet.prefix}-${J.toJalaliParts(J.todayISO()).jy}-${J.toEnglishDigits(String(cs.id)).padStart(4, '0')}`;
  res.render(v('grade-sheet'), { title: `ریزنمرات ${cs.subject_title} — ${cs.class_title}`, layout: 'layouts/print', letterhead: true, cs, term, terms, termId, exams: examRows, rows, serial, lh: svc.letterhead(), to20: exams.to20 });
});

// ---------- دفتر حضور و غیاب ماهانه ----------
router.get('/roster/:classId', modules.requireEnabled('documents.roster'), async (req, res) => {
  if (!E('attendance')) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const cls = await db.table('classes as c').leftJoin('grade_levels as g', 'g.id', 'c.grade_level_id').leftJoin('teachers as t', 't.id', 'c.teacher_id').leftJoin('users as u', 'u.id', 't.user_id').select('c.*', 'g.title as grade_title', 'u.name as teacher_name').where('c.id', req.params.classId).first();
  if (!cls) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  if (!canIssue(req)) { const ids = await teacherClassIds(req); if (!ids.includes(cls.id)) return res.status(403).render('errors/403', { title: 'غیرمجاز' }); }
  const today = J.toJalaliParts(J.todayISO());
  const m = /^(\d{4})[\/-](\d{1,2})$/.exec(J.toEnglishDigits(String(req.query.month || '')));
  const jy = m ? Number(m[1]) : today.jy, jm = m ? Math.min(12, Math.max(1, Number(m[2]))) : today.jm;
  const daysInMonth = J.monthLength(jy, jm);
  const schoolDays = settings.getList('school_days').map(Number).filter((x) => x >= 0 && x <= 6);
  const days = [];
  for (let d = 1; d <= daysInMonth; d++) { const iso = J.toGregorian(`${jy}/${jm}/${d}`); if (!iso) continue; const wd = J.weekdayIndex(iso); if (!schoolDays.length || schoolDays.includes(wd)) days.push({ d, iso, wd }); }
  const from = J.toGregorian(`${jy}/${jm}/1`), to = J.toGregorian(`${jy}/${jm}/${daysInMonth}`);
  const students = await db.table('students').select('id', 'first_name', 'last_name', 'student_number').where('class_id', cls.id).where('status', 'active').orderBy('last_name').orderBy('first_name').all();
  const att = await db.table('attendance').select('student_id', 'date', 'status').where('class_id', cls.id).where('session_key', 'daily').whereBetween('date', from, to).all();
  const map = {}; att.forEach((a) => { map[a.student_id + ':' + a.date] = a.status; });
  const SYM = { present: '', absent: 'غ', late: 'ت', excused: 'م', leave: 'خ' };
  const rows = students.map((s) => { const cells = days.map((d) => map[s.id + ':' + d.iso] || null); const c = { absent: 0, late: 0, excused: 0, leave: 0 }; cells.forEach((x) => { if (x && c[x] != null) c[x]++; }); return { s, cells, c }; });
  const months = []; for (let i = 0; i < 12; i++) { let y = today.jy, mm = today.jm - i; while (mm <= 0) { mm += 12; y--; } months.push({ value: `${y}/${mm}`, label: J.MONTHS[mm - 1] + ' ' + J.toPersianDigits(y) }); }
  const serial = `${TYPES.roster.prefix}-${jy}-${String(jm).padStart(2, '0')}${String(cls.id).padStart(2, '0')}`;
  res.render(v('roster'), { title: `دفتر حضور و غیاب ${cls.title} — ${J.MONTHS[jm - 1]} ${J.toPersianDigits(jy)}`, layout: 'layouts/print', letterhead: true, cls, days, rows, jy, jm, months, SYM, serial, lh: svc.letterhead(), monthName: J.MONTHS[jm - 1] });
});

// ---------- نمایش / چاپ سند ----------
router.get('/:id', async (req, res) => {
  const doc = await svc.baseQuery().where('d.id', req.params.id).first();
  if (!doc) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  if (!canIssue(req)) {
    if (!(isOwnerRole(req) && E('documents.student_view') && (await canSeeStudent(req, doc.student_id)))) return res.status(403).render('errors/403', { title: 'غیرمجاز' });
  }
  const data = svc.parseData(doc);
  res.render(v('show'), { title: doc.title, layout: 'layouts/print', letterhead: true, doc, data, TYPES, lh: svc.letterhead(), verifyUrl: svc.verifyUrl(doc.verify_code), canIssue: canIssue(req) });
});
router.post('/:id/revoke', requireIssuer, modules.requireEnabled('documents.revoke'), async (req, res) => {
  const doc = await db.findById('documents', req.params.id);
  if (!doc) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const reason = utils.normalizePersian(req.body.reason || '').trim();
  if (doc.status === 'revoked') { req.flash('warning', 'این سند قبلاً باطل شده است.'); return res.redirect('/documents'); }
  if (!reason) { req.flash('danger', 'برای ابطال سند، ثبت دلیل الزامی است.'); return res.redirect('/documents'); }
  await db.update('documents', { status: 'revoked', revoked_at: db.now(), revoke_reason: reason.slice(0, 255) }, { id: doc.id });
  await activity.log(req, 'revoke', 'documents', doc.id, `ابطال سند ${doc.serial}: ${reason}`);
  req.flash('success', `سند ${J.toPersianDigits(doc.serial)} باطل شد.`);
  res.redirect('/documents');
});

module.exports = router;
