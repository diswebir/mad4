'use strict';
const express = require('express');
const db = require('../../core/db');
const auth = require('../../core/auth');
const modules = require('../../core/modules');
const utils = require('../../core/utils');
const J = require('../../core/jalali');
const activity = require('../../core/activity');
const notify = require('../../core/notify');
const settings = require('../../core/settings');
const people = require('../../core/people');
const upload = require('../../core/upload');
const svc = require('./service');

const router = express.Router();
const v = (n) => `../modules/parents/views/${n}`;
const E = (k) => modules.isEnabled(k);
const manage = auth.requireRoleOrPermission(['admin'], 'parents.manage');

router.use(auth.requireAuth);

// ---------- پنل ولی ----------
router.get('/panel', auth.requireRole('parent'), modules.requireEnabled('parents.panel'), async (req, res) => {
  const kids = await people.childrenOf(req.user.id);
  const student = await people.studentOf(req);
  const today = J.todayISO();
  const d = { title: 'پنل اولیا', kids, student, today, homeroom: null, att: null, todayStatus: null, grades: [], avg: null, exams: [], homework: [], due: 0, tickets: [], announcements: [], events: [], unreadMsgs: 0, RELATIONS: utils.RELATIONS, ATT_STATUS: utils.ATT_STATUS, ATT_COLORS: utils.ATT_COLORS };
  if (!student) return res.render(v('dashboard'), d);
  d.homeroom = student.class_id ? await db.table('classes as c').leftJoin('teachers as t', 't.id', 'c.teacher_id').leftJoin('users as u', 'u.id', 't.user_id').select('u.name', 'u.phone', 'u.id as user_id').where('c.id', student.class_id).first() : null;
  if (E('attendance')) {
    const j = J.currentJalali(); const monthStart = J.jalaliMonthRange(j.jy, j.jm).start;
    d.att = { present: 0, absent: 0, late: 0, excused: 0, leave: 0, total: 0 };
    for (const r of await db.table('attendance').select('status', 'COUNT(*) as c').where('student_id', student.id).where('session_key', 'daily').where('date', '>=', monthStart).groupBy('status').all()) { d.att[r.status] = Number(r.c); d.att.total += Number(r.c); }
    d.todayStatus = (await db.table('attendance').where({ student_id: student.id, date: today, session_key: 'daily' }).first() || {}).status || null;
    d.attRecent = await db.table('attendance').where('student_id', student.id).where('session_key', 'daily').whereIn('status', ['absent', 'late', 'excused', 'leave']).orderBy('date', 'desc').limit(8).all();
  }
  if (E('exams.student_view')) {
    const gq = db.table('grades as g').join('exams as e', 'e.id', 'g.exam_id').leftJoin('subjects as s', 's.id', 'e.subject_id').select('g.*', 'e.title as exam_title', 'e.max_score', 'e.date', 's.title as subject_title').where('g.student_id', student.id);
    if (E('exams.publish')) gq.where('e.is_published', 1);
    d.grades = await gq.orderBy('e.date', 'desc').limit(6).all();
    const avg = await db.table('grades as g').join('exams as e', 'e.id', 'g.exam_id').select('AVG(g.score * 20.0 / e.max_score) as avg').where('g.student_id', student.id).whereNotNull('g.score').first();
    d.avg = avg && avg.avg != null ? Math.round(avg.avg * 100) / 100 : null;
  }
  if (E('exams.schedule')) d.exams = await db.table('exams as e').leftJoin('subjects as s', 's.id', 'e.subject_id').select('e.*', 's.title as subject_title').where('e.class_id', student.class_id || 0).where('e.date', '>=', today).orderBy('e.date').limit(5).all();
  if (E('homework')) d.homework = await db.table('homework as h').leftJoin('subjects as s', 's.id', 'h.subject_id').select('h.*', 's.title as subject_title', 'hs.status as sub_status', 'hs.score as sub_score').joinRaw('LEFT JOIN `homework_submissions` AS `hs` ON `hs`.`homework_id` = `h`.`id` AND `hs`.`student_id` = ?', [student.id]).where('h.class_id', student.class_id || 0).orderBy('h.due_date', 'desc').limit(6).all();
  if (E('finance.student_view')) { const r = await db.table('invoices').select('SUM(amount - paid_amount) as due').where('student_id', student.id).whereIn('status', ['unpaid', 'partial']).first(); d.due = Number((r && r.due) || 0); }
  if (E('tickets')) d.tickets = await db.table('tickets').where((b) => b.where('created_by', req.user.id).orWhere('student_id', student.id)).orderBy('id', 'desc').limit(5).all();
  if (E('announcements')) d.announcements = await db.table('announcements as a').select('a.id', 'a.title', 'a.created_at', 'a.is_pinned').where('a.is_active', 1).where((b) => b.whereNull('a.publish_at').orWhere('a.publish_at', '<=', today)).where((b) => b.whereNull('a.expires_at').orWhere('a.expires_at', '>=', today)).where((b) => { b.whereIn('a.audience', ['all', 'students', 'parents']); if (student.class_id) b.orWhere((x) => x.where('a.audience', 'class').where('a.class_id', student.class_id)); }).orderBy('a.is_pinned', 'desc').orderBy('a.id', 'desc').limit(5).all();
  if (E('calendar')) d.events = (await db.table('events').where('start_date', '>=', today).where((b) => { b.whereIn('audience', ['all', 'students', 'parents']); if (student.class_id) b.orWhere((x) => x.where('audience', 'class').where('class_id', student.class_id)); }).orderBy('start_date').limit(5).all()).map((e) => Object.assign(e, { date: e.start_date }));
  if (E('messages')) d.unreadMsgs = await db.table('messages').where({ receiver_id: req.user.id, is_read: 0, deleted_by_receiver: 0 }).count();
  if (E('students.birthdays') && student.birth_date) d.birthday = require('../students/birthdays').nextBirthday(student.birth_date, today);
  res.render(v('dashboard'), d);
});
router.get('/switch/:id', auth.requireRole('parent'), async (req, res) => {
  const kids = await people.childrenOf(req.user.id);
  const k = kids.find((x) => x.id === Number(req.params.id));
  if (k) req.session.childId = k.id;
  const back = String(req.query.back || '/parents/panel');
  res.redirect(back.startsWith('/') ? back : '/parents/panel');
});

// ---------- مدیریت اولیا ----------
router.get('/', manage, async (req, res) => {
  const q = utils.normalizePersian(String(req.query.q || '')).trim();
  const page = Math.max(1, Number(req.query.page) || 1), per = 25;
  const base = db.table('parents as p').leftJoin('users as u', 'u.id', 'p.user_id');
  if (q) base.where((b) => b.where('p.name', 'like', `%${q}%`).orWhere('p.phone', 'like', `%${J.toEnglishDigits(q)}%`).orWhere('u.username', 'like', `%${J.toEnglishDigits(q)}%`).orWhere('p.national_id', 'like', `%${J.toEnglishDigits(q)}%`));
  if (req.query.status) base.where('u.status', req.query.status);
  const total = await base.clone().count();
  const rows = await base.clone().select('p.*', 'u.username', 'u.status as user_status', 'u.last_login_at', 'u.login_count').orderBy('p.id', 'desc').limit(per).offset((page - 1) * per).all();
  const ids = rows.map((r) => r.id);
  const kids = ids.length ? await db.table('student_parents as sp').join('students as s', 's.id', 'sp.student_id').leftJoin('classes as c', 'c.id', 's.class_id').select('sp.parent_id', 's.id', 's.first_name', 's.last_name', 'c.title as class_title').whereIn('sp.parent_id', ids).all() : [];
  const byParent = {}; for (const k of kids) (byParent[k.parent_id] = byParent[k.parent_id] || []).push(k);
  const stats = { parents: await db.table('parents').count(), linked: Number(((await db.table('student_parents').select('COUNT(DISTINCT student_id) as c').first()) || {}).c || 0), students: await db.table('students').where('status', 'active').count(), active: await db.table('users').where({ role: 'parent', status: 'active' }).count() };
  res.render(v('index'), { title: 'اولیا', rows, byParent, total, page, pages: Math.ceil(total / per), q, status: req.query.status || '', stats, RELATIONS: utils.RELATIONS });
});
router.post('/bulk', manage, async (req, res) => {
  const report = await svc.bulkCreate({ sendSms: req.body.send_sms === '1' && settings.getBool('sms_enabled', false) });
  await activity.log(req, 'create', 'parents', null, `ساخت گروهی حساب اولیا: ${report.created} جدید، ${report.linked} پیوند، ${report.skipped} ردشده`);
  req.flash(report.errors.length ? 'warning' : 'success', `ساخت گروهی انجام شد: ${J.toPersianDigits(report.created)} حساب جدید، ${J.toPersianDigits(report.linked)} پیوند به حساب موجود، ${J.toPersianDigits(report.skipped)} مورد رد شد.` + (report.errors.length ? ` (${J.toPersianDigits(report.errors.length)} خطا — اولین: ${report.errors[0]})` : ''));
  res.redirect('/parents');
});
router.get('/export.csv', manage, async (req, res) => {
  const rows = await db.table('parents as p').leftJoin('users as u', 'u.id', 'p.user_id').select('p.*', 'u.username', 'u.status as user_status').orderBy('p.name').all();
  const kids = await db.table('student_parents as sp').join('students as s', 's.id', 'sp.student_id').select('sp.parent_id', 's.first_name', 's.last_name', 's.student_number').all();
  const byP = {}; for (const k of kids) (byP[k.parent_id] = byP[k.parent_id] || []).push(`${k.first_name} ${k.last_name} (${k.student_number})`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="parents.csv"');
  res.send(utils.toCSV(rows, [{ label: 'نام', key: 'name' }, { label: 'نسبت', value: (r) => utils.RELATIONS[r.relation] || r.relation }, { label: 'موبایل', key: 'phone' }, { label: 'کد ملی', value: (r) => r.national_id || '' }, { label: 'نام کاربری', value: (r) => r.username || '' }, { label: 'وضعیت', value: (r) => r.user_status || '' }, { label: 'فرزندان', value: (r) => (byP[r.id] || []).join('؛ ') }]));
});
router.post('/link/:studentId', manage, async (req, res) => {
  const s = await db.findById('students', req.params.studentId);
  if (!s) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  try {
    const r = await svc.linkParent(s.id, req.body, { sendSms: req.body.send_sms === '1' });
    await activity.log(req, 'create', 'parents', r.parentId, `${r.created ? 'ساخت' : 'پیوند'} حساب ولی برای ${s.first_name} ${s.last_name}`);
    req.flash('success', r.created ? `حساب ولی ساخته شد. نام کاربری: ${r.username} — رمز: ${r.password}` : (r.linked ? `ولی موجود (${r.username}) به این دانش‌آموز پیوند خورد.` : 'این ولی قبلاً به دانش‌آموز پیوند خورده بود.'));
  } catch (e) { req.flash('danger', e.message); }
  res.redirect(`/students/${s.id}?tab=parents`);
});
router.get('/:id', manage, async (req, res) => {
  const p = await db.table('parents as p').leftJoin('users as u', 'u.id', 'p.user_id').select('p.*', 'u.username', 'u.status as user_status', 'u.last_login_at', 'u.login_count', 'u.must_change_password').where('p.id', req.params.id).first();
  if (!p) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const kids = await db.table('student_parents as sp').join('students as s', 's.id', 'sp.student_id').leftJoin('classes as c', 'c.id', 's.class_id').select('s.id', 's.first_name', 's.last_name', 's.student_number', 's.status', 's.photo', 'c.title as class_title', 'sp.relation', 'sp.is_primary').where('sp.parent_id', p.id).all();
  const logins = p.user_id ? await db.table('login_logs').where('user_id', p.user_id).orderBy('id', 'desc').limit(8).all() : [];
  const candidates = await db.table('students as s').leftJoin('classes as c', 'c.id', 's.class_id').select('s.id', 's.first_name', 's.last_name', 's.student_number', 'c.title as class_title').where('s.status', 'active').where((b) => { b.where('s.father_phone', p.phone).orWhere('s.mother_phone', p.phone).orWhere('s.guardian_phone', p.phone); if (p.national_id) b.orWhere('s.father_national_id', p.national_id).orWhere('s.mother_national_id', p.national_id); }).whereNotIn('s.id', kids.map((k) => k.id).concat([0])).all();
  const students = await db.table('students as s').leftJoin('classes as c', 'c.id', 's.class_id').select('s.id', 's.first_name', 's.last_name', 's.student_number', 'c.title as class_title').where('s.status', 'active').orderBy('s.last_name').all();
  res.render(v('show'), { title: `ولی: ${p.name}`, p, kids, logins, candidates, students, RELATIONS: utils.RELATIONS });
});
router.post('/:id', manage, async (req, res) => {
  const p = await db.findById('parents', req.params.id);
  if (!p) return res.redirect('/parents');
  const b = utils.cleanBody(req.body, { fields: ['name', 'phone', 'national_id', 'relation', 'job', 'education', 'address', 'notes'] });
  const phone = svc.normPhone(b.phone);
  if (!b.name || !/^09\d{9}$/.test(phone)) { req.flash('danger', 'نام و موبایل معتبر الزامی است'); return res.redirect('/parents/' + p.id); }
  await db.update('parents', { name: b.name, phone, national_id: b.national_id ? J.toEnglishDigits(b.national_id) : null, relation: utils.RELATIONS[b.relation] ? b.relation : p.relation, job: b.job || null, education: b.education || null, address: b.address || null, notes: b.notes || null, updated_at: db.now() }, { id: p.id });
  if (p.user_id) await db.update('users', { name: b.name, phone, updated_at: db.now() }, { id: p.user_id });
  await activity.log(req, 'update', 'parents', p.id, `ویرایش ولی ${b.name}`);
  req.flash('success', 'ذخیره شد'); res.redirect('/parents/' + p.id);
});
router.post('/:id/attach', manage, async (req, res) => {
  const p = await db.findById('parents', req.params.id);
  const s = await db.findById('students', req.body.student_id);
  if (!p || !s) { req.flash('danger', 'دانش‌آموز نامعتبر'); return res.redirect('/parents/' + req.params.id); }
  if (!(await db.table('student_parents').where({ student_id: s.id, parent_id: p.id }).exists())) {
    const hasPrimary = await db.table('student_parents').where({ student_id: s.id, is_primary: 1 }).exists();
    await db.insert('student_parents', { student_id: s.id, parent_id: p.id, relation: utils.RELATIONS[req.body.relation] ? req.body.relation : p.relation, is_primary: hasPrimary ? 0 : 1, created_at: db.now() });
  }
  await activity.log(req, 'update', 'parents', p.id, `پیوند ${p.name} به ${s.first_name} ${s.last_name}`);
  req.flash('success', 'پیوند برقرار شد'); res.redirect('/parents/' + p.id);
});
router.post('/:id/unlink/:studentId', manage, async (req, res) => {
  await db.remove('student_parents', { parent_id: Number(req.params.id), student_id: Number(req.params.studentId) });
  await activity.log(req, 'delete', 'parents', Number(req.params.id), `حذف پیوند ولی با دانش‌آموز #${req.params.studentId}`);
  req.flash('success', 'پیوند حذف شد');
  res.redirect(req.query.back ? String(req.query.back) : `/students/${req.params.studentId}?tab=parents`);
});
router.post('/:id/status', manage, async (req, res) => {
  const p = await db.findById('parents', req.params.id);
  if (p && p.user_id) await db.update('users', { status: req.body.status === 'inactive' ? 'inactive' : 'active', updated_at: db.now() }, { id: p.user_id });
  req.flash('success', 'وضعیت حساب به‌روزرسانی شد'); res.redirect('/parents/' + req.params.id);
});
router.post('/:id/reset-password', manage, async (req, res) => {
  const p = await db.findById('parents', req.params.id);
  if (!p || !p.user_id) return res.redirect('/parents');
  const pw = req.body.password && req.body.password.length >= 6 ? req.body.password : String(Math.floor(100000 + Math.random() * 900000));
  await db.update('users', { password: await auth.hashPassword(pw), must_change_password: 1, updated_at: db.now() }, { id: p.user_id });
  const user = await db.findById('users', p.user_id);
  if (req.body.send_sms === '1') await notify.sms(p.phone, `${settings.get('school_name', 'مدرسه')}\nرمز عبور جدید حساب اولیا\nنام کاربری: ${user.username}\nرمز: ${pw}`, 'parent_credentials');
  await activity.log(req, 'update', 'parents', p.id, `بازنشانی رمز ولی ${p.name}`);
  req.flash('success', `رمز جدید: ${pw}` + (req.body.send_sms === '1' ? ' (پیامک شد)' : ''));
  res.redirect('/parents/' + p.id);
});
router.post('/:id/delete', manage, async (req, res) => {
  const p = await db.findById('parents', req.params.id);
  if (!p) return res.redirect('/parents');
  await db.remove('student_parents', { parent_id: p.id });
  await db.remove('parents', { id: p.id });
  if (p.user_id) await db.remove('users', { id: p.user_id, role: 'parent' });
  await activity.log(req, 'delete', 'parents', p.id, `حذف ولی ${p.name}`);
  req.flash('success', 'حساب ولی حذف شد'); res.redirect('/parents');
});
void upload;
module.exports = router;
