'use strict';
const path = require('path');
const express = require('express');
const db = require('../../core/db');
const auth = require('../../core/auth');
const modules = require('../../core/modules');
const crud = require('../../core/crud');
const people = require('../../core/people');
const J = require('../../core/jalali');

const router = express.Router();
const v = (n) => path.join(__dirname, 'views', n + '.ejs');
router.use(auth.requireAuth);
const E = modules.isEnabled;
const TYPES = { checkup: 'معاینهٔ دوره‌ای', illness: 'بیماری', injury: 'حادثه / آسیب', vaccination: 'واکسیناسیون', medication: 'دارو', dental: 'دندان‌پزشکی', vision: 'بینایی‌سنجی', other: 'سایر' };

router.get('/my', auth.requireRole('student', 'parent'), modules.requireEnabled('health.student_view'), async (req, res) => {
  const s = await people.studentOf(req);
  if (!s) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const rows = await db.table('health_records as h').leftJoin('users as u', 'u.id', 'h.recorded_by').select('h.*', 'u.name as recorder').where('h.student_id', s.id).orderBy('h.date', 'desc').all();
  res.render(v('my'), { title: 'سوابق سلامت من', rows, s, TYPES });
});
router.get('/alerts', auth.requireRole('admin', 'staff', 'teacher'), modules.requireEnabled('health.alerts'), async (req, res) => {
  const classes = await people.classOptions(req);
  const classId = Number(req.query.class_id) || null;
  const q = db.table('students as s').leftJoin('classes as c', 'c.id', 's.class_id').select('s.id', 's.first_name', 's.last_name', 's.allergies', 's.medical_conditions', 's.medications', 's.special_needs', 's.blood_type', 's.emergency_name', 's.emergency_phone', 's.father_phone', 's.mother_phone', 'c.title as class_title').where('s.status', 'active')
    .where((b) => b.whereNotNull('s.allergies').orWhereNotNull('s.medical_conditions').orWhereNotNull('s.medications').orWhereNotNull('s.special_needs')).orderBy('c.title').orderBy('s.last_name');
  if (req.user.role === 'teacher') q.whereIn('s.class_id', await people.teacherClassIds(req.user.id));
  if (classId) q.where('s.class_id', classId);
  const rows = (await q.all()).filter((r) => [r.allergies, r.medical_conditions, r.medications, r.special_needs].some((x) => x && String(x).trim()));
  res.render(v('alerts'), { title: 'هشدارهای سلامت', rows, classes, classId });
});

crud(router, {
  path: '', table: 'health_records', alias: 'h', title: 'سابقهٔ سلامت', plural: 'سلامت و بهداشت', icon: 'bi-heart-pulse', feature: 'health.records', orderBy: 'date', dir: 'desc', roles: ['admin', 'staff'],
  query: (q) => q.leftJoin('students as s', 's.id', 'h.student_id').leftJoin('classes as c', 'c.id', 's.class_id').select('h.*', 'c.title as class_title'),
  filterHook: (q, req) => { if (req.query.student_id) q.where('h.student_id', req.query.student_id); if (req.query.class_id) q.where('s.class_id', req.query.class_id); },
  fields: [
    { name: 'student_id', label: 'دانش‌آموز', type: 'select', required: true, list: true, search: true, searchColumn: 's.last_name', options: (req) => people.studentOptions(req, { activeOnly: false }) },
    { name: 'class_title', label: 'کلاس', type: 'text', virtual: true, readonly: true, hideInForm: true, list: true },
    { name: 'date', label: 'تاریخ', type: 'date', required: true, list: true },
    { name: 'type', label: 'نوع', type: 'select', required: true, list: true, filter: true, options: TYPES },
    { name: 'title', label: 'عنوان', type: 'text', required: true, list: true, search: true, placeholder: 'مثال: سرماخوردگی، واکسن کزاز، معاینهٔ سالانه' },
    { name: 'description', label: 'شرح / یافته‌ها', type: 'textarea' },
    { name: 'action', label: 'اقدام انجام‌شده', type: 'text', placeholder: 'استراحت در اتاق بهداشت، تماس با اولیا…' },
    { name: 'referred', label: 'ارجاع به مرکز درمانی', type: 'checkbox', list: true }
  ],
  defaults: () => ({ date: J.todayISO(), type: 'checkup' }),
  beforeSave: (data, req, isNew) => { if (isNew) data.recorded_by = req.user.id; if (!E('health.referral')) data.referred = 0; return data; },
  rowActions: (row) => [{ href: '/students/' + row.student_id, icon: 'bi-person-vcard', label: 'پرونده' }],
  pageActions: () => (E('health.alerts') ? [{ href: '/health/alerts', label: 'هشدارهای سلامت', icon: 'bi-exclamation-triangle', class: 'btn-outline-danger' }] : []),
  listData: async () => {
    const total = await db.count('health_records'); const month = await db.table('health_records').where('date', '>=', J.addDays(J.todayISO(), -30)).count(); const referred = await db.table('health_records').where('referred', 1).count();
    const alerts = await db.table('students').where('status', 'active').where((b) => b.whereNotNull('allergies').orWhereNotNull('medical_conditions')).count();
    const card = (t, c, s) => `<div class="col-6 col-md-3"><div class="card stat-card"><div class="card-body py-2"><div class="fs-7 text-secondary">${t}</div><div class="fs-4 fw-bold text-${c}">${J.toPersianDigits(s)}</div></div></div></div>`;
    return { summaryHtml: `<div class="row g-2 mb-3">${card('کل سوابق', 'primary', total)}${card('۳۰ روز اخیر', 'info', month)}${card('ارجاع‌شده', 'warning', referred)}${card('دارای حساسیت/بیماری', 'danger', alerts)}</div>` };
  }
});
module.exports = router;
