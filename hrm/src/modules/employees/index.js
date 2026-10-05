'use strict';
/** ماژول کارکنان: پروندهٔ کارمندان (حداقلی در فاز ۱)، اطلاعیه‌های داخلی */
const path = require('path');
const express = require('express');
const db = require('../../core/db');
const auth = require('../../core/auth');
const settings = require('../../core/settings');
const utils = require('../../core/utils');
const J = require('../../core/jalali');
const activity = require('../../core/activity');
const crud = require('../../core/crud');
const notify = require('../../core/notify');
const service = require('./service');

const router = express.Router();
const v = (n) => path.join(__dirname, 'views', n + '.ejs');
const numeric = (req, res, next) => (/^\d+$/.test(req.params.id) ? next() : next('route'));
router.use(auth.requireAuth, (req, res, next) => (req.user.role === 'applicant' ? res.redirect('/portal') : next()));

router.get('/', auth.requirePermission('employees.view'), async (req, res) => {
  const q = db.table('employees as e').select('e.*', 'd.title as department', 'u.username', 'u.status as user_status').leftJoin('departments as d', 'e.department_id', 'd.id').leftJoin('users as u', 'e.user_id', 'u.id');
  if (req.query.q) q.search(utils.normalizePersian(req.query.q), ['e.first_name', 'e.last_name', 'e.employee_code', 'e.national_id', 'e.mobile', 'e.position_title']);
  if (req.query.department) q.where('e.department_id', parseInt(req.query.department, 10) || 0);
  if (req.query.status) q.where('e.status', req.query.status); else q.where('e.status', '!=', 'terminated');
  const result = await q.orderBy('e.id', 'desc').paginate(req.query.page, settings.getInt('items_per_page', 20));
  res.render(v('index'), { title: 'کارکنان', result, query: req.query, departments: await db.table('departments').orderBy('title').all() });
});
async function form(req, res, row) {
  res.render(v('form'), { title: row ? 'ویرایش کارمند' : 'کارمند جدید', row: row || { status: 'active', hire_date: J.todayISO() }, departments: await db.table('departments').orderBy('title').all(), managers: await db.table('employees').where('status', 'active').orderBy('last_name').all(), users: await db.table('users').where('role', 'employee').where('status', 'active').whereNotIn('id', (await db.table('employees').whereNotNull('user_id').pluck('user_id')).concat([0])).all() });
}
router.get('/new', auth.requirePermission('employees.manage'), (req, res) => form(req, res, null));
router.get('/:id', numeric, auth.requirePermission('employees.view'), async (req, res) => {
  const row = await db.table('employees as e').select('e.*', 'd.title as department', 'u.username', 'u.last_login_at', 'm.first_name as manager_first', 'm.last_name as manager_last').leftJoin('departments as d', 'e.department_id', 'd.id').leftJoin('users as u', 'e.user_id', 'u.id').leftJoin('employees as m', 'e.manager_id', 'm.id').where('e.id', parseInt(req.params.id, 10) || 0).first();
  if (!row) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  row.d = utils.parseJSON(row.data, {}) || {};
  const app = row.application_id ? await db.findById('applications', row.application_id) : null;
  res.render(v('show'), { title: `${row.first_name} ${row.last_name}`, row, app });
});
router.get('/:id/edit', numeric, auth.requirePermission('employees.manage'), async (req, res) => { const row = await db.findById('employees', req.params.id); if (!row) return res.redirect('/employees'); form(req, res, row); });
function data(b) {
  return { first_name: utils.normalizePersian(b.first_name), last_name: utils.normalizePersian(b.last_name), national_id: J.toEnglishDigits(b.national_id || '').replace(/\D/g, '') || null, mobile: utils.normalizePhone(b.mobile) || null, email: utils.normalizePersian(b.email) || null, department_id: parseInt(b.department_id, 10) || null, position_title: utils.normalizePersian(b.position_title) || null, hire_date: J.toGregorian(b.hire_date) || null, status: utils.EMPLOYEE_STATUS[b.status] ? b.status : 'active', manager_id: parseInt(b.manager_id, 10) || null, birth_date: J.toGregorian(b.birth_date) || null, notes: utils.normalizePersian(b.notes) || null, user_id: parseInt(b.user_id, 10) || null, updated_at: db.now() };
}
router.post('/new', auth.requirePermission('employees.manage'), async (req, res) => {
  const d = data(req.body);
  if (!d.first_name || !d.last_name) { req.flash('danger', 'نام و نام خانوادگی الزامی است.'); req.keepInput(); return res.redirect('/employees/new'); }
  d.employee_code = utils.normalizePersian(req.body.employee_code) || await service.nextCode();
  const id = await db.insert('employees', Object.assign(d, { data: '{}', created_at: db.now() }));
  await activity.log(req, 'create', 'employee', id, `ایجاد کارمند ${d.first_name} ${d.last_name}`);
  req.flash('success', 'کارمند ثبت شد.');
  res.redirect('/employees/' + id);
});
router.post('/:id/edit', numeric, auth.requirePermission('employees.manage'), async (req, res) => {
  const row = await db.findById('employees', req.params.id); if (!row) return res.redirect('/employees');
  const d = data(req.body);
  if (!d.first_name || !d.last_name) { req.flash('danger', 'نام و نام خانوادگی الزامی است.'); return res.redirect('/employees/' + row.id + '/edit'); }
  if (req.body.employee_code) d.employee_code = utils.normalizePersian(req.body.employee_code);
  if (d.user_id === null) d.user_id = row.user_id; // حذف اتصال فقط با دکمهٔ جداگانه
  if (d.manager_id === row.id) d.manager_id = null;
  await db.update('employees', d, { id: row.id });
  await activity.log(req, 'update', 'employee', row.id, `ویرایش کارمند ${d.first_name} ${d.last_name}`);
  req.flash('success', 'ذخیره شد.');
  res.redirect('/employees/' + row.id);
});
router.post('/:id/delete', numeric, auth.requirePermission('employees.manage'), async (req, res) => {
  const row = await db.findById('employees', req.params.id);
  if (row) { await db.remove('employees', { id: row.id }); if (row.application_id) await db.update('applications', { employee_id: null }, { id: row.application_id }); await activity.log(req, 'delete', 'employee', row.id, `حذف کارمند ${row.first_name} ${row.last_name}`); req.flash('success', 'حذف شد.'); }
  res.redirect('/employees');
});
/** ساخت حساب کاربری برای کارمند بدون حساب */
router.post('/:id/account', numeric, auth.requirePermission('employees.manage'), async (req, res) => {
  const row = await db.findById('employees', req.params.id); if (!row) return res.redirect('/employees');
  if (row.user_id) { req.flash('info', 'این کارمند حساب کاربری دارد.'); return res.redirect('/employees/' + row.id); }
  let username = String(req.body.username || row.national_id || ('emp' + row.employee_code)).trim().toLowerCase();
  if (await db.table('users').where('username', username).exists()) username += '-' + utils.randomString(3).toLowerCase();
  const pw = utils.randomDigits(8);
  const uid = await db.insert('users', { username, password: await auth.hashPassword(pw), role: 'employee', name: `${row.first_name} ${row.last_name}`, mobile: row.mobile, email: row.email, status: 'active', must_change_password: 1, created_by: req.user.id, created_at: db.now(), updated_at: db.now(), login_count: 0, is_super: 0 });
  await db.update('employees', { user_id: uid, updated_at: db.now() }, { id: row.id });
  await activity.log(req, 'create', 'user', uid, 'ساخت حساب کارمند ' + username);
  req.flash('success', `حساب ساخته شد — نام کاربری: <code class="ltr">${username}</code> رمز موقت: <code class="ltr">${pw}</code>`);
  res.redirect('/employees/' + row.id);
});

// ---------- اطلاعیه‌ها ----------
crud(router, {
  path: '/announcements', table: 'announcements', title: 'اطلاعیه', plural: 'اطلاعیه‌های داخلی', roles: ['hr_manager', 'super'], viewRoles: ['hr_manager', 'hr_staff', 'super'], permission: 'announcements.manage', viewPermission: 'announcements.manage', orderBy: 'id', dir: 'desc', feature: 'employees.announcements',
  fields: [
    { name: 'title', label: 'عنوان', type: 'text', required: true, list: true, search: true },
    { name: 'body', label: 'متن', type: 'textarea', required: true },
    { name: 'audience', label: 'مخاطب', type: 'select', list: true, options: { all: 'همهٔ کارکنان', employees: 'فقط کارمندان', hr: 'تیم منابع انسانی' } },
    { name: 'is_pinned', label: 'سنجاق‌شده', type: 'checkbox', list: true },
    { name: 'publish_at', label: 'تاریخ انتشار', type: 'date', list: true },
    { name: 'expires_at', label: 'تاریخ انقضا', type: 'date' }
  ],
  beforeSave: (d, req, isNew) => { if (isNew) d.created_by = req.user.id; return d; },
  afterSave: async (id, row, req, isNew) => { if (isNew && req.body.notify === '1') await notify.pushRole(row.audience === 'hr' ? ['hr_manager', 'hr_staff'] : row.audience === 'employees' ? ['employee'] : ['hr_manager', 'hr_staff', 'employee'], { title: 'اطلاعیهٔ جدید: ' + row.title, body: utils.truncate(row.body, 120), link: '/dashboard', type: 'info' }); }
});

module.exports = {
  key: 'employees', name: 'کارکنان', icon: 'bi-person-badge', category: 'people', order: 50,
  description: 'پروندهٔ کارکنان (تبدیل متقاضی استخدام‌شده به کارمند)، حساب کاربری کارمند و اطلاعیه‌های داخلی',
  mount: ['/employees'], routes: [router],
  features: [
    { key: 'announcements', name: 'اطلاعیه‌های داخلی', description: 'اطلاعیه برای کارکنان در داشبورد' },
    { key: 'convert', name: 'تبدیل متقاضی به کارمند', description: 'ساخت پروندهٔ کارمند از پروندهٔ استخدام با یک کلیک' }
  ],
  menu: [
    { href: '/employees', title: 'کارکنان', icon: 'bi-person-badge', match: '/employees', permission: 'employees.view' },
    { href: '/employees/announcements', title: 'اطلاعیه‌ها', icon: 'bi-megaphone', match: '/employees/announcements', permission: 'announcements.manage', feature: 'announcements' }
  ]
};
