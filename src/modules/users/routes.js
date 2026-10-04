'use strict';
const path = require('path');
const express = require('express');
const db = require('../../core/db');
const auth = require('../../core/auth');
const modules = require('../../core/modules');
const activity = require('../../core/activity');
const utils = require('../../core/utils');
const J = require('../../core/jalali');
const settings = require('../../core/settings');
const crud = require('../../core/crud');
const DbSessionStore = require('../../core/session-store');
const permissions = require('../../core/permissions');

const router = express.Router();
const v = (n) => path.join(__dirname, 'views', n + '.ejs');
router.use(auth.requireRoleOrPermission(['admin'], 'users.manage', 'positions.manage'));
// حساب سازنده (is_super) برای سایر کاربران وجود ندارد: هر مسیر /users/:id برای آن «۴۰۴» است
router.param('id', async (req, res, next, id) => {
  if (auth.isSuper(req)) return next();
  try {
    const row = /^\d+$/.test(String(id)) ? await db.table('users').select('id', 'is_super').where('id', Number(id)).first() : null;
    if (row && Number(row.is_super)) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  } catch (e) { return next(e); }
  next();
});

// ---------- سمت‌ها و مجوزها ----------
const posGuard = [auth.requireRoleOrPermission(['admin'], 'positions.manage'), modules.requireEnabled('users.positions')];
router.get('/positions', ...posGuard, async (req, res) => {
  const rows = await permissions.positions();
  const counts = Object.fromEntries((await db.table('users').select('position_id', 'COUNT(*) as c').whereNotNull('position_id').where('is_super', 0).groupBy('position_id').all()).map((r) => [r.position_id, Number(r.c)]));
  res.render(v('positions'), { title: 'سمت‌ها و مجوزها', rows, counts, GROUPS: permissions.GROUPS, LABELS: permissions.LABELS });
});
router.get('/positions/new', ...posGuard, (req, res) => res.render(v('position-form'), { title: 'سمت جدید', pos: { title: '', description: '', perms: [] }, GROUPS: permissions.GROUPS, isNew: true }));
router.get('/positions/:id/edit', ...posGuard, async (req, res) => {
  const pos = (await permissions.positions()).find((p) => p.id === Number(req.params.id));
  if (!pos) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const users = await db.table('users').select('id', 'name', 'username', 'role').where('position_id', pos.id).where('is_super', 0).orderBy('name').all();
  res.render(v('position-form'), { title: 'ویرایش سمت: ' + pos.title, pos, users, GROUPS: permissions.GROUPS, isNew: false });
});
async function savePosition(req, res, id) {
  const title = utils.normalizePersian(String(req.body.title || '')).trim();
  if (!title) { req.flash('danger', 'عنوان سمت الزامی است'); return res.redirect(id ? `/users/positions/${id}/edit` : '/users/positions/new'); }
  const perms = [].concat(req.body.perms || []).filter((k) => permissions.ALL.includes(k));
  const data = { title, description: utils.normalizePersian(String(req.body.description || '')).trim() || null, permissions: JSON.stringify(perms), updated_at: db.now() };
  if (id) await db.update('positions', data, { id }); else id = await db.insert('positions', Object.assign(data, { is_system: 0, created_at: db.now() }));
  permissions.reload();
  await activity.log(req, id ? 'update' : 'create', 'positions', id, `سمت «${title}» با ${perms.length} مجوز`);
  req.flash('success', 'سمت ذخیره شد. مجوزها برای کاربران این سمت از درخواست بعدی اعمال می‌شود.');
  res.redirect('/users/positions');
}
router.post('/positions', ...posGuard, (req, res) => savePosition(req, res, null));
router.post('/positions/:id', ...posGuard, (req, res) => savePosition(req, res, Number(req.params.id)));
router.post('/positions/:id/delete', ...posGuard, async (req, res) => {
  const id = Number(req.params.id);
  const n = await db.table('users').where('position_id', id).count();
  if (n) { req.flash('danger', `این سمت به ${J.toPersianDigits(n)} کاربر اختصاص دارد؛ ابتدا سمت آنان را تغییر دهید.`); return res.redirect('/users/positions'); }
  await db.remove('positions', { id }); permissions.reload();
  await activity.log(req, 'delete', 'positions', id, 'حذف سمت');
  req.flash('success', 'سمت حذف شد'); res.redirect('/users/positions');
});
router.get('/positions/matrix.csv', ...posGuard, async (req, res) => {
  const rows = await permissions.positions();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="positions-matrix.csv"');
  res.send(utils.toCSV(permissions.ALL.map((k) => ({ key: k })), [{ label: 'مجوز', value: (r) => permissions.LABELS[r.key] }, { label: 'کلید', key: 'key' }].concat(rows.map((p) => ({ label: p.title, value: (r) => (p.perms.includes(r.key) ? '✓' : '') })))));
});

crud(router, {
  path: '', table: 'users', alias: 'u', title: 'کاربر', plural: 'کاربران', icon: 'bi-person-badge', feature: 'users.manage', labelField: 'name',
  orderBy: 'id', dir: 'desc', breadcrumbs: [{ title: 'سیستم' }],
  intro: 'حساب‌های <strong>معلم</strong> و <strong>دانش‌آموز</strong> از بخش‌های مربوطه ساخته می‌شوند و در اینجا قابل مدیریت‌اند. برای ساخت حساب مدیر یا کارمند از دکمهٔ افزودن استفاده کنید.',
  fields: [
    { name: 'name', label: 'نام و نام خانوادگی', type: 'text', required: true, list: true, search: true },
    { name: 'username', label: 'نام کاربری', type: 'username', required: true, list: true, search: true, help: 'حروف لاتین، عدد، نقطه و زیرخط', format: (v) => `<span class="ltr d-inline-block">${utils.escapeHtml(v)}</span>` },
    { name: 'role', label: 'نقش', type: 'select', required: true, options: utils.ROLES, list: true, filter: true, format: (v, r) => (r && Number(r.is_super) ? '<span class="badge console-badge"><i class="bi bi-shield-lock me-1"></i>سازندهٔ سامانه</span>' : `<span class="badge badge-soft-${{ admin: 'danger', teacher: 'success', student: 'info', staff: 'secondary', parent: 'warning' }[v] || 'secondary'}">${utils.ROLES[v] || v}</span>`) },
    { name: 'password', label: 'رمز عبور', type: 'password', help: 'در ویرایش، برای حفظ رمز فعلی خالی بگذارید', virtual: true },
    { name: 'email', label: 'ایمیل', type: 'email', search: true },
    { name: 'phone', label: 'موبایل', type: 'tel', mobile: true, list: true },
    { name: 'status', label: 'وضعیت', type: 'select', options: { active: 'فعال', inactive: 'غیرفعال' }, default: 'active', list: true, filter: true, format: (v) => (v === 'active' ? '<span class="badge badge-soft-success">فعال</span>' : '<span class="badge badge-soft-danger">غیرفعال</span>') },
    { name: 'position_id', label: 'سمت سازمانی', type: 'select', col: 6, options: async () => Object.fromEntries((await permissions.positions()).map((p) => [p.id, p.title])), placeholder: '— بدون سمت —', help: 'مجوزهای سمت به کاربران غیرمدیر (کارمند/معلم) اعمال می‌شود', list: true, filter: true, format: (v, r) => (r.position_title ? `<span class="badge badge-soft-info">${utils.escapeHtml(r.position_title)}</span>` : '') },
    { name: 'must_change_password', label: 'اجبار تغییر رمز در ورود بعدی', type: 'checkbox' },
    { name: 'last_login_at', label: 'آخرین ورود', type: 'datetime', list: true, hideInForm: true, virtual: true }
  ],
  validate: (val, data) => {
    val.custom(/^[a-zA-Z0-9_.]{3,40}$/.test(data.username || ''), 'نام کاربری باید ۳ تا ۴۰ کاراکتر لاتین باشد');
  },
  beforeSave: async (data, req, isNew, row) => {
    const pw = req.body.password;
    const minLen = Math.min(32, Math.max(4, settings.getInt('password_min_length', 6)));
    if (isNew && (!pw || pw.length < minLen)) throw new Error(`رمز عبور باید حداقل ${J.toPersianDigits(minLen)} کاراکتر باشد`);
    if (pw && pw.length < minLen) throw new Error(`رمز عبور باید حداقل ${J.toPersianDigits(minLen)} کاراکتر باشد`);
    if (pw) data.password = await auth.hashPassword(pw);
    // سیاست «اجبار تغییر رمز در اولین ورود» برای حساب‌های تازه (تنظیم force_password_change)؛ تیک فرم اولویت دارد
    if (isNew && req.body.must_change_password === undefined && settings.get('force_password_change', '0') === '1') data.must_change_password = 1;
    if (isNew && !['admin', 'staff', 'teacher', 'student'].includes(data.role)) data.role = 'staff';
    if (!isNew && row && row.id === req.user.id) { data.role = 'admin'; data.status = 'active'; }
    if (!isNew && row && Number(row.is_super) && !auth.isSuper(req)) throw new Error('یافت نشد');
    if (!isNew && row && Number(row.is_super)) { data.role = 'admin'; data.status = 'active'; data.position_id = null; }
    if (data.phone) data.phone = utils.normalizePhone(data.phone);
    data.username = String(data.username).toLowerCase();
    data.position_id = Number(data.position_id) || null;
    if (modules.isEnabled('users.permissions') && req.user.role === 'admin') { const perms = [].concat(req.body.perms || []).filter((k) => permissions.ALL.includes(k)); data.permissions = perms.length ? JSON.stringify(perms) : null; }
    return data;
  },
  defaults: () => ({ status: 'active', must_change_password: settings.get('force_password_change', '0') === '1' ? 1 : 0 }),
  formPartial: '../modules/users/views/permissions-form',
  formData: async (req, row) => ({ GROUPS: permissions.GROUPS, perms: permissions.parseList(row && row.permissions), positions: await permissions.positions(), canEditPerms: req.user.role === 'admin' && modules.isEnabled('users.permissions') }),
  // حساب سازنده فقط برای خودِ سازنده (با نشست کنسول) در فهرست/ویرایش/خروجی دیده می‌شود
  query: (q, req) => { q.leftJoin('positions as p', 'p.id', 'u.position_id').select('u.*', 'p.title as position_title'); if (!auth.isSuper(req)) q.where('u.is_super', 0); return q; },
  afterSave: async (id, data, req, isNew, row) => {
    if (!isNew && data.status === 'inactive') await DbSessionStore.destroyUser(id);
  },
  beforeDelete: async (row, req) => {
    if (row.id === req.user.id) return 'نمی‌توانید حساب خودتان را حذف کنید';
    if (Number(row.is_super)) return 'حساب سازنده فقط از خط فرمان (scripts/superadmin.js) قابل حذف است';
    if (row.role === 'teacher' && await db.exists('teachers', { user_id: row.id })) return 'این کاربر معلم است؛ از بخش معلمان حذف کنید';
    if (row.role === 'student' && await db.exists('students', { user_id: row.id })) return 'این کاربر دانش‌آموز است؛ از بخش دانش‌آموزان حذف کنید';
    return true;
  },
  rowActions: (row, req) => {
    const a = [];
    const superViewer = auth.isSuper(req);
    // سازنده می‌تواند به جای هر کاربری (حتی مدیر) وارد شود؛ مدیر فقط به جای غیرمدیران و در صورت فعال‌بودن قابلیت
    if (row.status === 'active' && row.id !== req.user.id && !Number(row.is_super) && (superViewer || (modules.isEnabled('auth.impersonate') && row.role !== 'admin'))) a.push({ post: '/auth/impersonate/' + row.id, icon: 'bi-box-arrow-in-left', label: superViewer ? 'ورود به پنل کاربر' : 'ورود به جای کاربر', confirm: `به جای «${row.name}» وارد شوید؟`, class: superViewer ? 'btn-light text-primary' : undefined });
    if (Number(row.is_super)) return a;
    if (modules.isEnabled('users.reset_password')) a.push({ href: '/users/' + row.id + '/reset', icon: 'bi-key', label: 'بازنشانی رمز' });
    if (modules.isEnabled('users.status') && row.id !== req.user.id) a.push({ post: '/users/' + row.id + '/toggle', icon: row.status === 'active' ? 'bi-person-x' : 'bi-person-check', label: row.status === 'active' ? 'غیرفعال‌سازی' : 'فعال‌سازی', class: row.status === 'active' ? 'btn-light text-warning' : 'btn-light text-success' });
    return a;
  }
});

router.get('/:id/reset', modules.requireEnabled('users.reset_password'), async (req, res) => {
  const user = await db.findById('users', req.params.id);
  if (!user || Number(user.is_super)) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  res.render(v('reset'), { title: 'بازنشانی رمز عبور', user, suggested: utils.randomDigits(6) });
});
router.post('/:id/reset', modules.requireEnabled('users.reset_password'), async (req, res) => {
  const user = await db.findById('users', req.params.id);
  if (!user || Number(user.is_super)) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const pw = String(req.body.password || '');
  if (pw.length < 6) { req.flash('danger', 'رمز باید حداقل ۶ کاراکتر باشد'); return res.redirect(`/users/${user.id}/reset`); }
  await db.update('users', { password: await auth.hashPassword(pw), must_change_password: req.body.force === '1' ? 1 : 0, updated_at: db.now() }, { id: user.id });
  await activity.log(req, 'password', 'user', user.id, 'بازنشانی رمز ' + user.name);
  req.flash('success', `رمز عبور «${user.name}» بازنشانی شد. رمز جدید: <code class="ltr">${utils.escapeHtml(pw)}</code>`);
  res.redirect(req.body.back || '/users');
});
router.post('/:id/toggle', modules.requireEnabled('users.status'), async (req, res) => {
  const user = await db.findById('users', req.params.id);
  if (!user || user.id === req.user.id || Number(user.is_super)) return res.redirect('/users');
  const status = user.status === 'active' ? 'inactive' : 'active';
  await db.update('users', { status, updated_at: db.now() }, { id: user.id });
  if (status === 'inactive') await DbSessionStore.destroyUser(user.id);
  await activity.log(req, 'toggle', 'user', user.id, `${status === 'active' ? 'فعال' : 'غیرفعال'}‌سازی ${user.name}`);
  req.flash('success', `حساب «${user.name}» ${status === 'active' ? 'فعال' : 'غیرفعال'} شد.`);
  res.redirect(req.get('referer') || '/users');
});

module.exports = router;
