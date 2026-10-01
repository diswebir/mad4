'use strict';
const path = require('path');
const express = require('express');
const db = require('../../core/db');
const auth = require('../../core/auth');
const modules = require('../../core/modules');
const crud = require('../../core/crud');
const people = require('../../core/people');
const notify = require('../../core/notify');
const utils = require('../../core/utils');
const J = require('../../core/jalali');

const router = express.Router();
const v = (n) => path.join(__dirname, 'views', n + '.ejs');
router.use(auth.requireAuth);
const E = modules.isEnabled;
const CATEGORIES = { late: 'تأخیر', absence: 'غیبت غیرموجه', uniform: 'پوشش نامناسب', behavior: 'رفتار نامناسب', disruption: 'اخلال در کلاس', damage: 'آسیب به اموال', cheating: 'تقلب', phone: 'استفاده از موبایل', other_neg: 'سایر (منفی)', academic: 'پیشرفت تحصیلی', helping: 'کمک به دیگران', participation: 'مشارکت فعال', competition: 'موفقیت در مسابقه', responsibility: 'مسئولیت‌پذیری', other_pos: 'سایر (مثبت)' };
const TYPES = { negative: 'انضباطی (منفی)', positive: 'تشویقی (مثبت)' };
const manageRoles = () => (E('discipline.teacher_record') ? ['admin', 'staff', 'teacher'] : ['admin', 'staff']);

// پنل دانش‌آموز — قبل از crud تا مسیر /my با /:id تداخل نکند
router.get('/my', auth.requireRole('student'), modules.requireEnabled('discipline.student_view'), async (req, res) => {
  const s = await people.studentOf(req);
  if (!s) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const rows = await db.table('discipline_records as d').leftJoin('users as u', 'u.id', 'd.recorded_by').select('d.*', 'u.name as recorder').where('d.student_id', s.id).orderBy('d.date', 'desc').orderBy('d.id', 'desc').all();
  const sum = rows.reduce((a, r) => a + Number(r.points || 0), 0);
  res.render(v('my'), { title: 'سوابق انضباطی من', rows, sum, CATEGORIES, TYPES, s });
});
router.get('/report', auth.requireRole('admin', 'staff', 'teacher'), modules.requireEnabled('discipline.report'), async (req, res) => {
  const classes = await people.classOptions(req);
  const classId = Number(req.query.class_id) || (classes[0] && classes[0].value) || null;
  const from = req.query.from ? J.toGregorian(req.query.from) : J.addDays(J.todayISO(), -90);
  const to = req.query.to ? J.toGregorian(req.query.to) : J.todayISO();
  let rows = []; let byCat = [];
  if (classId) {
    rows = await db.table('students as s').select('s.id', 's.first_name', 's.last_name', 's.student_number',
      `(SELECT COALESCE(SUM(points),0) FROM discipline_records d WHERE d.student_id = s.id AND d.type = 'negative' AND d.date BETWEEN '${from}' AND '${to}') as neg`,
      `(SELECT COALESCE(SUM(points),0) FROM discipline_records d WHERE d.student_id = s.id AND d.type = 'positive' AND d.date BETWEEN '${from}' AND '${to}') as pos`,
      `(SELECT COUNT(*) FROM discipline_records d WHERE d.student_id = s.id AND d.date BETWEEN '${from}' AND '${to}') as cnt`).where('s.class_id', classId).where('s.status', 'active').orderBy('s.last_name').all();
    rows.forEach((r) => { r.total = Number(r.pos) + Number(r.neg); });
    rows.sort((a, b) => b.total - a.total);
    byCat = await db.table('discipline_records as d').join('students as s', 's.id', 'd.student_id').select('d.category', 'd.type', 'COUNT(*) as c').where('s.class_id', classId).whereBetween('d.date', from, to).groupBy('d.category', 'd.type').orderBy('c', 'desc').all();
  }
  res.render(v('report'), { title: 'گزارش انضباطی', classes, classId, from, to, rows, byCat, CATEGORIES, TYPES });
});

crud(router, {
  path: '', table: 'discipline_records', alias: 'd', title: 'مورد انضباطی/تشویقی', plural: 'انضباط و تشویق', icon: 'bi-shield-check', feature: 'discipline.negative', orderBy: 'date', dir: 'desc',
  roles: ['admin', 'staff', 'teacher'], viewRoles: ['admin', 'staff', 'teacher'],
  query: (q, req) => { q.leftJoin('students as s', 's.id', 'd.student_id').leftJoin('classes as c', 'c.id', 's.class_id').select('d.*', 'c.title as class_title', 's.first_name', 's.last_name'); if (req && req.user.role === 'teacher') q.whereRaw('s.class_id IN (SELECT class_id FROM class_subjects cs JOIN teachers t ON t.id = cs.teacher_id WHERE t.user_id = ? UNION SELECT cl.id FROM classes cl JOIN teachers t2 ON t2.id = cl.teacher_id WHERE t2.user_id = ?)', [req.user.id, req.user.id]); return q; },
  filterHook: (q, req) => { if (req.query.class_id) q.where('s.class_id', req.query.class_id); if (req.query.student_id) q.where('d.student_id', req.query.student_id); },
  fields: [
    { name: 'student_id', label: 'دانش‌آموز', type: 'select', required: true, list: true, options: (req) => people.studentOptions(req), searchColumn: 's.last_name', search: true },
    { name: 'class_title', label: 'کلاس', type: 'text', virtual: true, readonly: true, hideInForm: true, list: true },
    { name: 'type', label: 'نوع', type: 'select', required: true, list: true, filter: true, options: (req) => (E('discipline.positive') ? TYPES : { negative: TYPES.negative }), format: (v) => (v === 'positive' ? '<span class="badge badge-soft-success">تشویقی</span>' : '<span class="badge badge-soft-danger">انضباطی</span>') },
    { name: 'category', label: 'دسته', type: 'select', required: true, list: true, filter: true, options: CATEGORIES },
    { name: 'points', label: 'امتیاز', type: 'number', list: true, min: -20, max: 20, help: 'برای موارد منفی عدد منفی وارد کنید (مثلاً -۲)', format: (v) => `<span class="fw-bold ${Number(v) < 0 ? 'text-danger' : 'text-success'}">${J.toPersianDigits(v)}</span>` },
    { name: 'date', label: 'تاریخ', type: 'date', required: true, list: true },
    { name: 'description', label: 'شرح', type: 'textarea', required: true, search: true, list: true },
    { name: 'action_taken', label: 'اقدام انجام‌شده', type: 'text', placeholder: 'تذکر شفاهی، تعهد کتبی، تماس با اولیا…' },
    { name: 'parent_notified', label: 'به اولیا اطلاع داده شد', type: 'checkbox', list: true }
  ],
  defaults: (req) => ({ date: J.todayISO(), type: 'negative', points: -1 }),
  beforeSave: async (data, req, isNew) => {
    if (!E('discipline.positive') && data.type === 'positive') data.type = 'negative';
    if (!E('discipline.points')) data.points = 0;
    else if (data.points != null) data.points = data.type === 'negative' ? -Math.abs(Number(data.points)) : Math.abs(Number(data.points));
    if (req.user.role === 'teacher') { const ids = await people.teacherClassIds(req.user.id); const s = await db.findById('students', data.student_id); if (!s || !ids.includes(s.class_id)) throw new Error('فقط برای دانش‌آموزان کلاس خودتان می‌توانید ثبت کنید'); }
    if (isNew) data.recorded_by = req.user.id;
    if (!E('discipline.parent_notify')) data.parent_notified = 0;
    return data;
  },
  afterSave: async (id, data, req, isNew) => {
    const s = await db.findById('students', data.student_id);
    if (!s) return;
    if (isNew && s.user_id && E('notifications.inapp')) await notify.push([s.user_id], { title: data.type === 'positive' ? 'تشویق ثبت شد' : 'مورد انضباطی ثبت شد', body: (CATEGORIES[data.category] || '') + (data.points ? ` (${J.toPersianDigits(data.points)} امتیاز)` : ''), link: '/discipline/my', type: data.type === 'positive' ? 'success' : 'warning' });
    if (isNew && data.parent_notified && E('discipline.parent_notify')) { const phone = s.father_phone || s.mother_phone || s.guardian_phone; if (phone) await notify.sms(phone, `اولیای محترم ${s.first_name} ${s.last_name}، ${data.type === 'positive' ? 'تشویق' : 'مورد انضباطی'} «${CATEGORIES[data.category] || ''}» در تاریخ ${J.formatDate(data.date)} ثبت شد. ${data.description || ''}`.trim()); }
  },
  labelField: 'category',
  pageActions: (req) => (E('discipline.report') ? [{ href: '/discipline/report', label: 'گزارش کلاس', icon: 'bi-bar-chart', class: 'btn-outline-primary' }] : []),
  rowActions: (row) => [{ href: '/students/' + row.student_id, icon: 'bi-person-vcard', label: 'پروندهٔ دانش‌آموز' }],
  listData: async (req) => {
    if (!E('discipline.points')) return {};
    const q = db.table('discipline_records as d').join('students as s', 's.id', 'd.student_id').select('d.type', 'COUNT(*) as c', 'COALESCE(SUM(d.points),0) as p').where('d.date', '>=', J.addDays(J.todayISO(), -30)).groupBy('d.type');
    if (req.user.role === 'teacher') q.whereIn('s.class_id', await people.teacherClassIds(req.user.id));
    const rows = await q.all(); const g = Object.fromEntries(rows.map((r) => [r.type, r]));
    const card = (t, c, s) => `<div class="col-6 col-md-3"><div class="card stat-card"><div class="card-body py-2"><div class="fs-7 text-secondary">${t}</div><div class="fs-4 fw-bold text-${c}">${J.toPersianDigits(s)}</div></div></div></div>`;
    return { summaryHtml: `<div class="row g-2 mb-3">${card('موارد انضباطی ۳۰ روز اخیر', 'danger', g.negative ? g.negative.c : 0)}${card('امتیاز منفی', 'danger', g.negative ? g.negative.p : 0)}${card('تشویق‌های ۳۰ روز اخیر', 'success', g.positive ? g.positive.c : 0)}${card('امتیاز مثبت', 'success', g.positive ? g.positive.p : 0)}</div>` };
  }
});
module.exports = router;
module.exports.CATEGORIES = CATEGORIES;
