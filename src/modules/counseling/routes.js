'use strict';
const express = require('express');
const db = require('../../core/db');
const auth = require('../../core/auth');
const modules = require('../../core/modules');
const crud = require('../../core/crud');
const people = require('../../core/people');
const J = require('../../core/jalali');

const router = express.Router();
router.use(auth.requireAuth);
const E = modules.isEnabled;
const TOPICS = { academic: 'تحصیلی', behavioral: 'رفتاری', family: 'خانوادگی', career: 'هدایت تحصیلی/شغلی', social: 'اجتماعی', emotional: 'هیجانی', other: 'سایر' };

router.get('/request', auth.requireRole('student', 'parent'), modules.requireEnabled('counseling.student_request'), (req, res) => {
  if (!E('tickets')) { req.flash('warning', 'ماژول تیکت فعال نیست؛ لطفاً حضوری به دفتر مشاوره مراجعه کنید.'); return res.redirect('/dashboard'); }
  res.redirect('/tickets/new?category=counseling&subject=' + encodeURIComponent('درخواست جلسهٔ مشاوره'));
});

crud(router, {
  path: '', table: 'counseling_sessions', alias: 'cs', title: 'جلسهٔ مشاوره', plural: 'مشاوره', icon: 'bi-chat-heart', feature: 'counseling.sessions', orderBy: 'date', dir: 'desc', roles: ['admin'], permission: 'counseling.manage',
  query: (q, req) => { q.leftJoin('students as s', 's.id', 'cs.student_id').leftJoin('classes as c', 'c.id', 's.class_id').leftJoin('users as u', 'u.id', 'cs.counselor_id').select('cs.*', 'c.title as class_title', 'u.name as counselor_name'); if (req && E('counseling.confidential') && req.user.role !== 'admin') q.where((b) => b.where('cs.is_confidential', 0).orWhere('cs.counselor_id', req.user.id)); return q; },
  filterHook: (q, req) => { if (req.query.student_id) q.where('cs.student_id', req.query.student_id); },
  fields: [
    { name: 'student_id', label: 'دانش‌آموز', type: 'select', required: true, list: true, search: true, searchColumn: 's.last_name', options: (req) => people.studentOptions(req) },
    { name: 'class_title', label: 'کلاس', type: 'text', virtual: true, readonly: true, hideInForm: true, list: true },
    { name: 'date', label: 'تاریخ جلسه', type: 'date', required: true, list: true },
    { name: 'counselor_id', label: 'مشاور', type: 'select', required: true, list: true, options: () => people.staffOptions() },
    { name: 'topic', label: 'موضوع', type: 'select', required: true, list: true, filter: true, options: TOPICS },
    { name: 'summary', label: 'خلاصهٔ جلسه', type: 'textarea', required: true, search: true },
    { name: 'follow_up_date', label: 'تاریخ پیگیری', type: 'date', list: true, format: (v) => (v ? `<span class="${v < J.todayISO() ? 'text-danger fw-semibold' : ''}">${J.formatDate(v)}</span>` : '—') },
    { name: 'is_confidential', label: 'محرمانه', type: 'checkbox', list: true, help: 'فقط شما و مدیر می‌توانید این جلسه را ببینید' }
  ],
  defaults: (req) => ({ date: J.todayISO(), counselor_id: req.user.id, topic: 'academic' }),
  beforeSave: (data) => { if (!E('counseling.confidential')) data.is_confidential = 0; return data; },
  labelField: 'topic',
  rowActions: (row) => [{ href: '/students/' + row.student_id, icon: 'bi-person-vcard', label: 'پرونده' }],
  listData: async (req) => {
    if (!E('counseling.followup')) return {};
    const q = db.table('counseling_sessions as cs').join('students as s', 's.id', 'cs.student_id').select('cs.id', 'cs.follow_up_date', 'cs.topic', 's.id as sid', 's.first_name', 's.last_name').whereNotNull('cs.follow_up_date').where('cs.follow_up_date', '<=', J.addDays(J.todayISO(), 7)).orderBy('cs.follow_up_date').limit(10);
    if (E('counseling.confidential') && req.user.role !== 'admin') q.where((b) => b.where('cs.is_confidential', 0).orWhere('cs.counselor_id', req.user.id));
    const due = await q.all();
    if (!due.length) return {};
    return { summaryHtml: `<div class="alert alert-warning py-2"><i class="bi bi-bell me-1"></i><strong>پیگیری‌های سررسیدشده / نزدیک:</strong> ` + due.map((d) => `<a href="/counseling/${d.id}/edit" class="badge text-bg-light border me-1">${d.first_name} ${d.last_name} — ${J.formatDate(d.follow_up_date)} (${TOPICS[d.topic] || ''})</a>`).join('') + '</div>' };
  }
});
module.exports = router;
