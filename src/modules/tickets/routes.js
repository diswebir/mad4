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

const CATEGORIES = { academic: 'آموزشی', attendance: 'حضور و غیاب', finance: 'مالی', technical: 'فنی / سامانه', admin: 'اداری', discipline: 'انضباطی', leave: 'مرخصی و خروج', suggestion: 'پیشنهاد و انتقاد', other: 'سایر' };
const STATUSES = { open: 'باز', answered: 'پاسخ داده شده', pending: 'در انتظار کاربر', closed: 'بسته' };
const DEPARTMENTS = { admin: 'مدیریت مدرسه', teacher: 'معلم کلاس', staff: 'دفتر / امور اداری' };
const isStaff = (req) => ['admin', 'staff'].includes(req.user.role);

async function studentOf(userId) { return db.table('students as s').leftJoin('classes as c', 'c.id', 's.class_id').select('s.*', 'c.title as class_title', 'c.teacher_id as homeroom_teacher_id').where('s.user_id', userId).first(); }
async function homeroomUserId(classId) { const r = await db.table('classes as c').join('teachers as t', 't.id', 'c.teacher_id').select('t.user_id').where('c.id', classId).first(); return r ? r.user_id : null; }
async function teacherClassIds(userId) { const t = await db.table('teachers').where('user_id', userId).first(); if (!t) return []; return db.table('classes').where('teacher_id', t.id).pluck('id'); }

/** محدودهٔ دسترسی کاربر به تیکت‌ها */
async function scope(req, q) {
  if (isStaff(req)) return q;
  if (req.user.role === 'teacher') {
    const classIds = await teacherClassIds(req.user.id);
    return q.where((b) => { b.where('t.assigned_to', req.user.id).orWhere('t.created_by', req.user.id); if (classIds.length) b.orWhereIn('t.class_id', classIds); });
  }
  return q.where('t.created_by', req.user.id);
}
async function canView(req, t) {
  if (isStaff(req)) return true;
  if (t.created_by === req.user.id || t.assigned_to === req.user.id) return true;
  if (req.user.role === 'teacher' && t.class_id) return (await teacherClassIds(req.user.id)).includes(t.class_id);
  return false;
}
async function nextCode() {
  let code;
  do { code = 'TK-' + utils.randomDigits(5); } while (await db.exists('tickets', { code }));
  return code;
}
function baseQuery() {
  return db.table('tickets as t').leftJoin('users as u', 'u.id', 't.created_by').leftJoin('users as a', 'a.id', 't.assigned_to').leftJoin('students as s', 's.id', 't.student_id').leftJoin('classes as c', 'c.id', 't.class_id')
    .select('t.*', 'u.name as creator_name', 'u.role as creator_role', 'u.avatar as creator_avatar', 'a.name as assignee_name', 'c.title as class_title', 's.first_name', 's.last_name', '(SELECT COUNT(*) FROM ticket_replies r WHERE r.ticket_id = t.id AND r.is_internal = 0) as replies_count');
}
async function assignees() {
  const staff = await db.table('users').select('id', 'name', 'role').whereIn('role', ['admin', 'staff']).where('status', 'active').orderBy('name').all();
  const teachers = await db.table('users as u').join('teachers as t', 't.user_id', 'u.id').select('u.id', 'u.name', 'u.role').where('u.status', 'active').orderBy('u.name').all();
  return staff.concat(teachers);
}
const slaHours = () => settings.getInt('ticket_sla_hours', 48) || 48;

// ---------- فهرست ----------
router.get('/', async (req, res) => {
  const q = await scope(req, baseQuery());
  const f = { status: req.query.status || '', priority: req.query.priority || '', category: req.query.category || '', q: utils.normalizePersian(req.query.q || ''), mine: req.query.mine || '' };
  if (f.status) q.where('t.status', f.status);
  if (f.priority && E('tickets.priority')) q.where('t.priority', f.priority);
  if (f.category && E('tickets.categories')) q.where('t.category', f.category);
  if (f.mine === '1' && isStaff(req)) q.where('t.assigned_to', req.user.id);
  if (f.mine === 'unassigned' && isStaff(req)) q.whereNull('t.assigned_to');
  if (f.q) q.search(f.q, ['t.subject', 't.code', 'u.name', 's.first_name', 's.last_name']);
  const sort = req.query.sort === 'created' ? 't.created_at' : req.query.sort === 'priority' ? 't.priority' : 't.last_reply_at';
  q.orderByRaw(`CASE t.status WHEN 'open' THEN 0 WHEN 'pending' THEN 1 WHEN 'answered' THEN 2 ELSE 3 END`).orderBy(sort, 'desc');
  const result = await q.paginate(req.query.page, settings.getInt('items_per_page', 20));
  const counts = Object.fromEntries((await (await scope(req, db.table('tickets as t'))).select('t.status', 'COUNT(*) as c').groupBy('t.status').all()).map((r) => [r.status, Number(r.c)]));
  let sla = [];
  if (E('tickets.sla') && isStaff(req)) {
    const limit = new Date(Date.now() - slaHours() * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    sla = await baseQuery().where('t.status', 'open').where('t.last_reply_at', '<', limit).orderBy('t.last_reply_at').limit(5).all();
  }
  res.render(v('index'), { title: 'تیکت‌ها', result, f, counts, sla, slaHours: slaHours(), CATEGORIES, STATUSES, isStaff: isStaff(req), query: req.query });
});

router.get('/export', auth.requireRole('admin', 'staff'), modules.requireEnabled('tickets.export'), async (req, res) => {
  const rows = await baseQuery().orderBy('t.id', 'desc').limit(5000).all();
  await activity.log(req, 'export', 'tickets', null, 'خروجی تیکت‌ها');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="tickets-${J.todayISO()}.csv"`);
  res.send(utils.toCSV(rows, [{ label: 'کد', value: (r) => r.code }, { label: 'موضوع', value: (r) => r.subject }, { label: 'ایجادکننده', value: (r) => r.creator_name }, { label: 'کلاس', value: (r) => r.class_title || '' }, { label: 'دسته', value: (r) => CATEGORIES[r.category] || r.category }, { label: 'اولویت', value: (r) => utils.PRIORITIES[r.priority] || '' }, { label: 'وضعیت', value: (r) => STATUSES[r.status] }, { label: 'ارجاع به', value: (r) => r.assignee_name || '' }, { label: 'تاریخ', value: (r) => J.formatDateTime(r.created_at) }, { label: 'آخرین پاسخ', value: (r) => J.formatDateTime(r.last_reply_at) }, { label: 'امتیاز', value: (r) => r.rating || '' }]));
});

// ---------- آمار ----------
router.get('/stats', auth.requireRole('admin', 'staff'), modules.requireEnabled('tickets.stats'), async (req, res) => {
  const byStatus = Object.fromEntries((await db.table('tickets').select('status', 'COUNT(*) as c').groupBy('status').all()).map((r) => [r.status, Number(r.c)]));
  const byCategory = await db.table('tickets').select('category', 'COUNT(*) as c').groupBy('category').orderBy('c', 'desc').all();
  const byPriority = await db.table('tickets').select('priority', 'COUNT(*) as c').groupBy('priority').all();
  const byAssignee = await db.table('tickets as t').join('users as a', 'a.id', 't.assigned_to').select('a.name', 'COUNT(*) as c', `SUM(CASE WHEN t.status = 'closed' THEN 1 ELSE 0 END) as closed`, 'AVG(t.rating) as rating').groupBy('a.id', 'a.name').orderBy('c', 'desc').all();
  const rating = await db.table('tickets').select('AVG(rating) as avg', 'COUNT(rating) as n').whereNotNull('rating').first();
  // میانگین زمان اولین پاسخ (ساعت)
  const firstReplies = await db.all(`SELECT t.created_at, MIN(r.created_at) AS first_reply FROM tickets t JOIN ticket_replies r ON r.ticket_id = t.id AND r.user_id != t.created_by AND r.is_internal = 0 GROUP BY t.id, t.created_at`);
  let avgHours = null;
  if (firstReplies.length) { const hrs = firstReplies.map((r) => (new Date(String(r.first_reply).replace(' ', 'T')) - new Date(String(r.created_at).replace(' ', 'T'))) / 36e5).filter((x) => x >= 0); if (hrs.length) avgHours = Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length * 10) / 10; }
  // ۳۰ روز اخیر
  const since = J.addDays(J.todayISO(), -29);
  const daily = await db.table('tickets').select(`${db.info.dialect === 'mysql' ? 'DATE(created_at)' : 'substr(created_at,1,10)'} as d`, 'COUNT(*) as c').where('created_at', '>=', since).groupBy('d').orderBy('d').all();
  res.render(v('stats'), { title: 'آمار تیکت‌ها', byStatus, byCategory, byPriority, byAssignee, rating, avgHours, daily, CATEGORIES, STATUSES, total: Object.values(byStatus).reduce((a, b) => a + b, 0) });
});

// ---------- پاسخ‌های آماده ----------
router.get('/canned', auth.requireRole('admin', 'staff', 'teacher'), modules.requireEnabled('tickets.canned'), async (req, res) => {
  const rows = await db.table('canned_responses as c').leftJoin('users as u', 'u.id', 'c.user_id').select('c.*', 'u.name as owner').where((b) => b.where('c.user_id', req.user.id).orWhereNull('c.user_id')).orderBy('c.title').all();
  res.render(v('canned'), { title: 'پاسخ‌های آماده', rows });
});
router.post('/canned', auth.requireRole('admin', 'staff', 'teacher'), modules.requireEnabled('tickets.canned'), async (req, res) => {
  const title = utils.normalizePersian(req.body.title || '').trim(), body = utils.normalizePersian(req.body.body || '').trim();
  if (!title || !body) { req.flash('danger', 'عنوان و متن الزامی است'); return res.redirect('/tickets/canned'); }
  await db.insert('canned_responses', { user_id: req.body.shared === '1' && req.user.role === 'admin' ? null : req.user.id, title, body, created_at: db.now() });
  req.flash('success', 'پاسخ آماده ذخیره شد.'); res.redirect('/tickets/canned');
});
router.post('/canned/:id/delete', auth.requireRole('admin', 'staff', 'teacher'), modules.requireEnabled('tickets.canned'), async (req, res) => {
  const row = await db.findById('canned_responses', req.params.id);
  if (row && (row.user_id === req.user.id || req.user.role === 'admin')) await db.remove('canned_responses', { id: row.id });
  res.redirect('/tickets/canned');
});

// ---------- ایجاد ----------
async function formData(req) {
  const data = { CATEGORIES, DEPARTMENTS, isStaff: isStaff(req), students: [], student: null, teachers: [] };
  if (req.user.role === 'student') data.student = await studentOf(req.user.id);
  if (req.user.role === 'parent') { const kid = await people.studentOf(req); data.student = kid ? await studentOf(kid.user_id) : null; data.children = await people.childrenOf(req.user.id); }
  if (isStaff(req)) { data.students = await db.table('students as s').leftJoin('classes as c', 'c.id', 's.class_id').select('s.id', 's.first_name', 's.last_name', 's.student_number', 'c.title as class_title').where('s.status', 'active').orderBy('s.last_name').all(); data.teachers = await assignees(); }
  return data;
}
router.get('/new', async (req, res) => {
  if (req.user.role === 'teacher' && !E('tickets.teacher_create')) return res.status(403).render('errors/module-disabled', { title: 'غیرفعال', feature: 'ثبت تیکت توسط معلم' });
  const data = await formData(req);
  res.render(v('form'), Object.assign({ title: 'تیکت جدید', prefill: { subject: req.query.subject || '', student_id: req.query.student_id || '', category: req.query.category || '' } }, data));
});
router.post('/', ...upload.form('tickets', 'single', 'file', { maxMb: 5 }), async (req, res) => {
  if (req.user.role === 'teacher' && !E('tickets.teacher_create')) return res.status(403).render('errors/403', { title: 'غیرمجاز' });
  if (req.uploadError) { req.flash('danger', req.uploadError); req.keepInput(); return res.redirect('/tickets/new'); }
  const b = utils.cleanBody(req.body, { fields: ['subject', 'message', 'department', 'category', 'priority', 'student_id', 'assigned_to'] });
  if (!b.subject || !b.message) { req.flash('danger', 'موضوع و متن پیام الزامی است'); req.keepInput(); return res.redirect('/tickets/new'); }
  let studentId = null, classId = null, assignedTo = null, department = DEPARTMENTS[b.department] ? b.department : 'admin';
  if (req.user.role === 'student' || req.user.role === 'parent') {
    const s = req.user.role === 'student' ? await studentOf(req.user.id) : await (async () => { const kids = await people.childrenOf(req.user.id); const k = kids.find((x) => String(x.id) === String(b.student_id)) || (await people.studentOf(req)); return k ? studentOf(k.user_id) : null; })();
    if (s) { studentId = s.id; classId = s.class_id; }
    if (department === 'teacher' && classId) assignedTo = await homeroomUserId(classId);
    if (!assignedTo) department = department === 'staff' ? 'staff' : 'admin';
  } else if (isStaff(req)) {
    if (b.student_id) { const s = await db.table('students').where('id', b.student_id).first(); if (s) { studentId = s.id; classId = s.class_id; } }
    if (b.assigned_to && E('tickets.assign')) assignedTo = Number(b.assigned_to) || null;
  } else if (req.user.role === 'teacher') {
    department = 'admin';
    if (b.student_id) { const s = await db.table('students').where('id', b.student_id).first(); if (s) { studentId = s.id; classId = s.class_id; } }
  }
  const now = db.now();
  const id = await db.insert('tickets', {
    code: await nextCode(), subject: b.subject, department, created_by: req.user.id, student_id: studentId, assigned_to: assignedTo, class_id: classId,
    category: E('tickets.categories') && CATEGORIES[b.category] ? b.category : 'other', priority: E('tickets.priority') && utils.PRIORITIES[b.priority] ? b.priority : 'normal',
    status: 'open', last_reply_at: now, last_reply_by: req.user.id, created_at: now, updated_at: now
  });
  await db.insert('ticket_replies', { ticket_id: id, user_id: req.user.id, message: b.message, file_path: req.file && E('tickets.attachments') ? upload.relPath(req.file) : null, file_name: req.file ? req.file.originalname : null, is_internal: 0, created_at: now });
  if (req.file && !E('tickets.attachments')) upload.removeFile(upload.relPath(req.file));
  if (E('tickets.notify') && E('notifications.inapp')) {
    const payload = { title: 'تیکت جدید', body: `${req.user.name}: ${b.subject}`, link: '/tickets/' + id, type: 'info' };
    if (assignedTo) await notify.push([assignedTo], payload); else await notify.pushRole('admin', payload);
  }
  await activity.log(req, 'create', 'tickets', id, 'ثبت تیکت: ' + b.subject);
  req.flash('success', 'تیکت شما ثبت شد و به‌زودی پاسخ داده می‌شود.');
  res.redirect('/tickets/' + id);
});

// ---------- نمایش ----------
router.get('/:id', async (req, res) => {
  const t = await baseQuery().where('t.id', req.params.id).first();
  if (!t) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  if (!(await canView(req, t))) return res.status(403).render('errors/403', { title: 'دسترسی غیرمجاز' });
  const rq = db.table('ticket_replies as r').join('users as u', 'u.id', 'r.user_id').select('r.*', 'u.name', 'u.role', 'u.avatar').where('r.ticket_id', t.id).orderBy('r.id');
  if (req.user.role === 'student' || req.user.role === 'parent' || !E('tickets.internal_notes')) rq.where('r.is_internal', 0);
  const replies = await rq.all();
  const staffUser = req.user.role !== 'student';
  const canned = staffUser && E('tickets.canned') ? await db.table('canned_responses').where((b) => b.where('user_id', req.user.id).orWhereNull('user_id')).orderBy('title').all() : [];
  const people = isStaff(req) && E('tickets.assign') ? await assignees() : [];
  const student = t.student_id ? await db.table('students as s').leftJoin('classes as c', 'c.id', 's.class_id').select('s.id', 's.first_name', 's.last_name', 's.student_number', 's.photo', 's.father_phone', 's.mother_phone', 's.mobile', 'c.title as class_title').where('s.id', t.student_id).first() : null;
  const others = t.created_by === req.user.id || isStaff(req) ? await (await scope(req, db.table('tickets as t'))).select('t.id', 't.code', 't.subject', 't.status', 't.created_at').where('t.created_by', t.created_by).where('t.id', '!=', t.id).orderBy('t.id', 'desc').limit(6).all() : [];
  res.render(v('show'), { title: `${t.code} — ${t.subject}`, t, replies, canned, people, student, others, CATEGORIES, STATUSES, DEPARTMENTS, isStaff: isStaff(req), staffUser, canReply: t.status !== 'closed' || staffUser, isOwner: t.created_by === req.user.id });
});

// ---------- پاسخ ----------
router.post('/:id/reply', ...upload.form('tickets', 'single', 'file', { maxMb: 5 }), async (req, res) => {
  const t = await db.findById('tickets', req.params.id);
  if (!t) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  if (!(await canView(req, t))) return res.status(403).render('errors/403', { title: 'دسترسی غیرمجاز' });
  const back = '/tickets/' + t.id;
  if (req.uploadError) { req.flash('danger', req.uploadError); return res.redirect(back); }
  const message = utils.normalizePersian(req.body.message || '').trim();
  if (!message) { req.flash('danger', 'متن پاسخ خالی است'); return res.redirect(back); }
  const staffUser = req.user.role !== 'student';
  if (t.status === 'closed' && !staffUser) { req.flash('warning', 'این تیکت بسته شده است. لطفاً تیکت جدیدی ثبت کنید.'); return res.redirect(back); }
  const internal = staffUser && E('tickets.internal_notes') && req.body.is_internal === '1' ? 1 : 0;
  const now = db.now();
  await db.insert('ticket_replies', { ticket_id: t.id, user_id: req.user.id, message, file_path: req.file && E('tickets.attachments') ? upload.relPath(req.file) : null, file_name: req.file ? req.file.originalname : null, is_internal: internal, created_at: now });
  if (req.file && !E('tickets.attachments')) upload.removeFile(upload.relPath(req.file));
  const upd = { updated_at: now };
  if (!internal) {
    upd.last_reply_at = now; upd.last_reply_by = req.user.id;
    if (E('tickets.status')) {
      if (staffUser) upd.status = req.body.close === '1' ? 'closed' : 'answered';
      else upd.status = 'open';
      if (upd.status === 'closed') upd.closed_at = now;
    }
    if (staffUser && !t.assigned_to && E('tickets.assign')) upd.assigned_to = req.user.id;
  }
  await db.update('tickets', upd, { id: t.id });
  if (!internal && E('tickets.notify') && E('notifications.inapp')) {
    const targets = new Set();
    if (staffUser) { if (t.created_by !== req.user.id) targets.add(t.created_by); }
    else { if (t.assigned_to) targets.add(t.assigned_to); }
    if (targets.size) await notify.push([...targets], { title: staffUser ? 'پاسخ به تیکت شما' : 'پاسخ جدید در تیکت', body: `${t.code}: ${t.subject}`, link: back, type: 'info' });
    else if (!staffUser) await notify.pushRole('admin', { title: 'پاسخ جدید در تیکت', body: `${t.code}: ${t.subject}`, link: back, type: 'info' });
  }
  await activity.log(req, 'reply', 'tickets', t.id, (internal ? 'یادداشت داخلی' : 'پاسخ') + ' در ' + t.code);
  req.flash('success', internal ? 'یادداشت داخلی ثبت شد.' : 'پاسخ ارسال شد.');
  res.redirect(back + '#last');
});

router.post('/:id/status', modules.requireEnabled('tickets.status'), async (req, res) => {
  const t = await db.findById('tickets', req.params.id);
  if (!t || !(await canView(req, t))) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const status = STATUSES[req.body.status] ? req.body.status : null;
  if (!status) return res.redirect('/tickets/' + t.id);
  if ((req.user.role === 'student' || req.user.role === 'parent') && status !== 'closed') return res.status(403).render('errors/403', { title: 'غیرمجاز' });
  await db.update('tickets', { status, closed_at: status === 'closed' ? db.now() : null, updated_at: db.now() }, { id: t.id });
  if (E('tickets.notify') && E('notifications.inapp') && req.user.id !== t.created_by) await notify.push([t.created_by], { title: 'تغییر وضعیت تیکت', body: `${t.code} → ${STATUSES[status]}`, link: '/tickets/' + t.id, type: status === 'closed' ? 'secondary' : 'info' });
  await activity.log(req, 'update', 'tickets', t.id, `وضعیت ${t.code} → ${STATUSES[status]}`);
  req.flash('success', 'وضعیت تیکت تغییر کرد.'); res.redirect('/tickets/' + t.id);
});
router.post('/:id/assign', auth.requireRole('admin', 'staff'), modules.requireEnabled('tickets.assign'), async (req, res) => {
  const t = await db.findById('tickets', req.params.id);
  if (!t) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const uid = Number(req.body.assigned_to) || null;
  await db.update('tickets', { assigned_to: uid, updated_at: db.now() }, { id: t.id });
  if (uid && E('tickets.notify') && E('notifications.inapp')) await notify.push([uid], { title: 'تیکت به شما ارجاع شد', body: `${t.code}: ${t.subject}`, link: '/tickets/' + t.id, type: 'warning' });
  await activity.log(req, 'assign', 'tickets', t.id, `ارجاع ${t.code}`);
  req.flash('success', uid ? 'تیکت ارجاع داده شد.' : 'ارجاع برداشته شد.'); res.redirect('/tickets/' + t.id);
});
router.post('/:id/priority', auth.requireRole('admin', 'staff', 'teacher'), modules.requireEnabled('tickets.priority'), async (req, res) => {
  const t = await db.findById('tickets', req.params.id);
  if (!t || !(await canView(req, t))) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  if (utils.PRIORITIES[req.body.priority]) await db.update('tickets', { priority: req.body.priority, updated_at: db.now() }, { id: t.id });
  res.redirect('/tickets/' + t.id);
});
router.post('/:id/category', auth.requireRole('admin', 'staff', 'teacher'), modules.requireEnabled('tickets.categories'), async (req, res) => {
  const t = await db.findById('tickets', req.params.id);
  if (!t || !(await canView(req, t))) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  if (CATEGORIES[req.body.category]) await db.update('tickets', { category: req.body.category, updated_at: db.now() }, { id: t.id });
  res.redirect('/tickets/' + t.id);
});
router.post('/:id/rate', modules.requireEnabled('tickets.rating'), async (req, res) => {
  const t = await db.findById('tickets', req.params.id);
  if (!t || t.created_by !== req.user.id) return res.status(403).render('errors/403', { title: 'غیرمجاز' });
  const r = utils.clampInt(req.body.rating, 1, 5, 0);
  if (r) await db.update('tickets', { rating: r, updated_at: db.now() }, { id: t.id });
  req.flash('success', 'از بازخورد شما سپاسگزاریم.'); res.redirect('/tickets/' + t.id);
});
router.post('/:id/delete', auth.requireAdmin, async (req, res) => {
  const t = await db.findById('tickets', req.params.id);
  if (!t) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const files = await db.table('ticket_replies').where('ticket_id', t.id).whereNotNull('file_path').pluck('file_path');
  files.forEach((f) => upload.removeFile(f));
  await db.remove('ticket_replies', { ticket_id: t.id });
  await db.remove('tickets', { id: t.id });
  await activity.log(req, 'delete', 'tickets', t.id, 'حذف تیکت ' + t.code);
  req.flash('success', 'تیکت حذف شد.'); res.redirect('/tickets');
});

module.exports = router;
module.exports.CATEGORIES = CATEGORIES;
module.exports.STATUSES = STATUSES;
