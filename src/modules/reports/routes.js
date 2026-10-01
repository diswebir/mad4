'use strict';
const path = require('path');
const express = require('express');
const db = require('../../core/db');
const auth = require('../../core/auth');
const modules = require('../../core/modules');
const utils = require('../../core/utils');
const J = require('../../core/jalali');

const router = express.Router();
const v = (n) => path.join(__dirname, 'views', n + '.ejs');
router.use(auth.requireAuth, auth.requireRole('admin', 'staff'));
const E = modules.isEnabled;
const printOpts = (req) => { const print = req.query.print === '1' && E('reports.print'); return { print, layout: print ? 'layouts/print' : undefined }; };
function csv(res, name, rows, cols) { res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="${name}-${J.todayISO()}.csv"`); res.send(utils.toCSV(rows, cols)); }

router.get('/', async (req, res) => {
  const byGrade = await db.table('students as s').join('grade_levels as g', 'g.id', 's.grade_level_id').select('g.title', 'COUNT(*) as c').where('s.status', 'active').groupBy('g.title', 'g.sort_order').orderBy('g.sort_order').all();
  const byGender = await db.table('students').select('gender', 'COUNT(*) as c').where('status', 'active').groupBy('gender').all();
  const byStatus = await db.table('students').select('status', 'COUNT(*) as c').groupBy('status').all();
  const att = E('attendance') ? await db.table('attendance').select('date', 'status', 'COUNT(*) as c').where('session_key', 'daily').where('date', '>=', J.addDays(J.todayISO(), -30)).groupBy('date', 'status').orderBy('date').all() : [];
  const attByDate = {}; att.forEach((r) => { attByDate[r.date] = attByDate[r.date] || { total: 0, absent: 0, late: 0 }; attByDate[r.date].total += Number(r.c); if (r.status === 'absent') attByDate[r.date].absent += Number(r.c); if (r.status === 'late') attByDate[r.date].late += Number(r.c); });
  const attTrend = Object.entries(attByDate).map(([d, x]) => ({ label: J.toJalali(d).slice(5), absent: x.total ? Math.round(x.absent / x.total * 1000) / 10 : 0, late: x.total ? Math.round(x.late / x.total * 1000) / 10 : 0 }));
  const classAvg = E('exams') ? await db.table('grades as g').join('exams as e', 'e.id', 'g.exam_id').join('classes as c', 'c.id', 'e.class_id').select('c.title', 'AVG(g.score * 20.0 / e.max_score) as avg').whereNotNull('g.score').groupBy('c.title').orderBy('c.title').all() : [];
  const counts = { students: await db.table('students').where('status', 'active').count(), teachers: await db.table('teachers').where('status', 'active').count(), classes: await db.table('classes').where('is_active', 1).count(), users: await db.table('users').where('status', 'active').count() };
  res.render(v('index'), { title: 'گزارش‌ها و آمار', byGrade, byGender, byStatus, attTrend, classAvg, counts, GENDERS: utils.GENDERS, STATUS: utils.STUDENT_STATUS });
});
router.get('/students', modules.requireEnabled('reports.students'), async (req, res) => {
  const rows = await db.table('classes as c').leftJoin('grade_levels as g', 'g.id', 'c.grade_level_id').leftJoin('teachers as t', 't.id', 'c.teacher_id').leftJoin('users as u', 'u.id', 't.user_id').select('c.id', 'c.title', 'c.capacity', 'g.title as grade', 'u.name as teacher',
    "(SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.status = 'active') as total", "(SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.status = 'active' AND s.gender = 'male') as male", "(SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.status = 'active' AND s.gender = 'female') as female",
    "(SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.status = 'active' AND s.transport_route_id IS NOT NULL) as transport", "(SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.status = 'active' AND (s.allergies IS NOT NULL OR s.medical_conditions IS NOT NULL)) as medical").where('c.is_active', 1).orderBy('g.sort_order').orderBy('c.title').all();
  const ages = {}; (await db.table('students').select('birth_date').where('status', 'active').whereNotNull('birth_date').all()).forEach((s) => { const a = J.age(s.birth_date); if (a != null) ages[a] = (ages[a] || 0) + 1; });
  const byStatus = await db.table('students').select('status', 'COUNT(*) as c').groupBy('status').all();
  const byEdu = await db.table('students').select('father_education', 'COUNT(*) as c').where('status', 'active').whereNotNull('father_education').groupBy('father_education').orderBy('c', 'desc').all();
  if (req.query.export === '1' && E('reports.export')) return csv(res, 'students-report', rows, [{ label: 'کلاس', key: 'title' }, { label: 'پایه', key: 'grade' }, { label: 'معلم', key: 'teacher' }, { label: 'تعداد', key: 'total' }, { label: 'پسر', key: 'male' }, { label: 'دختر', key: 'female' }, { label: 'ظرفیت', key: 'capacity' }, { label: 'سرویس', key: 'transport' }]);
  res.render(v('students'), Object.assign({ title: 'گزارش دانش‌آموزان', rows, ages: Object.entries(ages).sort((a, b) => a[0] - b[0]), byStatus, byEdu, STATUS: utils.STUDENT_STATUS, totals: rows.reduce((a, r) => ({ total: a.total + Number(r.total), male: a.male + Number(r.male), female: a.female + Number(r.female), capacity: a.capacity + Number(r.capacity || 0) }), { total: 0, male: 0, female: 0, capacity: 0 }) }, printOpts(req)));
});
router.get('/attendance', modules.requireEnabled('reports.attendance'), async (req, res) => {
  const from = req.query.from ? J.toGregorian(req.query.from) : J.addDays(J.todayISO(), -30); const to = req.query.to ? J.toGregorian(req.query.to) : J.todayISO();
  const rows = await db.table('attendance as a').join('classes as c', 'c.id', 'a.class_id').select('c.id', 'c.title', 'COUNT(*) as total', "SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) as absent", "SUM(CASE WHEN a.status = 'late' THEN 1 ELSE 0 END) as late", "SUM(CASE WHEN a.status = 'excused' THEN 1 ELSE 0 END) as excused", "SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) as present").where('a.session_key', 'daily').whereBetween('a.date', from, to).groupBy('c.id', 'c.title').orderBy('c.title').all();
  rows.forEach((r) => { r.absentRate = r.total ? Math.round(r.absent / r.total * 1000) / 10 : 0; r.lateRate = r.total ? Math.round(r.late / r.total * 1000) / 10 : 0; });
  const top = await db.table('attendance as a').join('students as s', 's.id', 'a.student_id').leftJoin('classes as c', 'c.id', 's.class_id').select('s.id', 's.first_name', 's.last_name', 'c.title as class_title', 'COUNT(*) as absent').where('a.session_key', 'daily').where('a.status', 'absent').whereBetween('a.date', from, to).groupBy('s.id', 's.first_name', 's.last_name', 'c.title').orderBy('absent', 'desc').limit(15).all();
  const byWeekday = await db.table('attendance').select('date', "SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent", 'COUNT(*) as total').where('session_key', 'daily').whereBetween('date', from, to).groupBy('date').all();
  const wd = [0, 0, 0, 0, 0, 0, 0].map(() => ({ absent: 0, total: 0 })); byWeekday.forEach((r) => { const i = J.weekdayIndex(r.date); if (i != null) { wd[i].absent += Number(r.absent); wd[i].total += Number(r.total); } });
  if (req.query.export === '1' && E('reports.export')) return csv(res, 'attendance-report', rows, [{ label: 'کلاس', key: 'title' }, { label: 'کل', key: 'total' }, { label: 'حاضر', key: 'present' }, { label: 'غایب', key: 'absent' }, { label: 'تأخیر', key: 'late' }, { label: 'موجه', key: 'excused' }, { label: 'درصد غیبت', key: 'absentRate' }]);
  res.render(v('attendance'), Object.assign({ title: 'گزارش حضور و غیاب', rows, top, from, to, weekdays: wd.map((x, i) => ({ label: J.WEEKDAYS[i], rate: x.total ? Math.round(x.absent / x.total * 1000) / 10 : 0 })) }, printOpts(req)));
});
router.get('/grades', modules.requireEnabled('reports.grades'), async (req, res) => {
  const terms = await db.table('terms').orderBy('id', 'desc').all();
  const termId = Number(req.query.term_id) || ((terms.find((t) => t.is_current) || terms[0] || {}).id);
  const q = db.table('grades as g').join('exams as e', 'e.id', 'g.exam_id').join('classes as c', 'c.id', 'e.class_id').join('subjects as s', 's.id', 'e.subject_id').select('c.id as class_id', 'c.title as class_title', 's.title as subject', 'AVG(g.score * 20.0 / e.max_score) as avg', 'COUNT(*) as n', 'SUM(CASE WHEN g.score * 20.0 / e.max_score < 10 THEN 1 ELSE 0 END) as fails').whereNotNull('g.score').groupBy('c.id', 'c.title', 's.title').orderBy('c.title').orderBy('s.title');
  if (termId) q.where('e.term_id', termId);
  const rows = await q.all();
  const classes = [...new Set(rows.map((r) => r.class_title))]; const subjects = [...new Set(rows.map((r) => r.subject))];
  const matrix = classes.map((c) => ({ cls: c, cells: subjects.map((s) => rows.find((r) => r.class_title === c && r.subject === s) || null), avg: (() => { const x = rows.filter((r) => r.class_title === c); return x.length ? x.reduce((a, r) => a + Number(r.avg), 0) / x.length : null; })() }));
  const subjAvg = subjects.map((s) => { const x = rows.filter((r) => r.subject === s); return { subject: s, avg: x.length ? x.reduce((a, r) => a + Number(r.avg), 0) / x.length : null, fails: x.reduce((a, r) => a + Number(r.fails), 0), n: x.reduce((a, r) => a + Number(r.n), 0) }; }).sort((a, b) => (a.avg || 0) - (b.avg || 0));
  if (req.query.export === '1' && E('reports.export')) return csv(res, 'grades-report', rows, [{ label: 'کلاس', key: 'class_title' }, { label: 'درس', key: 'subject' }, { label: 'میانگین (از ۲۰)', value: (r) => Math.round(r.avg * 100) / 100 }, { label: 'تعداد نمره', key: 'n' }, { label: 'زیر ۱۰', key: 'fails' }]);
  res.render(v('grades'), Object.assign({ title: 'گزارش نمرات', terms, termId, matrix, subjects, subjAvg }, printOpts(req)));
});
router.get('/teachers', modules.requireEnabled('reports.teachers'), async (req, res) => {
  const rows = await db.table('teachers as t').join('users as u', 'u.id', 't.user_id').select('t.id', 'u.name', 't.field', 't.employment_type', 't.status', '(SELECT COUNT(DISTINCT cs.class_id) FROM class_subjects cs WHERE cs.teacher_id = t.id) as classes', '(SELECT COUNT(*) FROM class_subjects cs WHERE cs.teacher_id = t.id) as subjects', '(SELECT COALESCE(SUM(cs.weekly_hours),0) FROM class_subjects cs WHERE cs.teacher_id = t.id) as hours', '(SELECT COUNT(*) FROM classes c WHERE c.teacher_id = t.id) as homeroom', "(SELECT COUNT(*) FROM leave_requests l WHERE l.user_id = u.id AND l.status = 'approved') as leaves").orderBy('hours', 'desc').all();
  if (req.query.export === '1' && E('reports.export')) return csv(res, 'teachers-report', rows, [{ label: 'نام', key: 'name' }, { label: 'رشته', key: 'field' }, { label: 'کلاس‌ها', key: 'classes' }, { label: 'دروس', key: 'subjects' }, { label: 'ساعت هفتگی', key: 'hours' }, { label: 'سرپرستی', key: 'homeroom' }]);
  res.render(v('teachers'), Object.assign({ title: 'گزارش معلمان', rows, avgHours: rows.length ? Math.round(rows.reduce((a, r) => a + Number(r.hours), 0) / rows.length * 10) / 10 : 0 }, printOpts(req)));
});
module.exports = router;
