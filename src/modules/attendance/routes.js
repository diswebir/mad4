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
const upload = require('../../core/upload');
const settings = require('../../core/settings');
const notify = require('../../core/notify');

const router = express.Router();
const v = (n) => path.join(__dirname, 'views', n + '.ejs');
router.use(auth.requireAuth);
const E = modules.isEnabled;
const STATUSES = () => (E('attendance.statuses') ? Object.keys(utils.ATT_STATUS) : ['present', 'absent']);

// ---------- کمکی ----------
async function teacherInfo(req) {
  if (req.user.role !== 'teacher') return null;
  const t = await db.table('teachers').where('user_id', req.user.id).first();
  if (!t) return { id: -1, homeroom: [], teaching: [] };
  const homeroom = await db.table('classes').select('id').where('teacher_id', t.id).pluck('id');
  const teaching = await db.table('class_subjects').where('teacher_id', t.id).all();
  return { id: t.id, homeroom, teaching };
}
async function canTake(req, classId, csId) {
  if (['admin', 'staff'].includes(req.user.role)) return true;
  const t = await teacherInfo(req);
  if (!t) return false;
  if (csId) return t.teaching.some((c) => c.id === Number(csId) && c.class_id === Number(classId));
  return t.homeroom.includes(Number(classId)) || t.teaching.some((c) => c.class_id === Number(classId));
}
async function canViewClass(req, classId) { return canTake(req, classId, null); }
function parseDate(q) { if (!q) return J.todayISO(); const g = J.toGregorian(q); return g || (J.parseISO(q) ? q : J.todayISO()); }
const schoolDays = () => { const n = settings.getList('school_days').map(Number).filter((x) => x >= 0 && x <= 6); return n.length ? n : [0, 1, 2, 3, 4]; };
const isSchoolDay = (iso) => schoolDays().includes(J.weekdayIndex(iso));
const classesQuery = () => db.table('classes as c').leftJoin('grade_levels as g', 'g.id', 'c.grade_level_id').leftJoin('teachers as t', 't.id', 'c.teacher_id').leftJoin('users as u', 'u.id', 't.user_id').select('c.*', 'g.title as grade_title', 'u.name as teacher_name', '(SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.status = \'active\') as cnt').where('c.is_active', 1);

// ---------- صفحهٔ اصلی ----------
router.get('/', async (req, res) => {
  if (req.user.role === 'student' || req.user.role === 'parent') return res.redirect('/attendance/my');
  const date = parseDate(req.query.date);
  const t = await teacherInfo(req);
  let q = classesQuery();
  if (t) q = q.where((b) => b.whereIn('c.id', t.homeroom.length ? t.homeroom : [-1]).orWhereRaw('c.id IN (SELECT class_id FROM class_subjects WHERE teacher_id = ?)', [t.id]));
  const classes = await q.orderBy('g.sort_order').orderBy('c.title').all();
  const taken = await db.table('attendance').select('class_id', 'session_key', 'COUNT(*) as c', 'SUM(CASE WHEN status = \'absent\' THEN 1 ELSE 0 END) as absent', 'SUM(CASE WHEN status = \'late\' THEN 1 ELSE 0 END) as late').where('date', date).groupBy('class_id', 'session_key').all();
  const byClass = {};
  for (const r of taken) { byClass[r.class_id] = byClass[r.class_id] || { daily: null, sessions: [] }; if (r.session_key === 'daily') byClass[r.class_id].daily = r; else byClass[r.class_id].sessions.push(r); }
  const mySubjects = t ? await db.table('class_subjects as cs').join('subjects as s', 's.id', 'cs.subject_id').select('cs.id', 'cs.class_id', 's.title').where('cs.teacher_id', t.id).all() : [];
  const todaySlots = t && E('academic.schedule') ? await db.table('schedule_slots as ss').join('class_subjects as cs', 'cs.id', 'ss.class_subject_id').select('ss.class_id', 'ss.class_subject_id', 'ss.period').where('cs.teacher_id', t.id).where('ss.day_of_week', J.weekdayIndex(date)).all() : [];
  const summary = { total: 0, present: 0, absent: 0, late: 0 };
  if (E('attendance.dashboard_stats')) {
    const s = await db.table('attendance').select('status', 'COUNT(*) as c').where('date', date).where('session_key', 'daily').groupBy('status').all();
    s.forEach((r) => { summary.total += Number(r.c); if (['present', 'late'].includes(r.status)) summary.present += Number(r.c); if (r.status === 'absent') summary.absent += Number(r.c); if (r.status === 'late') summary.late += Number(r.c); });
  }
  res.render(v('index'), { title: 'حضور و غیاب', date, classes, byClass, mySubjects, todaySlots, summary, isSchoolDay: isSchoolDay(date), isTeacher: !!t });
});

// ---------- ثبت ----------
router.get('/take', async (req, res) => {
  const classId = Number(req.query.class_id); const csId = req.query.class_subject_id ? Number(req.query.class_subject_id) : null;
  if (!classId) return res.redirect('/attendance');
  if (csId && !E('attendance.per_subject')) return res.status(404).render('errors/module-disabled', { title: 'غیرفعال', feature: 'حضور و غیاب زنگ‌به‌زنگ' });
  if (!csId && !E('attendance.daily')) return res.status(404).render('errors/module-disabled', { title: 'غیرفعال', feature: 'حضور و غیاب روزانه' });
  if (!(await canTake(req, classId, csId))) return res.status(403).render('errors/403', { title: 'دسترسی غیرمجاز' });
  const date = parseDate(req.query.date);
  const cls = await classesQuery().where('c.id', classId).first();
  if (!cls) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const cs = csId ? await db.table('class_subjects as cs').join('subjects as s', 's.id', 'cs.subject_id').select('cs.*', 's.title as subject_title').where('cs.id', csId).first() : null;
  const sessionKey = cs ? 'cs:' + cs.id : 'daily';
  const students = await db.table('students').where('class_id', classId).where('status', 'active').orderBy('last_name').orderBy('first_name').all();
  const existing = await db.table('attendance').where({ date, class_id: classId, session_key: sessionKey }).all();
  const map = Object.fromEntries(existing.map((r) => [r.student_id, r]));
  // غیبت روزانه برای پیش‌فرض زنگ
  const dailyAbsent = cs ? Object.fromEntries((await db.table('attendance').select('student_id', 'status').where({ date, class_id: classId, session_key: 'daily' }).all()).map((r) => [r.student_id, r.status])) : {};
  const stats30 = Object.fromEntries((await db.table('attendance').select('student_id', 'COUNT(*) as c').where('class_id', classId).where('status', 'absent').where('date', '>=', J.addDays(date, -30)).groupBy('student_id').all()).map((r) => [r.student_id, Number(r.c)]));
  const locked = req.user.role === 'teacher' && E('attendance.edit_window') && J.diffDays(date, J.todayISO()) > 3;
  const otherSessions = E('attendance.per_subject') ? await db.table('attendance as a').join('class_subjects as cs', 'cs.id', 'a.class_subject_id').join('subjects as s', 's.id', 'cs.subject_id').select('a.session_key', 's.title', 'COUNT(*) as c').where('a.date', date).where('a.class_id', classId).where('a.session_key', '!=', sessionKey).groupBy('a.session_key', 's.title').all() : [];
  res.render(v('take'), { title: 'ثبت حضور و غیاب', cls, cs, date, students, map, dailyAbsent, stats30, locked, sessionKey, statuses: STATUSES(), existingCount: existing.length, otherSessions, isSchoolDay: isSchoolDay(date), period: req.query.period || '' });
});

router.post('/take', async (req, res) => {
  const classId = Number(req.body.class_id); const csId = req.body.class_subject_id ? Number(req.body.class_subject_id) : null;
  const date = parseDate(req.body.date);
  if (!classId || !(await canTake(req, classId, csId))) return res.status(403).render('errors/403', { title: 'دسترسی غیرمجاز' });
  if (req.user.role === 'teacher' && E('attendance.edit_window') && J.diffDays(date, J.todayISO()) > 3) { req.flash('danger', 'مهلت ویرایش این تاریخ به پایان رسیده است.'); return res.redirect('/attendance'); }
  const sessionKey = csId ? 'cs:' + csId : 'daily';
  const allowed = STATUSES();
  const students = await db.table('students').select('id', 'first_name', 'last_name', 'user_id', 'father_phone', 'mother_phone', 'guardian_phone', 'guardian_type').where('class_id', classId).where('status', 'active').all();
  const existing = Object.fromEntries((await db.table('attendance').where({ date, class_id: classId, session_key: sessionKey }).all()).map((r) => [r.student_id, r]));
  const now = db.now();
  const newlyAbsent = [];
  let count = 0;
  await db.transaction(async (tx) => {
    for (const s of students) {
      let status = req.body['status_' + s.id];
      if (!status || !allowed.includes(status)) status = 'present';
      const note = utils.normalizePersian(req.body['note_' + s.id] || '') || null;
      let minutes = req.body['late_' + s.id] ? parseInt(J.toEnglishDigits(req.body['late_' + s.id]), 10) || null : null;
      if (status !== 'late') minutes = null;
      const row = { status, note, minutes_late: minutes, period: req.body.period ? parseInt(req.body.period, 10) || null : null, recorded_by: req.user.id, updated_at: now };
      const prev = existing[s.id];
      if (prev) { if (prev.status !== status || prev.note !== note || prev.minutes_late !== minutes) { if (prev.status !== status) row.notified = 0; await tx.update('attendance', row, { id: prev.id }); } }
      else await tx.insert('attendance', Object.assign({ date, class_id: classId, student_id: s.id, class_subject_id: csId, session_key: sessionKey, created_at: now }, row));
      if (status === 'absent' && (!prev || prev.status !== 'absent')) newlyAbsent.push(s);
      count++;
    }
  });
  await activity.log(req, 'attendance', 'classes', classId, `ثبت حضور و غیاب ${sessionKey === 'daily' ? 'روزانه' : 'زنگ'} — ${J.formatDate(date)} (${count} نفر)`);
  // اعلان‌ها
  if (newlyAbsent.length && E('attendance.notify') && settings.getBool('attendance_absent_notify')) {
    const subj = csId ? await db.table('class_subjects as cs').join('subjects as s', 's.id', 'cs.subject_id').select('s.title').where('cs.id', csId).first() : null;
    const dateFa = J.formatDate(date);
    await notify.push(newlyAbsent.map((s) => s.user_id), { title: 'ثبت غیبت', body: `غیبت شما در تاریخ ${dateFa}${subj ? ' — درس ' + subj.title : ''} ثبت شد.${E('attendance.excuses') ? ' در صورت داشتن دلیل موجه، درخواست ثبت کنید.' : ''}`, link: '/attendance/my', type: 'warning' });
    if (!csId && settings.get('attendance_sms_mode', 'scheduled') === 'immediate') {
      const tpl = settings.get('sms_template_absent');
      for (const s of newlyAbsent) {
        const phone = s.guardian_type === 'mother' ? s.mother_phone : (s.guardian_type === 'other' ? s.guardian_phone : s.father_phone) || s.father_phone || s.mother_phone;
        if (phone) { const r = await notify.sms(phone, notify.template(tpl, { name: `${s.first_name} ${s.last_name}`, date: dateFa, school: settings.get('school_name') }), 'attendance'); if (r && r.ok) await db.table('attendance').where({ student_id: s.id, date, session_key: sessionKey }).update({ notified: 1 }); }
      }
    }
  }
  req.flash('success', `حضور و غیاب ${J.toPersianDigits(count)} دانش‌آموز ثبت شد.` + (newlyAbsent.length ? ` (${J.toPersianDigits(newlyAbsent.length)} غیبت)` : ''));
  res.redirect(req.body.redirect || '/attendance?date=' + date);
});

// ---------- دانش‌آموز ----------
router.get('/my', auth.requireRole('student', 'parent'), modules.requireEnabled('attendance.my'), async (req, res) => {
  const s = await people.studentOf(req);
  if (!s) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  res.redirect(`/attendance/report/student/${s.id}`);
});

// ---------- گزارش‌ها ----------
router.get('/report/student/:id', async (req, res) => {
  const s = await db.table('students as s').leftJoin('classes as c', 'c.id', 's.class_id').select('s.*', 'c.title as class_title').where('s.id', req.params.id).first();
  if (!s) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const isOwner = (req.user.role === 'student' && s.user_id === req.user.id) || (req.user.role === 'parent' && (await people.childrenOf(req.user.id)).some((k) => k.id === s.id));
  if (isOwner ? !E('attendance.my') : !E('attendance.student_report')) return res.status(404).render('errors/module-disabled', { title: 'غیرفعال', feature: 'گزارش حضور' });
  if (!isOwner && !(await canViewClass(req, s.class_id))) return res.status(403).render('errors/403', { title: 'دسترسی غیرمجاز' });
  const cur = J.currentJalali();
  const jy = parseInt(req.query.jy, 10) || cur.jy; const jm = parseInt(req.query.jm, 10) || cur.jm;
  const range = J.jalaliMonthRange(jy, jm);
  const monthRows = await db.table('attendance as a').leftJoin('class_subjects as cs', 'cs.id', 'a.class_subject_id').leftJoin('subjects as sb', 'sb.id', 'cs.subject_id').select('a.*', 'sb.title as subject_title').where('a.student_id', s.id).whereBetween('a.date', range.start, range.end).orderBy('a.date').all();
  const byDay = {};
  for (const r of monthRows) { byDay[r.date] = byDay[r.date] || { daily: null, sessions: [] }; if (r.session_key === 'daily') byDay[r.date].daily = r; else byDay[r.date].sessions.push(r); }
  const totals = Object.fromEntries((await db.table('attendance').select('status', 'COUNT(*) as c').where('student_id', s.id).where('session_key', 'daily').groupBy('status').all()).map((r) => [r.status, Number(r.c)]));
  const total = Object.values(totals).reduce((a, b) => a + b, 0);
  // روند ۶ ماه
  const trend = [];
  for (let i = 5; i >= 0; i--) { let y = jy, m = jm - i; while (m < 1) { m += 12; y--; } const r = J.jalaliMonthRange(y, m); const rows = await db.table('attendance').select('status', 'COUNT(*) as c').where('student_id', s.id).where('session_key', 'daily').whereBetween('date', r.start, r.end).groupBy('status').all(); const o = Object.fromEntries(rows.map((x) => [x.status, Number(x.c)])); trend.push({ label: J.MONTHS[m - 1], absent: o.absent || 0, late: o.late || 0, present: (o.present || 0) + (o.late || 0), total: Object.values(o).reduce((a, b) => a + b, 0) }); }
  const excuses = E('attendance.excuses') ? await db.table('absence_excuses').where('student_id', s.id).orderBy('id', 'desc').limit(10).all() : [];
  const recent = await db.table('attendance as a').leftJoin('class_subjects as cs', 'cs.id', 'a.class_subject_id').leftJoin('subjects as sb', 'sb.id', 'cs.subject_id').select('a.*', 'sb.title as subject_title').where('a.student_id', s.id).where('a.status', '!=', 'present').orderBy('a.date', 'desc').limit(30).all();
  res.render(v('student'), { title: 'گزارش حضور ' + s.first_name + ' ' + s.last_name, s, jy, jm, range, byDay, totals, total, trend, excuses, recent, isOwner, schoolDays: schoolDays(), monthLen: J.monthLength(jy, jm) });
});

router.get('/report/class/:id', modules.requireEnabled('attendance.class_report'), async (req, res) => {
  const cls = await classesQuery().where('c.id', req.params.id).first();
  if (!cls) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  if (!(await canViewClass(req, cls.id))) return res.status(403).render('errors/403', { title: 'دسترسی غیرمجاز' });
  const to = parseDate(req.query.to); const from = req.query.from ? parseDate(req.query.from) : J.addDays(to, -30);
  const students = await db.table('students').where('class_id', cls.id).where('status', 'active').orderBy('last_name').orderBy('first_name').all();
  const rows = await db.table('attendance').select('student_id', 'status', 'COUNT(*) as c').where('class_id', cls.id).where('session_key', 'daily').whereBetween('date', from, to).groupBy('student_id', 'status').all();
  const stats = {};
  rows.forEach((r) => { stats[r.student_id] = stats[r.student_id] || {}; stats[r.student_id][r.status] = Number(r.c); });
  const days = (await db.table('attendance').select('date').distinct().where('class_id', cls.id).where('session_key', 'daily').whereBetween('date', from, to).all()).length;
  const threshold = settings.getInt('attendance_alert_threshold', 3);
  res.render(v('class'), { title: 'گزارش حضور کلاس ' + cls.title, cls, students, stats, from, to, days, threshold });
});

router.get('/report/daily', auth.requireRoleOrPermission(['admin'], 'attendance.view_all', 'attendance.manage_all'), modules.requireEnabled('attendance.daily_report'), async (req, res) => {
  const date = parseDate(req.query.date);
  const classes = await classesQuery().orderBy('g.sort_order').orderBy('c.title').all();
  const rows = await db.table('attendance').select('class_id', 'status', 'COUNT(*) as c').where('date', date).where('session_key', 'daily').groupBy('class_id', 'status').all();
  const stats = {}; rows.forEach((r) => { stats[r.class_id] = stats[r.class_id] || {}; stats[r.class_id][r.status] = Number(r.c); });
  const absentees = await db.table('attendance as a').join('students as s', 's.id', 'a.student_id').join('classes as c', 'c.id', 'a.class_id').select('a.status', 'a.note', 'a.minutes_late', 's.id', 's.first_name', 's.last_name', 's.father_phone', 's.mother_phone', 'c.title as class_title').where('a.date', date).where('a.session_key', 'daily').whereIn('a.status', ['absent', 'late', 'excused', 'leave']).orderBy('c.title').orderBy('s.last_name').all();
  const print = req.query.print === '1';
  res.render(v('daily'), { title: 'گزارش روزانه ' + J.formatDate(date), layout: print ? 'layouts/print' : undefined, print, date, classes, stats, absentees });
});

router.get('/report/monthly', modules.requireEnabled('attendance.monthly_report'), async (req, res) => {
  const t = await teacherInfo(req);
  let cq = classesQuery();
  if (t) cq = cq.where((b) => b.whereIn('c.id', t.homeroom.length ? t.homeroom : [-1]).orWhereRaw('c.id IN (SELECT class_id FROM class_subjects WHERE teacher_id = ?)', [t.id]));
  const classes = await cq.orderBy('g.sort_order').orderBy('c.title').all();
  const cur = J.currentJalali();
  const jy = parseInt(req.query.jy, 10) || cur.jy; const jm = parseInt(req.query.jm, 10) || cur.jm;
  const classId = Number(req.query.class_id) || (classes[0] ? classes[0].id : null);
  let students = [], grid = {}, cls = null;
  if (classId) {
    if (!(await canViewClass(req, classId))) return res.status(403).render('errors/403', { title: 'دسترسی غیرمجاز' });
    cls = classes.find((c) => c.id === classId) || await classesQuery().where('c.id', classId).first();
    students = await db.table('students').where('class_id', classId).where('status', 'active').orderBy('last_name').orderBy('first_name').all();
    const range = J.jalaliMonthRange(jy, jm);
    const rows = await db.table('attendance').select('student_id', 'date', 'status').where('class_id', classId).where('session_key', 'daily').whereBetween('date', range.start, range.end).all();
    rows.forEach((r) => { grid[r.student_id] = grid[r.student_id] || {}; grid[r.student_id][J.toJalaliParts(r.date).jd] = r.status; });
  }
  const range = J.jalaliMonthRange(jy, jm);
  const dayInfo = []; for (let d = 1; d <= J.monthLength(jy, jm); d++) { const iso = J.toGregorian(`${jy}/${jm}/${d}`); dayInfo.push({ d, iso, wd: J.weekdayIndex(iso), school: isSchoolDay(iso) }); }
  const print = req.query.print === '1';
  res.render(v('monthly'), { title: 'دفتر حضور ماهانه', layout: print ? 'layouts/print' : undefined, print, classes, cls, classId, jy, jm, students, grid, dayInfo, range });
});

router.get('/export', auth.requireRoleOrPermission(['admin', 'teacher'], 'attendance.view_all', 'attendance.manage_all'), modules.requireEnabled('attendance.export'), async (req, res) => {
  const to = parseDate(req.query.to); const from = req.query.from ? parseDate(req.query.from) : J.addDays(to, -30);
  const q = db.table('attendance as a').join('students as s', 's.id', 'a.student_id').join('classes as c', 'c.id', 'a.class_id').leftJoin('class_subjects as cs', 'cs.id', 'a.class_subject_id').leftJoin('subjects as sb', 'sb.id', 'cs.subject_id')
    .select('a.*', 's.first_name', 's.last_name', 's.student_number', 'c.title as class_title', 'sb.title as subject_title').whereBetween('a.date', from, to).orderBy('a.date').orderBy('c.title').orderBy('s.last_name');
  if (req.query.class_id) { if (!(await canViewClass(req, req.query.class_id))) return res.status(403).send('forbidden'); q.where('a.class_id', req.query.class_id); }
  else if (req.user.role === 'teacher') { const t = await teacherInfo(req); q.whereIn('a.class_id', [...new Set([...t.homeroom, ...t.teaching.map((x) => x.class_id)])]); }
  const rows = await q.limit(20000).all();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="attendance-${from}-${to}.csv"`);
  res.send(utils.toCSV(rows, [{ label: 'تاریخ', value: (r) => J.toJalali(r.date) }, { label: 'کلاس', value: (r) => r.class_title }, { label: 'شماره', value: (r) => r.student_number }, { label: 'نام', value: (r) => r.first_name + ' ' + r.last_name }, { label: 'نوع', value: (r) => r.subject_title || 'روزانه' }, { label: 'وضعیت', value: (r) => utils.ATT_STATUS[r.status] }, { label: 'دقیقه تأخیر', value: (r) => r.minutes_late || '' }, { label: 'توضیح', value: (r) => r.note || '' }]));
});

// ---------- هشدارها ----------
router.get('/alerts', auth.requireRoleOrPermission(['admin', 'teacher'], 'attendance.view_all', 'attendance.manage_all'), modules.requireEnabled('attendance.alerts'), async (req, res) => {
  const threshold = Math.max(1, settings.getInt('attendance_alert_threshold', 3));
  const from = J.addDays(J.todayISO(), -30);
  const q = db.table('attendance as a').join('students as s', 's.id', 'a.student_id').join('classes as c', 'c.id', 'a.class_id').select('s.id', 's.first_name', 's.last_name', 's.photo', 's.father_phone', 's.mother_phone', 'c.title as class_title', 'c.id as class_id', 'COUNT(*) as absences', 'MAX(a.date) as last_date')
    .where('a.session_key', 'daily').where('a.status', 'absent').where('a.date', '>=', from).groupBy('s.id', 's.first_name', 's.last_name', 's.photo', 's.father_phone', 's.mother_phone', 'c.title', 'c.id').having('COUNT(*) >= ?', [threshold]).orderBy('absences', 'desc');
  if (req.user.role === 'teacher') { const t = await teacherInfo(req); q.whereIn('a.class_id', [...new Set([...t.homeroom, ...t.teaching.map((x) => x.class_id)])]); }
  const rows = await q.all();
  const lates = await db.table('attendance as a').join('students as s', 's.id', 'a.student_id').join('classes as c', 'c.id', 'a.class_id').select('s.id', 's.first_name', 's.last_name', 'c.title as class_title', 'COUNT(*) as lates').where('a.session_key', 'daily').where('a.status', 'late').where('a.date', '>=', from).groupBy('s.id', 's.first_name', 's.last_name', 'c.title').having('COUNT(*) >= ?', [threshold]).orderBy('lates', 'desc').limit(30).all();
  res.render(v('alerts'), { title: 'هشدار غیبت‌های مکرر', rows, lates, threshold, from });
});

// ---------- درخواست موجه ----------
router.get('/excuses', modules.requireEnabled('attendance.excuses'), async (req, res) => {
  let q = db.table('absence_excuses as e').join('students as s', 's.id', 'e.student_id').leftJoin('classes as c', 'c.id', 's.class_id').leftJoin('users as u', 'u.id', 'e.reviewed_by').select('e.*', 's.first_name', 's.last_name', 's.user_id', 'c.title as class_title', 'u.name as reviewer');
  let me = null;
  if (req.user.role === 'student' || req.user.role === 'parent') { me = await people.studentOf(req); q = q.where('e.student_id', me ? me.id : -1); }
  else if (req.user.role === 'teacher') { const t = await teacherInfo(req); q = q.whereIn('s.class_id', [...new Set([...t.homeroom, ...t.teaching.map((x) => x.class_id)])]); }
  const status = req.query.status || ((req.user.role === 'student' || req.user.role === 'parent') ? '' : 'pending');
  if (status) q = q.where('e.status', status);
  const result = await q.orderBy('e.id', 'desc').paginate(req.query.page, 20);
  const myAbsences = me ? await db.table('attendance').where('student_id', me.id).where('status', 'absent').where('session_key', 'daily').whereRaw('id NOT IN (SELECT COALESCE(attendance_id, 0) FROM absence_excuses)').orderBy('date', 'desc').limit(20).all() : [];
  res.render(v('excuses'), { title: 'درخواست‌های موجه‌شدن غیبت', result, status, me, myAbsences, query: req.query });
});
router.post('/excuses', auth.requireRole('student', 'parent'), modules.requireEnabled('attendance.excuses'), ...upload.form('excuses', 'single', 'file', { maxMb: 5 }), async (req, res) => {
  const me = await people.studentOf(req);
  if (!me) return res.redirect('/attendance/excuses');
  if (req.uploadError) { req.flash('danger', req.uploadError); return res.redirect('/attendance/excuses'); }
  const att = await db.table('attendance').where({ id: req.body.attendance_id, student_id: me.id }).first();
  const reason = utils.normalizePersian(req.body.reason || '');
  if (!att || reason.length < 5) { req.flash('danger', 'غیبت را انتخاب و دلیل را (حداقل ۵ حرف) بنویسید.'); return res.redirect('/attendance/excuses'); }
  if (await db.exists('absence_excuses', { attendance_id: att.id })) { req.flash('warning', 'برای این غیبت قبلاً درخواست ثبت شده است.'); return res.redirect('/attendance/excuses'); }
  await db.insert('absence_excuses', { student_id: me.id, date: att.date, attendance_id: att.id, reason, file_path: req.file ? upload.relPath(req.file) : null, status: 'pending', created_at: db.now() });
  // اعلان به مدیر و معلم راهنما
  const cls = me.class_id ? await db.table('classes as c').leftJoin('teachers as t', 't.id', 'c.teacher_id').select('t.user_id').where('c.id', me.class_id).first() : null;
  const admins = await db.table('users').where({ role: 'admin', status: 'active' }).pluck('id');
  await notify.push([...admins, cls && cls.user_id], { title: 'درخواست موجه‌شدن غیبت', body: `${me.first_name} ${me.last_name} برای غیبت ${J.formatDate(att.date)} درخواست ثبت کرد.`, link: '/attendance/excuses', type: 'info' });
  req.flash('success', 'درخواست شما ثبت شد و پس از بررسی نتیجه اعلام می‌شود.');
  res.redirect('/attendance/excuses');
});
router.post('/excuses/:id/review', auth.requireRoleOrPermission(['admin', 'teacher'], 'attendance.excuses'), modules.requireEnabled('attendance.excuses'), async (req, res) => {
  const ex = await db.table('absence_excuses as e').join('students as s', 's.id', 'e.student_id').select('e.*', 's.class_id', 's.user_id', 's.first_name', 's.last_name').where('e.id', req.params.id).first();
  if (!ex) return res.redirect('/attendance/excuses');
  if (!(await canViewClass(req, ex.class_id))) return res.status(403).render('errors/403', { title: 'دسترسی غیرمجاز' });
  const status = req.body.action === 'approve' ? 'approved' : 'rejected';
  await db.update('absence_excuses', { status, reviewed_by: req.user.id, reviewed_at: db.now(), review_note: utils.normalizePersian(req.body.note || '') || null }, { id: ex.id });
  if (status === 'approved' && ex.attendance_id) await db.update('attendance', { status: 'excused', note: 'موجه (تأیید درخواست)', updated_at: db.now() }, { id: ex.attendance_id });
  await notify.push([ex.user_id], { title: status === 'approved' ? 'غیبت شما موجه شد' : 'درخواست موجه‌شدن رد شد', body: `غیبت ${J.formatDate(ex.date)}${req.body.note ? ' — ' + req.body.note : ''}`, link: '/attendance/excuses', type: status === 'approved' ? 'success' : 'danger' });
  await activity.log(req, 'review', 'absence_excuses', ex.id, `${status === 'approved' ? 'تأیید' : 'رد'} درخواست موجه ${ex.first_name} ${ex.last_name}`);
  req.flash('success', status === 'approved' ? 'غیبت موجه شد.' : 'درخواست رد شد.');
  res.redirect('/attendance/excuses');
});

// ---------- حضور کارکنان ----------
router.get('/staff', auth.requireRoleOrPermission(['admin'], 'hr.manage'), modules.requireEnabled('attendance.staff'), async (req, res) => {
  const date = parseDate(req.query.date);
  const staff = await db.table('users').whereIn('role', ['teacher', 'staff']).where('status', 'active').orderBy('role').orderBy('name').all();
  const rows = Object.fromEntries((await db.table('staff_attendance').where('date', date).all()).map((r) => [r.user_id, r]));
  const month = J.currentJalali(); const range = J.jalaliMonthRange(month.jy, month.jm);
  const monthStats = {}; (await db.table('staff_attendance').select('user_id', 'status', 'COUNT(*) as c').whereBetween('date', range.start, range.end).groupBy('user_id', 'status').all()).forEach((r) => { monthStats[r.user_id] = monthStats[r.user_id] || {}; monthStats[r.user_id][r.status] = Number(r.c); });
  res.render(v('staff'), { title: 'حضور و غیاب کارکنان', date, staff, rows, monthStats });
});
router.post('/staff', auth.requireRoleOrPermission(['admin'], 'hr.manage'), modules.requireEnabled('attendance.staff'), async (req, res) => {
  const date = parseDate(req.body.date);
  const staff = await db.table('users').whereIn('role', ['teacher', 'staff']).where('status', 'active').all();
  const now = db.now();
  for (const u of staff) {
    const status = ['present', 'absent', 'late', 'leave', 'mission'].includes(req.body['status_' + u.id]) ? req.body['status_' + u.id] : 'present';
    const data = { status, check_in: req.body['in_' + u.id] || null, check_out: req.body['out_' + u.id] || null, note: utils.normalizePersian(req.body['note_' + u.id] || '') || null, recorded_by: req.user.id };
    const ex = await db.table('staff_attendance').where({ user_id: u.id, date }).first();
    if (ex) await db.update('staff_attendance', data, { id: ex.id }); else await db.insert('staff_attendance', Object.assign({ user_id: u.id, date, created_at: now }, data));
  }
  await activity.log(req, 'attendance', 'staff', null, 'ثبت حضور کارکنان ' + J.formatDate(date));
  req.flash('success', 'حضور کارکنان ثبت شد.'); res.redirect('/attendance/staff?date=' + date);
});

module.exports = router;
