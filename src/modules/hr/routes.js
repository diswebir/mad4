'use strict';
const path = require('path');
const express = require('express');
const db = require('../../core/db');
const auth = require('../../core/auth');
const modules = require('../../core/modules');
const crud = require('../../core/crud');
const notify = require('../../core/notify');
const activity = require('../../core/activity');
const settings = require('../../core/settings');
const utils = require('../../core/utils');
const J = require('../../core/jalali');

const router = express.Router();
router.use(auth.requireAuth);
const E = modules.isEnabled;
const TYPES = { 'استحقاقی': 'استحقاقی', 'استعلاجی': 'استعلاجی', 'ساعتی': 'ساعتی', 'بدون حقوق': 'بدون حقوق', 'مأموریت': 'مأموریت' };
const isAdmin = (req) => req.user.role === 'admin';
const days = (r) => (r.type === 'ساعتی' ? 0 : J.diffDays(r.from_date, r.to_date) + 1);

crud(router, {
  path: '/leaves', table: 'leave_requests', alias: 'l', title: 'درخواست مرخصی', plural: 'مرخصی‌ها', icon: 'bi-person-badge', feature: 'hr.leaves', orderBy: 'id', dir: 'desc', roles: ['admin', 'staff', 'teacher'], viewRoles: ['admin', 'staff', 'teacher'], permission: 'hr.manage',
  query: (q, req) => { q.join('users as u', 'u.id', 'l.user_id').leftJoin('users as r', 'r.id', 'l.reviewed_by').select('l.*', 'u.name as user_name', 'u.role as user_role', 'r.name as reviewer_name'); if (req && !isAdmin(req)) q.where('l.user_id', req.user.id); return q; },
  fields: [
    { name: 'user_id', label: 'درخواست‌کننده', type: 'select', list: true, readonly: true, hideInForm: true, search: true, searchColumn: 'u.name', options: async () => (await db.table('users').whereIn('role', ['teacher', 'staff', 'admin']).orderBy('name').all()).map((u) => ({ value: u.id, label: u.name })) },
    { name: 'type', label: 'نوع', type: 'select', required: true, list: true, filter: true, options: TYPES },
    { name: 'from_date', label: 'از تاریخ', type: 'date', required: true, list: true },
    { name: 'to_date', label: 'تا تاریخ', type: 'date', required: true, list: true },
    { name: 'hours', label: 'ساعت (برای مرخصی ساعتی)', type: 'number', min: 1, max: 8, list: true, format: (val, row) => (row.type === 'ساعتی' ? J.toPersianDigits(val || 0) + ' ساعت' : J.toPersianDigits(days(row)) + ' روز') },
    { name: 'reason', label: 'دلیل', type: 'textarea', required: true, search: true },
    { name: 'status', label: 'وضعیت', type: 'select', list: true, filter: true, readonly: true, hideInForm: true, options: { pending: 'در انتظار', approved: 'تأیید شده', rejected: 'رد شده' }, format: (val, row) => utils.statusBadge(val) + (row.review_note ? `<div class="fs-7 text-secondary">${utils.escapeHtml(row.review_note)}</div>` : '') },
    { name: 'reviewer_name', label: 'بررسی‌کننده', type: 'text', virtual: true, readonly: true, hideInForm: true, list: true }
  ],
  defaults: () => ({ from_date: J.todayISO(), to_date: J.todayISO(), type: 'استحقاقی' }),
  validate: (val, d) => { if (d.from_date && d.to_date && d.to_date < d.from_date) val.custom(false, 'تاریخ پایان باید بعد از شروع باشد'); if (d.type === 'ساعتی' && !d.hours) val.custom(false, 'تعداد ساعت را وارد کنید'); },
  beforeSave: async (d, req, isNew, row) => { if (isNew) { d.user_id = req.user.id; d.status = 'pending'; } else if (row && row.status !== 'pending' && !isAdmin(req)) throw new Error('درخواست بررسی‌شده قابل ویرایش نیست'); if (d.type !== 'ساعتی') d.hours = null; return d; },
  afterSave: async (id, d, req, isNew) => { if (isNew && E('hr.notify')) await notify.pushRole('admin', { title: 'درخواست مرخصی جدید', body: `${req.user.name} — ${d.type} از ${J.formatDate(d.from_date)} تا ${J.formatDate(d.to_date)}`, link: '/hr/leaves?f_status=pending', type: 'info' }); },
  beforeDelete: (row, req) => (row.status === 'pending' || isAdmin(req) ? true : 'فقط درخواست در انتظار قابل حذف است'),
  labelField: 'type',
  rowActions: (row, req) => {
    const acts = [];
    if (isAdmin(req) && E('hr.approval') && row.status === 'pending') acts.push({ post: '/hr/leaves/' + row.id + '/review', params: { decision: 'approved' }, icon: 'bi-check2-circle', label: 'تأیید' }, { post: '/hr/leaves/' + row.id + '/review', params: { decision: 'rejected' }, icon: 'bi-x-circle', label: 'رد', confirm: 'درخواست رد شود؟' });
    if (isAdmin(req) && E('hr.documents') && row.user_role === 'teacher' && E('teachers.documents')) acts.push({ href: '/hr/staff/' + row.user_id + '/documents', icon: 'bi-folder2-open', label: 'پرونده و مدارک' });
    return acts;
  },
  pageActions: (req) => (isAdmin(req) ? [{ href: '/hr/leaves?f_status=pending', label: 'در انتظار بررسی', icon: 'bi-hourglass', class: 'btn-outline-warning' }] : []),
  listData: async (req) => {
    if (!E('hr.balance') && !isAdmin(req)) return {};
    const year = J.currentAcademicYear();
    if (isAdmin(req)) {
      const pending = await db.table('leave_requests').where('status', 'pending').count(); const approvedDays = (await db.table('leave_requests').where('status', 'approved').where('from_date', '>=', year.startDate).where('type', '!=', 'ساعتی').all()).reduce((a, r) => a + days(r), 0);
      const card = (t, c, s) => `<div class="col-6 col-md-3"><div class="card stat-card"><div class="card-body py-2"><div class="fs-7 text-secondary">${t}</div><div class="fs-4 fw-bold text-${c}">${J.toPersianDigits(s)}</div></div></div></div>`;
      return { summaryHtml: `<div class="row g-2 mb-3">${card('در انتظار بررسی', 'warning', pending)}${card('روز مرخصی تأییدشده (سال جاری)', 'primary', approvedDays)}</div>` };
    }
    const used = (await db.table('leave_requests').where({ user_id: req.user.id, status: 'approved' }).where('from_date', '>=', year.startDate).where('type', '!=', 'ساعتی').all()).reduce((a, r) => a + days(r), 0);
    const max = settings.getInt('leave_days_per_year', 30);
    return { summaryHtml: `<div class="alert alert-light border py-2"><i class="bi bi-calendar-check me-1"></i>ماندهٔ مرخصی سال تحصیلی ${year.title}: <strong>${J.toPersianDigits(Math.max(0, max - used))}</strong> از ${J.toPersianDigits(max)} روز (استفاده‌شده: ${J.toPersianDigits(used)})</div>` };
  }
});
// مدارک پرسنلی: هدایت به پروندهٔ معلم (مدارک در ماژول معلمان نگهداری می‌شود)
router.get('/staff/:userId/documents', auth.requireRoleOrPermission(['admin'], 'hr.manage'), modules.requireEnabled('hr.documents'), async (req, res) => {
  const t = await db.table('teachers').where('user_id', Number(req.params.userId) || 0).first();
  if (!t) { req.flash('warning', 'برای این کاربر پروندهٔ معلم ثبت نشده است.'); return res.redirect('/hr/leaves'); }
  res.redirect('/teachers/' + t.id + '#docs');
});
router.post('/leaves/:id/review', auth.requireRoleOrPermission(['admin'], 'hr.manage'), modules.requireEnabled('hr.approval'), async (req, res) => {
  const r = await db.findById('leave_requests', req.params.id);
  if (!r) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const decision = req.body.decision === 'approved' ? 'approved' : 'rejected';
  await db.update('leave_requests', { status: decision, reviewed_by: req.user.id, reviewed_at: db.now(), review_note: utils.normalizePersian(req.body.note || '').trim() || null }, { id: r.id });
  if (E('hr.notify')) await notify.push([r.user_id], { title: decision === 'approved' ? 'مرخصی تأیید شد' : 'مرخصی رد شد', body: `${r.type} از ${J.formatDate(r.from_date)} تا ${J.formatDate(r.to_date)}`, link: '/hr/leaves', type: decision === 'approved' ? 'success' : 'danger' });
  await activity.log(req, 'update', 'leave_requests', r.id, `${decision === 'approved' ? 'تأیید' : 'رد'} مرخصی`);
  req.flash('success', decision === 'approved' ? 'مرخصی تأیید شد.' : 'مرخصی رد شد.'); res.redirect(req.get('referer') || '/hr/leaves');
});
module.exports = router;
