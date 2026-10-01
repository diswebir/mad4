'use strict';
const path = require('path');
const express = require('express');
const db = require('../../core/db');
const auth = require('../../core/auth');
const modules = require('../../core/modules');
const activity = require('../../core/activity');
const utils = require('../../core/utils');
const J = require('../../core/jalali');
const crud = require('../../core/crud');
const DbSessionStore = require('../../core/session-store');

const router = express.Router();
const v = (n) => path.join(__dirname, 'views', n + '.ejs');
router.use(auth.requireAdmin);

crud(router, {
  path: '', table: 'users', alias: 'u', title: 'کاربر', plural: 'کاربران', icon: 'bi-person-badge', feature: 'users.manage', labelField: 'name',
  orderBy: 'id', dir: 'desc', breadcrumbs: [{ title: 'سیستم' }],
  intro: 'حساب‌های <strong>معلم</strong> و <strong>دانش‌آموز</strong> از بخش‌های مربوطه ساخته می‌شوند و در اینجا قابل مدیریت‌اند. برای ساخت حساب مدیر یا کارمند از دکمهٔ افزودن استفاده کنید.',
  fields: [
    { name: 'name', label: 'نام و نام خانوادگی', type: 'text', required: true, list: true, search: true },
    { name: 'username', label: 'نام کاربری', type: 'username', required: true, list: true, search: true, help: 'حروف لاتین، عدد، نقطه و زیرخط', format: (v) => `<span class="ltr d-inline-block">${utils.escapeHtml(v)}</span>` },
    { name: 'role', label: 'نقش', type: 'select', required: true, options: utils.ROLES, list: true, filter: true, format: (v) => `<span class="badge badge-soft-${{ admin: 'danger', teacher: 'success', student: 'info', staff: 'secondary' }[v] || 'secondary'}">${utils.ROLES[v] || v}</span>` },
    { name: 'password', label: 'رمز عبور', type: 'password', help: 'در ویرایش، برای حفظ رمز فعلی خالی بگذارید', virtual: true },
    { name: 'email', label: 'ایمیل', type: 'email', search: true },
    { name: 'phone', label: 'موبایل', type: 'tel', mobile: true, list: true },
    { name: 'status', label: 'وضعیت', type: 'select', options: { active: 'فعال', inactive: 'غیرفعال' }, default: 'active', list: true, filter: true, format: (v) => (v === 'active' ? '<span class="badge badge-soft-success">فعال</span>' : '<span class="badge badge-soft-danger">غیرفعال</span>') },
    { name: 'must_change_password', label: 'اجبار تغییر رمز در ورود بعدی', type: 'checkbox' },
    { name: 'last_login_at', label: 'آخرین ورود', type: 'datetime', list: true, hideInForm: true, virtual: true }
  ],
  validate: (val, data) => {
    val.custom(/^[a-zA-Z0-9_.]{3,40}$/.test(data.username || ''), 'نام کاربری باید ۳ تا ۴۰ کاراکتر لاتین باشد');
  },
  beforeSave: async (data, req, isNew, row) => {
    const pw = req.body.password;
    if (isNew && (!pw || pw.length < 6)) throw new Error('رمز عبور باید حداقل ۶ کاراکتر باشد');
    if (pw) data.password = await auth.hashPassword(pw);
    if (isNew && !['admin', 'staff', 'teacher', 'student'].includes(data.role)) data.role = 'staff';
    if (!isNew && row && row.id === req.user.id) { data.role = 'admin'; data.status = 'active'; }
    if (data.phone) data.phone = utils.normalizePhone(data.phone);
    data.username = String(data.username).toLowerCase();
    return data;
  },
  afterSave: async (id, data, req, isNew, row) => {
    if (!isNew && data.status === 'inactive') await DbSessionStore.destroyUser(id);
  },
  beforeDelete: async (row, req) => {
    if (row.id === req.user.id) return 'نمی‌توانید حساب خودتان را حذف کنید';
    if (row.role === 'teacher' && await db.exists('teachers', { user_id: row.id })) return 'این کاربر معلم است؛ از بخش معلمان حذف کنید';
    if (row.role === 'student' && await db.exists('students', { user_id: row.id })) return 'این کاربر دانش‌آموز است؛ از بخش دانش‌آموزان حذف کنید';
    return true;
  },
  rowActions: (row, req) => {
    const a = [];
    if (modules.isEnabled('auth.impersonate') && row.role !== 'admin' && row.status === 'active') a.push({ post: '/auth/impersonate/' + row.id, icon: 'bi-box-arrow-in-left', label: 'ورود به جای کاربر', confirm: `به جای «${row.name}» وارد شوید؟` });
    if (modules.isEnabled('users.reset_password')) a.push({ href: '/users/' + row.id + '/reset', icon: 'bi-key', label: 'بازنشانی رمز' });
    if (modules.isEnabled('users.status') && row.id !== req.user.id) a.push({ post: '/users/' + row.id + '/toggle', icon: row.status === 'active' ? 'bi-person-x' : 'bi-person-check', label: row.status === 'active' ? 'غیرفعال‌سازی' : 'فعال‌سازی', class: row.status === 'active' ? 'btn-light text-warning' : 'btn-light text-success' });
    return a;
  }
});

router.get('/:id/reset', modules.requireEnabled('users.reset_password'), async (req, res) => {
  const user = await db.findById('users', req.params.id);
  if (!user) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  res.render(v('reset'), { title: 'بازنشانی رمز عبور', user, suggested: utils.randomDigits(6) });
});
router.post('/:id/reset', modules.requireEnabled('users.reset_password'), async (req, res) => {
  const user = await db.findById('users', req.params.id);
  if (!user) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const pw = String(req.body.password || '');
  if (pw.length < 6) { req.flash('danger', 'رمز باید حداقل ۶ کاراکتر باشد'); return res.redirect(`/users/${user.id}/reset`); }
  await db.update('users', { password: await auth.hashPassword(pw), must_change_password: req.body.force === '1' ? 1 : 0, updated_at: db.now() }, { id: user.id });
  await activity.log(req, 'password', 'user', user.id, 'بازنشانی رمز ' + user.name);
  req.flash('success', `رمز عبور «${user.name}» بازنشانی شد. رمز جدید: <code class="ltr">${utils.escapeHtml(pw)}</code>`);
  res.redirect(req.body.back || '/users');
});
router.post('/:id/toggle', modules.requireEnabled('users.status'), async (req, res) => {
  const user = await db.findById('users', req.params.id);
  if (!user || user.id === req.user.id) return res.redirect('/users');
  const status = user.status === 'active' ? 'inactive' : 'active';
  await db.update('users', { status, updated_at: db.now() }, { id: user.id });
  if (status === 'inactive') await DbSessionStore.destroyUser(user.id);
  await activity.log(req, 'toggle', 'user', user.id, `${status === 'active' ? 'فعال' : 'غیرفعال'}‌سازی ${user.name}`);
  req.flash('success', `حساب «${user.name}» ${status === 'active' ? 'فعال' : 'غیرفعال'} شد.`);
  res.redirect(req.get('referer') || '/users');
});

module.exports = router;
