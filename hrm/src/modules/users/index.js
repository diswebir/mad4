'use strict';
/** ماژول کاربران و سطوح دسترسی (هسته) */
const path = require('path');
const express = require('express');
const db = require('../../core/db');
const auth = require('../../core/auth');
const settings = require('../../core/settings');
const utils = require('../../core/utils');
const J = require('../../core/jalali');
const activity = require('../../core/activity');
const permissions = require('../../core/permissions');
const upload = require('../../core/upload');

const router = express.Router();
const v = (n) => path.join(__dirname, 'views', n + '.ejs');
router.use(auth.requireAuth, (req, res, next) => (req.user.role === 'applicant' ? res.redirect('/portal') : next()));

const STAFF_ROLES = ['hr_manager', 'hr_staff', 'employee'];

// ---------------- سطوح دسترسی ----------------
router.get('/roles', auth.requirePermission('roles.manage'), async (req, res) => {
  permissions.reload();
  const roles = await permissions.roles();
  const counts = {}; (await db.table('users').select('role_id', 'COUNT(*) AS c').whereNotNull('role_id').groupBy('role_id').all()).forEach((r) => (counts[r.role_id] = r.c));
  const baseCounts = {}; (await db.table('users').select('role', 'COUNT(*) AS c').whereNull('role_id').groupBy('role').all()).forEach((r) => (baseCounts[r.role] = r.c));
  res.render(v('roles'), { title: 'سطوح دسترسی', roles, counts, baseCounts, groups: permissions.GROUPS });
});
function roleForm(req, res, row) {
  res.render(v('role-form'), { title: row ? 'ویرایش سطح دسترسی' : 'سطح دسترسی جدید', row: row || { base_role: 'hr_staff', color: 'info', perms: [] }, groups: permissions.GROUPS, labels: permissions.LABELS });
}
router.get('/roles/new', auth.requirePermission('roles.manage'), (req, res) => roleForm(req, res, null));
router.get('/roles/:id/edit', auth.requirePermission('roles.manage'), async (req, res) => { const row = await db.findById('roles', req.params.id); if (!row) return res.redirect('/users/roles'); row.perms = permissions.parseList(row.permissions); roleForm(req, res, row); });
function roleData(body, existing) {
  const perms = [].concat(body.perms || []).filter((k) => permissions.ALL.includes(k));
  const base = ['hr_manager', 'hr_staff', 'employee'].includes(body.base_role) ? body.base_role : (existing ? existing.base_role : 'hr_staff');
  return { title: utils.normalizePersian(body.title), description: utils.normalizePersian(body.description) || null, base_role: base, color: ['primary', 'info', 'success', 'warning', 'danger', 'purple', 'secondary'].includes(body.color) ? body.color : 'info', permissions: JSON.stringify(perms), sort_order: parseInt(body.sort_order, 10) || 10, updated_at: db.now() };
}
router.post('/roles/new', auth.requirePermission('roles.manage'), async (req, res) => {
  const d = roleData(req.body);
  if (!d.title) { req.flash('danger', 'عنوان الزامی است.'); req.keepInput(); return res.redirect('/users/roles/new'); }
  let key = String(req.body.key || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30) || ('role_' + Date.now().toString(36));
  if (await db.table('roles').where('key', key).exists()) key += '_' + utils.randomString(3).toLowerCase();
  const id = await db.insert('roles', Object.assign({ key, is_system: 0, created_at: db.now() }, d));
  permissions.reload();
  await activity.log(req, 'create', 'role', id, 'ایجاد سطح دسترسی ' + d.title);
  req.flash('success', 'سطح دسترسی ایجاد شد.');
  res.redirect('/users/roles');
});
router.post('/roles/:id/edit', auth.requirePermission('roles.manage'), async (req, res) => {
  const row = await db.findById('roles', req.params.id); if (!row) return res.redirect('/users/roles');
  const d = roleData(req.body, row);
  if (!d.title) { req.flash('danger', 'عنوان الزامی است.'); return res.redirect('/users/roles/' + row.id + '/edit'); }
  if (row.is_system) d.base_role = row.base_role; // نقش‌های سیستمی: نقش پایه ثابت می‌ماند، مجوزها قابل ویرایش‌اند
  await db.update('roles', d, { id: row.id });
  permissions.reload();
  await activity.log(req, 'update', 'role', row.id, 'ویرایش سطح دسترسی ' + d.title);
  req.flash('success', 'ذخیره شد.');
  res.redirect('/users/roles');
});
router.post('/roles/:id/delete', auth.requirePermission('roles.manage'), async (req, res) => {
  const row = await db.findById('roles', req.params.id);
  if (row) {
    if (row.is_system) { req.flash('warning', 'سطوح دسترسی سیستمی حذف نمی‌شوند.'); return res.redirect('/users/roles'); }
    const n = await db.count('users', { role_id: row.id });
    if (n) { req.flash('warning', `${J.toPersianDigits(n)} کاربر این سطح را دارند؛ ابتدا سطح آن‌ها را تغییر دهید.`); return res.redirect('/users/roles'); }
    await db.remove('roles', { id: row.id }); permissions.reload();
    await activity.log(req, 'delete', 'role', row.id, 'حذف سطح دسترسی ' + row.title);
    req.flash('success', 'حذف شد.');
  }
  res.redirect('/users/roles');
});
router.post('/roles/:id/reset', auth.requirePermission('roles.manage'), async (req, res) => {
  const row = await db.findById('roles', req.params.id);
  const def = row && permissions.DEFAULT_ROLES.find((r) => r.key === row.key);
  if (def) { await db.update('roles', { permissions: JSON.stringify(def.permissions), updated_at: db.now() }, { id: row.id }); permissions.reload(); req.flash('success', 'مجوزها به پیش‌فرض بازگشت.'); }
  res.redirect('/users/roles');
});

// ---------------- کاربران ----------------
router.get('/', auth.requirePermission('users.manage'), async (req, res) => {
  const q = db.table('users as u').select('u.*', 'r.title as role_title', 'r.color as role_color').leftJoin('roles as r', 'u.role_id', 'r.id').where('u.is_super', 0).where('u.role', '!=', 'super');
  const f = req.query;
  if (f.q) q.search(utils.normalizePersian(f.q), ['u.name', 'u.username', 'u.mobile', 'u.email']);
  if (f.role === 'applicant') q.where('u.role', 'applicant'); else if (f.role) q.where('u.role', f.role); else q.where('u.role', '!=', 'applicant');
  if (f.status) q.where('u.status', f.status);
  const result = await q.orderBy('u.id', 'desc').paginate(f.page, settings.getInt('items_per_page', 20));
  const counts = {}; (await db.table('users').select('role', 'COUNT(*) AS c').where('is_super', 0).groupBy('role').all()).forEach((r) => (counts[r.role] = r.c));
  res.render(v('index'), { title: 'کاربران', result, counts, query: f, roles: await permissions.roles() });
});
async function userForm(req, res, row) {
  res.render(v('form'), { title: row ? 'ویرایش کاربر' : 'کاربر جدید', row: row || { role: 'hr_staff', status: 'active' }, roles: (await permissions.roles()).filter((r) => r.base_role !== 'applicant'), perms: row ? permissions.parseList(row.permissions) : [], groups: permissions.GROUPS, minLen: settings.getInt('password_min_length', 8) });
}
router.get('/new', auth.requirePermission('users.manage'), (req, res) => userForm(req, res, null));
router.get('/:id/edit', auth.requirePermission('users.manage'), async (req, res) => {
  const row = await db.findById('users', req.params.id);
  if (!row || row.is_super || row.role === 'super') return res.redirect('/users');
  userForm(req, res, row);
});
async function userData(req, existing) {
  const b = req.body;
  const roles = await permissions.roles();
  const roleRow = roles.find((r) => r.id === parseInt(b.role_id, 10) && r.base_role !== 'applicant');
  const data = {
    name: utils.normalizePersian(b.name) || null, email: utils.normalizePersian(b.email) || null, mobile: utils.normalizePhone(b.mobile) || null,
    status: ['active', 'inactive'].includes(b.status) ? b.status : 'active', updated_at: db.now(),
    permissions: JSON.stringify([].concat(b.perms || []).filter((k) => permissions.ALL.includes(k)))
  };
  if (roleRow) { data.role = roleRow.base_role; data.role_id = roleRow.is_system ? null : roleRow.id; }
  else if (!existing) { data.role = 'employee'; data.role_id = null; }
  if (!existing || b.password) {
    const minLen = settings.getInt('password_min_length', 8);
    if (!b.password || String(b.password).length < minLen) return { error: `رمز عبور حداقل ${J.toPersianDigits(minLen)} کاراکتر باشد` };
    data.password = await auth.hashPassword(b.password);
    data.must_change_password = b.must_change === '1' ? 1 : 0;
  }
  if (data.mobile && !utils.isValidMobile(data.mobile)) return { error: 'شمارهٔ موبایل معتبر نیست' };
  if (data.email && !utils.isValidEmail(data.email)) return { error: 'ایمیل معتبر نیست' };
  return { data };
}
router.post('/new', auth.requirePermission('users.manage'), async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) { req.flash('danger', 'نام کاربری فقط حروف انگلیسی، عدد، نقطه و خط تیره (۳ تا ۴۰ کاراکتر).'); req.keepInput(); return res.redirect('/users/new'); }
  if (await db.table('users').where('username', username).exists()) { req.flash('danger', 'این نام کاربری قبلاً ثبت شده است.'); req.keepInput(); return res.redirect('/users/new'); }
  const r = await userData(req, null);
  if (r.error) { req.flash('danger', r.error); req.keepInput(); return res.redirect('/users/new'); }
  if (r.data.mobile && await db.table('users').where('mobile', r.data.mobile).whereNotIn('role', ['applicant']).exists()) { req.flash('danger', 'این شمارهٔ موبایل برای کاربر دیگری ثبت شده است.'); req.keepInput(); return res.redirect('/users/new'); }
  const id = await db.insert('users', Object.assign({ username, is_super: 0, created_by: req.user.id, created_at: db.now(), login_count: 0 }, r.data));
  await activity.log(req, 'create', 'user', id, 'ایجاد کاربر ' + username);
  req.flash('success', 'کاربر ایجاد شد.');
  res.redirect('/users');
});
router.post('/:id/edit', auth.requirePermission('users.manage'), async (req, res) => {
  const row = await db.findById('users', req.params.id);
  if (!row || row.is_super || row.role === 'super') return res.redirect('/users');
  const r = await userData(req, row);
  if (r.error) { req.flash('danger', r.error); return res.redirect('/users/' + row.id + '/edit'); }
  if (row.id === req.user.id && r.data.status === 'inactive') { req.flash('danger', 'نمی‌توانید حساب خودتان را غیرفعال کنید.'); return res.redirect('/users/' + row.id + '/edit'); }
  if (row.role === 'applicant') { delete r.data.role; delete r.data.role_id; }
  await db.update('users', r.data, { id: row.id });
  await activity.log(req, 'update', 'user', row.id, 'ویرایش کاربر ' + row.username);
  req.flash('success', 'ذخیره شد.');
  res.redirect('/users');
});
router.post('/:id/toggle', auth.requirePermission('users.manage'), async (req, res) => {
  const row = await db.findById('users', req.params.id);
  if (row && !row.is_super && row.id !== req.user.id) { await db.update('users', { status: row.status === 'active' ? 'inactive' : 'active', updated_at: db.now() }, { id: row.id }); await activity.log(req, 'update', 'user', row.id, (row.status === 'active' ? 'غیرفعال‌سازی ' : 'فعال‌سازی ') + row.username); }
  res.redirect(req.get('referer') || '/users');
});
router.post('/:id/delete', auth.requirePermission('users.manage'), async (req, res) => {
  const row = await db.findById('users', req.params.id);
  if (row && !row.is_super && row.id !== req.user.id) {
    if (row.role === 'applicant' && await db.table('applications').where('user_id', row.id).whereNotIn('status', ['draft']).exists()) { req.flash('warning', 'این متقاضی پرونده دارد؛ ابتدا پرونده را حذف کنید.'); return res.redirect('/users'); }
    if (row.avatar) upload.removeFile(row.avatar);
    await db.table('notifications').where('user_id', row.id).delete();
    await db.remove('users', { id: row.id });
    await activity.log(req, 'delete', 'user', row.id, 'حذف کاربر ' + row.username);
    req.flash('success', 'کاربر حذف شد.');
  }
  res.redirect('/users');
});
router.post('/:id/reset-password', auth.requirePermission('users.manage'), async (req, res) => {
  const row = await db.findById('users', req.params.id);
  if (row && !row.is_super) {
    const pw = utils.randomDigits(8);
    await db.update('users', { password: await auth.hashPassword(pw), must_change_password: 1, updated_at: db.now() }, { id: row.id });
    await activity.log(req, 'update', 'user', row.id, 'بازنشانی رمز ' + row.username);
    req.flash('success', `رمز جدید کاربر «${row.name || row.username}»: <code class="ltr fs-6">${pw}</code> (در اولین ورود باید تغییر دهد)`);
  }
  res.redirect('/users');
});

module.exports = {
  key: 'users', name: 'کاربران و سطوح دسترسی', icon: 'bi-people', category: 'system', order: 80, core: true,
  description: 'مدیریت کاربران کارکنان، سطوح دسترسی سفارشی و مجوزها',
  mount: ['/users'], routes: [router],
  features: [
    { key: 'impersonate', name: 'ورود به جای کاربر', description: 'مدیر ارشد می‌تواند موقتاً با حساب کاربر دیگری وارد شود' },
    { key: 'custom_roles', name: 'سطوح دسترسی سفارشی', description: 'تعریف سطح دسترسی جدید با مجوزهای دلخواه', locked: true }
  ],
  menu: [
    { href: '/users', title: 'کاربران', icon: 'bi-people', match: '/users', permission: 'users.manage' },
    { href: '/users/roles', title: 'سطوح دسترسی', icon: 'bi-shield-lock', match: '/users/roles', permission: 'roles.manage' }
  ]
};
