'use strict';
const path = require('path');
const express = require('express');
const db = require('../../core/db');
const J = require('../../core/jalali');
const settings = require('../../core/settings');
const modules = require('../../core/modules');
const { requireAuth } = require('../../core/auth');

const router = express.Router();
const v = (n) => path.join(__dirname, 'views', n + '.ejs');
const on = (k) => modules.isEnabled(k);

async function currentYear() { return (await db.findOne('academic_years', { is_current: 1 })) || null; }

async function announcementsFor(user, student) {
  if (!on('announcements')) return [];
  const today = J.todayISO();
  const q = db.table('announcements as a').select('a.*', 'u.name as author_name').leftJoin('users as u', 'a.author_id', 'u.id').where('a.is_active', 1)
    .where((b) => b.whereNull('a.publish_at').orWhere('a.publish_at', '<=', today))
    .where((b) => b.whereNull('a.expires_at').orWhere('a.expires_at', '>=', today))
    .orderBy('a.is_pinned', 'desc').orderBy('a.id', 'desc').limit(5);
  if (user.role === 'teacher') q.whereIn('a.audience', ['all', 'teachers']);
  else if (user.role === 'student') q.where((b) => { b.whereIn('a.audience', ['all', 'students']); if (student && student.class_id) b.orWhere((c) => c.where('a.audience', 'class').where('a.class_id', student.class_id)); });
  return q.all();
}

async function upcomingEvents(classId) {
  if (!on('calendar')) return [];
  const today = J.todayISO();
  const q = db.table('events').where('start_date', '>=', today).where('start_date', '<=', J.addDays(today, 30)).orderBy('start_date').limit(6);
  if (classId) q.where((b) => b.whereNull('class_id').orWhere('class_id', classId));
  return q.all();
}

router.get('/', requireAuth, async (req, res) => {
  const user = req.user;
  const today = J.todayISO();
  const year = await currentYear();
  if (user.role === 'student') return studentDashboard(req, res, { today, year });
  if (user.role === 'parent') return res.redirect('/parents/panel');
  if (user.role === 'teacher') return teacherDashboard(req, res, { today, year });
  return adminDashboard(req, res, { today, year });
});

async function adminDashboard(req, res, { today, year }) {
  const d = { today, year };
  d.students = await db.count('students', { status: 'active' });
  d.teachers = await db.count('teachers', { status: 'active' });
  d.classes = year ? await db.table('classes').where({ academic_year_id: year.id, is_active: 1 }).count() : await db.count('classes', { is_active: 1 });
  d.users = await db.count('users', { status: 'active' });
  d.boys = await db.count('students', { status: 'active', gender: 'male' });
  d.girls = await db.count('students', { status: 'active', gender: 'female' });
  if (on('attendance')) {
    const rows = await db.table('attendance').select('status').select('COUNT(*) as c').where('date', today).where('session_key', 'daily').groupBy('status').all().catch(() => []);
    d.todayAtt = { present: 0, absent: 0, late: 0, excused: 0, leave: 0, total: 0 };
    for (const r of rows) { d.todayAtt[r.status] = Number(r.c); d.todayAtt.total += Number(r.c); }
    d.todayAtt.rate = d.todayAtt.total ? Math.round(((d.todayAtt.present + d.todayAtt.late) / d.todayAtt.total) * 100) : null;
    d.classesRecorded = (await db.table('attendance').where('date', today).where('session_key', 'daily').groupBy('class_id').select('class_id').all()).length;
    if (on('dashboard.charts')) {
      const from = J.addDays(today, -20);
      const trend = await db.table('attendance').select('date', 'status').select('COUNT(*) as c').where('date', '>=', from).where('session_key', 'daily').groupBy('date', 'status').orderBy('date').all();
      const byDate = {};
      for (const r of trend) { byDate[r.date] = byDate[r.date] || { total: 0, present: 0 }; byDate[r.date].total += Number(r.c); if (r.status === 'present' || r.status === 'late') byDate[r.date].present += Number(r.c); }
      d.trend = Object.keys(byDate).sort().slice(-14).map((dt) => ({ label: J.toJalali(dt).slice(5), value: Math.round((byDate[dt].present / byDate[dt].total) * 100) }));
    }
  }
  if (on('dashboard.charts')) {
    d.byGrade = await db.table('students as s').select('g.title').select('COUNT(*) as c').leftJoin('grade_levels as g', 's.grade_level_id', 'g.id').where('s.status', 'active').groupBy('g.title', 'g.sort_order').orderBy('g.sort_order').all();
  }
  if (on('dashboard.pending')) {
    d.pending = {};
    if (on('tickets')) { d.pending.tickets = await db.table('tickets').whereIn('status', ['open', 'pending']).count(); if (on('tickets.sla')) d.pending.ticketsOverdue = (await require('../tickets/sla').classify(db.table('tickets as t'))).overdue.length; }
    if (on('attendance.excuses')) d.pending.excuses = await db.count('absence_excuses', { status: 'pending' });
    if (on('hr.leaves')) d.pending.leaves = await db.count('leave_requests', { status: 'pending' });
    if (on('finance')) d.pending.unpaid = await db.table('invoices').whereIn('status', ['unpaid', 'partial']).count();
    if (on('library.overdue')) d.pending.overdue = await db.table('book_loans').where('status', 'loaned').where('due_at', '<', today).count();
  }
  if (on('tickets')) d.tickets = await db.table('tickets as t').select('t.*', 'u.name as creator').leftJoin('users as u', 't.created_by', 'u.id').orderBy('t.updated_at', 'desc').limit(6).all();
  d.announcements = await announcementsFor(req.user);
  d.events = await upcomingEvents();
  if (on('exams.schedule')) d.exams = await db.table('exams as e').select('e.*', 'c.title as class_title', 's.title as subject_title').leftJoin('classes as c', 'e.class_id', 'c.id').leftJoin('subjects as s', 'e.subject_id', 's.id').where('e.date', '>=', today).orderBy('e.date').limit(6).all();
  if (on('dashboard.birthdays') && on('students.birthdays')) d.birthdays = await require('../students/birthdays').upcoming({ today, days: 7, limit: 8 });
  if (on('system.activity_log')) d.activity = await db.table('activity_logs as a').select('a.*', 'u.name as user_name').leftJoin('users as u', 'a.user_id', 'u.id').orderBy('a.id', 'desc').limit(8).all();
  if (on('discipline')) d.discipline = await db.table('discipline_records').where('date', '>=', J.addDays(today, -7)).count();
  if (on('finance')) d.finance = { collected: await db.table('payments').where('paid_at', '>=', today.slice(0, 7) + '-01').sum('amount'), due: (await db.table('invoices').whereIn('status', ['unpaid', 'partial']).sum('amount')) - (await db.table('invoices').whereIn('status', ['unpaid', 'partial']).sum('paid_amount')) };
  if (on('help.checklist') && !settings.getBool('setup_checklist_dismissed')) { try { const c = await require('../help/checklist').compute(); if (c.percent < 100) d.setup = c; } catch (e) { /* ignore */ } }
  res.render(v('admin'), Object.assign({ title: 'داشبورد' }, d));
}

async function teacherDashboard(req, res, { today, year }) {
  const teacher = await db.table('teachers').where('user_id', req.user.id).first();
  const d = { today, year, teacher };
  if (!teacher) return res.render(v('teacher'), Object.assign({ title: 'داشبورد', classes: [], schedule: [] }, d));
  const yearFilter = (q) => (year ? q.where('c.academic_year_id', year.id) : q);
  d.homeroom = await yearFilter(db.table('classes as c').select('c.*', 'g.title as grade_title').leftJoin('grade_levels as g', 'c.grade_level_id', 'g.id').where('c.teacher_id', teacher.id).where('c.is_active', 1)).all();
  d.teaching = await yearFilter(db.table('class_subjects as cs').select('cs.*', 'c.title as class_title', 's.title as subject_title').join('classes as c', 'cs.class_id', 'c.id').join('subjects as s', 'cs.subject_id', 's.id').where('cs.teacher_id', teacher.id).where('c.is_active', 1)).orderBy('c.title').all();
  const classIds = [...new Set([...d.homeroom.map((c) => c.id), ...d.teaching.map((t) => t.class_id)])];
  d.studentCount = classIds.length ? await db.table('students').whereIn('class_id', classIds).where('status', 'active').count() : 0;
  for (const c of d.homeroom) {
    c.students = await db.count('students', { class_id: c.id, status: 'active' });
    if (on('attendance')) c.attendanceDone = (await db.table('attendance').where({ class_id: c.id, date: today, session_key: 'daily' }).count()) > 0;
  }
  if (on('academic.schedule')) {
    const dow = J.weekdayIndex(today);
    d.schedule = await db.table('schedule_slots as ss').select('ss.*', 'c.title as class_title', 's.title as subject_title').join('class_subjects as cs', 'ss.class_subject_id', 'cs.id').join('classes as c', 'ss.class_id', 'c.id').join('subjects as s', 'cs.subject_id', 's.id').where('cs.teacher_id', teacher.id).where('ss.day_of_week', dow).orderBy('ss.period').all();
    d.todayName = J.weekdayName(today);
    if (on('lessons.today') && d.schedule.length) { // وضعیت ثبت گزارش تدریس امروز
      const logs = await db.table('lesson_logs').select('class_subject_id', 'period').where('teacher_id', teacher.id).where('date', today).all();
      const set = new Set(logs.map((l) => l.class_subject_id + '|' + l.period));
      d.schedule.forEach((s) => { s.logged = set.has(s.class_subject_id + '|' + s.period); });
      d.lessonsLogged = d.schedule.filter((s) => s.logged).length;
    }
    if (on('lessons.missing')) { // جلسات ثبت‌نشدهٔ ۷ روز اخیر
      const lessonsSvc = require('../lessons/service');
      const exp = await lessonsSvc.expectedSessions(J.addDays(today, -7), J.addDays(today, -1), { teacherId: teacher.id });
      d.lessonsMissing = exp.filter((e) => !e.log).length;
    }
  }
  if (on('homework.grade')) d.toGrade = await db.table('homework_submissions as hs').join('homework as h', 'hs.homework_id', 'h.id').where('h.created_by', req.user.id).where('hs.status', 'submitted').count();
  if (on('tickets')) d.tickets = await db.table('tickets as t').select('t.*', 'u.name as creator').leftJoin('users as u', 't.created_by', 'u.id').where('t.assigned_to', req.user.id).whereIn('t.status', ['open', 'pending']).orderBy('t.updated_at', 'desc').limit(5).all();
  if (on('exams')) d.exams = await db.table('exams as e').select('e.*', 'c.title as class_title', 's.title as subject_title').leftJoin('classes as c', 'e.class_id', 'c.id').leftJoin('subjects as s', 'e.subject_id', 's.id').where('e.created_by', req.user.id).where('e.date', '>=', today).orderBy('e.date').limit(5).all();
  d.announcements = await announcementsFor(req.user);
  d.events = await upcomingEvents();
  if (on('hr.leaves')) d.leaves = await db.table('leave_requests').where('user_id', req.user.id).orderBy('id', 'desc').limit(3).all();
  if (on('dashboard.birthdays') && on('students.birthdays')) d.birthdays = await require('../students/birthdays').upcoming({ today, days: 7, limit: 8, classIds });
  res.render(v('teacher'), Object.assign({ title: 'داشبورد معلم' }, d));
}

async function studentDashboard(req, res, { today, year }) {
  const student = await db.table('students as s').select('s.*', 'c.title as class_title', 'c.teacher_id as homeroom_id', 'g.title as grade_title').leftJoin('classes as c', 's.class_id', 'c.id').leftJoin('grade_levels as g', 's.grade_level_id', 'g.id').where('s.user_id', req.user.id).first();
  const d = { today, year, student };
  if (!student) return res.render(v('student'), Object.assign({ title: 'پنل دانش‌آموز' }, d));
  if (student.homeroom_id) d.homeroom = await db.table('teachers as t').select('u.name', 'u.phone', 'u.id as user_id').join('users as u', 't.user_id', 'u.id').where('t.id', student.homeroom_id).first();
  if (on('attendance')) {
    const monthStart = (() => { const j = J.currentJalali(); return J.jalaliMonthRange(j.jy, j.jm).start; })();
    const rows = await db.table('attendance').select('status').select('COUNT(*) as c').where('student_id', student.id).where('session_key', 'daily').where('date', '>=', monthStart).groupBy('status').all();
    d.att = { present: 0, absent: 0, late: 0, excused: 0, leave: 0, total: 0 };
    for (const r of rows) { d.att[r.status] = Number(r.c); d.att.total += Number(r.c); }
    const all = await db.table('attendance').select('status').select('COUNT(*) as c').where('student_id', student.id).where('session_key', 'daily').groupBy('status').all();
    d.attAll = { total: 0, present: 0 };
    for (const r of all) { d.attAll.total += Number(r.c); if (r.status === 'present' || r.status === 'late') d.attAll.present += Number(r.c); }
    d.todayStatus = (await db.table('attendance').where({ student_id: student.id, date: today, session_key: 'daily' }).first() || {}).status || null;
  }
  if (on('exams.student_view')) {
    d.grades = await db.table('grades as g').select('g.*', 'e.title as exam_title', 'e.max_score', 'e.date', 's.title as subject_title').join('exams as e', 'g.exam_id', 'e.id').leftJoin('subjects as s', 'e.subject_id', 's.id').where('g.student_id', student.id).where('e.is_published', 1).orderBy('e.date', 'desc').limit(6).all();
    const scored = await db.table('grades as g').select('g.score', 'e.max_score').join('exams as e', 'g.exam_id', 'e.id').where('g.student_id', student.id).whereNotNull('g.score').all();
    d.avg = scored.length ? Math.round((scored.reduce((a, r) => a + (Number(r.score) / Number(r.max_score || 20)) * 20, 0) / scored.length) * 100) / 100 : null;
  }
  if (on('exams.schedule')) d.exams = await db.table('exams as e').select('e.*', 's.title as subject_title').leftJoin('subjects as s', 'e.subject_id', 's.id').where('e.class_id', student.class_id).where('e.date', '>=', today).orderBy('e.date').limit(5).all();
  if (on('homework.reminder')) {
    d.dueSoon = await db.table('homework as h').select('h.id', 'h.title', 'h.due_date', 's.title as subject_title').leftJoin('subjects as s', 'h.subject_id', 's.id')
      .joinRaw('LEFT JOIN `homework_submissions` AS `hs` ON `hs`.`homework_id` = `h`.`id` AND `hs`.`student_id` = ?', [student.id]).whereNull('hs.id').where('h.class_id', student.class_id).whereBetween('h.due_date', today, J.addDays(today, 3)).orderBy('h.due_date').limit(5).all();
  }
  if (on('homework')) {
    d.homework = await db.table('homework as h').select('h.*', 's.title as subject_title', 'hs.status as sub_status', 'hs.score as sub_score').leftJoin('subjects as s', 'h.subject_id', 's.id')
      .joinRaw('LEFT JOIN `homework_submissions` AS `hs` ON `hs`.`homework_id` = `h`.`id` AND `hs`.`student_id` = ?', [student.id]).where('h.class_id', student.class_id).orderBy('h.due_date', 'desc').limit(6).all();
  }
  if (on('academic.schedule')) {
    const dow = J.weekdayIndex(today);
    d.schedule = await db.table('schedule_slots as ss').select('ss.*', 's.title as subject_title', 'u.name as teacher_name').join('class_subjects as cs', 'ss.class_subject_id', 'cs.id').join('subjects as s', 'cs.subject_id', 's.id').leftJoin('teachers as t', 'cs.teacher_id', 't.id').leftJoin('users as u', 't.user_id', 'u.id').where('ss.class_id', student.class_id).where('ss.day_of_week', dow).orderBy('ss.period').all();
    d.todayName = J.weekdayName(today);
  }
  if (on('tickets')) d.tickets = await db.table('tickets').where('created_by', req.user.id).orderBy('updated_at', 'desc').limit(4).all();
  if (on('finance')) d.invoices = await db.table('invoices').where('student_id', student.id).whereIn('status', ['unpaid', 'partial']).all();
  if (on('discipline')) d.points = { pos: await db.table('discipline_records').where({ student_id: student.id, type: 'positive' }).sum('points'), neg: await db.table('discipline_records').where({ student_id: student.id, type: 'negative' }).sum('points') };
  if (on('library')) d.loans = await db.table('book_loans as l').select('l.*', 'b.title').join('books as b', 'l.book_id', 'b.id').where('l.student_id', student.id).where('l.status', 'loaned').all();
  d.announcements = await announcementsFor(req.user, student);
  d.events = await upcomingEvents(student.class_id);
  if (on('polls')) d.polls = await db.table('polls').where('is_active', 1).where((b) => b.where('audience', 'all').orWhere('audience', 'students').orWhere((c) => c.where('audience', 'class').where('class_id', student.class_id))).orderBy('id', 'desc').limit(2).all();
  if (on('students.birthdays') && student.birth_date) d.birthday = require('../students/birthdays').nextBirthday(student.birth_date, today);
  res.render(v('student'), Object.assign({ title: 'پنل دانش‌آموز' }, d));
}

module.exports = router;
