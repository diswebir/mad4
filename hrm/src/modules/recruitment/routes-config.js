'use strict';
/** پیکربندی استخدام: موقعیت‌های شغلی، دعوت‌نامه/QR، فرم‌ساز، واحدهای سازمانی */
const path = require('path');
const express = require('express');
const db = require('../../core/db');
const auth = require('../../core/auth');
const settings = require('../../core/settings');
const utils = require('../../core/utils');
const J = require('../../core/jalali');
const activity = require('../../core/activity');
const barcode = require('../../core/barcode');
const crud = require('../../core/crud');
const forms = require('./forms');

const router = express.Router();
const v = (n) => path.join(__dirname, 'views', 'hr', n + '.ejs');

router.use(auth.requireAuth, (req, res, next) => (req.user.role === 'applicant' ? res.redirect('/portal') : next()));

function baseUrl(req) { return (settings.get('app_url') || (req.protocol + '://' + req.get('host'))).replace(/\/$/, ''); }

// ---------------- موقعیت‌های شغلی ----------------
router.get('/positions', auth.requirePermission('jobs.view'), async (req, res) => {
  const q = db.table('job_positions as p').select('p.*', 'd.title as department').leftJoin('departments as d', 'p.department_id', 'd.id');
  if (req.query.q) q.search(utils.normalizePersian(req.query.q), ['p.title', 'p.code', 'd.title']);
  if (req.query.status) q.where('p.status', req.query.status);
  const rows = await q.orderBy('p.sort_order').orderBy('p.id', 'desc').all();
  const counts = {}; (await db.table('applications').select('position_id', 'COUNT(*) AS c').whereNotIn('status', ['draft']).groupBy('position_id').all()).forEach((r) => (counts[r.position_id] = r.c));
  const active = {}; (await db.table('applications').select('position_id', 'COUNT(*) AS c').whereIn('status', ['submitted', 'screening', 'test', 'interview', 'offer']).groupBy('position_id').all()).forEach((r) => (active[r.position_id] = r.c));
  res.render(v('positions'), { title: 'موقعیت‌های شغلی', rows, counts, active, query: req.query, base: baseUrl(req) });
});
async function positionForm(req, res, row) {
  res.render(v('position-form'), { title: row ? 'ویرایش موقعیت شغلی' : 'موقعیت شغلی جدید', row: row || { status: 'open', employment_type: 'full_time', capacity: 1, require_test: 1, is_public: 1, gender: 'any' }, departments: await db.table('departments').orderBy('sort_order').orderBy('title').all(), types: require('../assessments/mbti').TYPE_LIST });
}
router.get('/positions/new', auth.requirePermission('jobs.manage'), (req, res) => positionForm(req, res, null));
router.get('/positions/:id/edit', auth.requirePermission('jobs.manage'), async (req, res) => { const row = await db.findById('job_positions', req.params.id); if (!row) return res.redirect('/recruitment/positions'); positionForm(req, res, row); });
function positionData(body) {
  const pref = [].concat(body.preferred_types || []).map((t) => String(t).toUpperCase()).filter((t) => /^[EI][SN][TF][JP]$/.test(t));
  return {
    title: utils.normalizePersian(body.title), code: utils.normalizePersian(body.code) || null, department_id: parseInt(body.department_id, 10) || null, location: utils.normalizePersian(body.location) || null,
    employment_type: utils.EMPLOYMENT_TYPES[body.employment_type] ? body.employment_type : 'full_time', description: utils.normalizePersian(body.description) || null, requirements: utils.normalizePersian(body.requirements) || null,
    benefits: utils.normalizePersian(body.benefits) || null, salary_range: utils.normalizePersian(body.salary_range) || null, capacity: Math.max(1, parseInt(body.capacity, 10) || 1), status: utils.POSITION_STATUS[body.status] ? body.status : 'open',
    opens_at: J.toGregorian(body.opens_at) || null, closes_at: J.toGregorian(body.closes_at) || null, preferred_types: pref.join(',') || null, require_test: body.require_test === '1' ? 1 : 0, gender: ['any', 'male', 'female'].includes(body.gender) ? body.gender : 'any',
    min_experience: parseInt(body.min_experience, 10) || 0, education_min: utils.EDUCATIONS[body.education_min] ? body.education_min : null, is_public: body.is_public === '1' ? 1 : 0, sort_order: parseInt(body.sort_order, 10) || 0, updated_at: db.now()
  };
}
router.post('/positions/new', auth.requirePermission('jobs.manage'), async (req, res) => {
  const data = positionData(req.body);
  if (!data.title) { req.flash('danger', 'عنوان الزامی است.'); req.keepInput(); return res.redirect('/recruitment/positions/new'); }
  const id = await db.insert('job_positions', Object.assign(data, { created_by: req.user.id, created_at: db.now() }));
  await activity.log(req, 'create', 'job_position', id, 'ایجاد موقعیت ' + data.title);
  req.flash('success', 'موقعیت شغلی ایجاد شد.');
  res.redirect('/recruitment/positions');
});
router.post('/positions/:id/edit', auth.requirePermission('jobs.manage'), async (req, res) => {
  const row = await db.findById('job_positions', req.params.id); if (!row) return res.redirect('/recruitment/positions');
  const data = positionData(req.body);
  if (!data.title) { req.flash('danger', 'عنوان الزامی است.'); return res.redirect('/recruitment/positions/' + row.id + '/edit'); }
  await db.update('job_positions', data, { id: row.id });
  await activity.log(req, 'update', 'job_position', row.id, 'ویرایش موقعیت ' + data.title);
  req.flash('success', 'ذخیره شد.');
  res.redirect('/recruitment/positions');
});
router.post('/positions/:id/status', auth.requirePermission('jobs.manage'), async (req, res) => {
  const row = await db.findById('job_positions', req.params.id);
  if (row) { const st = row.status === 'open' ? 'closed' : 'open'; await db.update('job_positions', { status: st, updated_at: db.now() }, { id: row.id }); req.flash('success', st === 'open' ? 'موقعیت فعال شد.' : 'موقعیت بسته شد.'); }
  res.redirect('/recruitment/positions');
});
router.post('/positions/:id/duplicate', auth.requirePermission('jobs.manage'), async (req, res) => {
  const row = await db.findById('job_positions', req.params.id);
  if (row) { const c = Object.assign({}, row); delete c.id; c.title = row.title + ' (کپی)'; c.status = 'draft'; c.created_at = db.now(); c.updated_at = db.now(); c.created_by = req.user.id; await db.insert('job_positions', c); req.flash('success', 'کپی ساخته شد.'); }
  res.redirect('/recruitment/positions');
});
router.post('/positions/:id/delete', auth.requirePermission('jobs.manage'), async (req, res) => {
  const row = await db.findById('job_positions', req.params.id);
  if (row) {
    const n = await db.count('applications', { position_id: row.id });
    if (n) { req.flash('warning', `این موقعیت ${J.toPersianDigits(n)} پرونده دارد؛ به جای حذف، آن را ببندید.`); return res.redirect('/recruitment/positions'); }
    await db.remove('job_positions', { id: row.id }); await activity.log(req, 'delete', 'job_position', row.id, 'حذف موقعیت ' + row.title); req.flash('success', 'حذف شد.');
  }
  res.redirect('/recruitment/positions');
});
/** QR عمومی صفحهٔ استخدام / یک موقعیت */
router.get('/positions/qr', auth.requirePermission('jobs.view'), (req, res) => {
  const url = baseUrl(req) + '/apply';
  res.render(v('qr'), { layout: 'layouts/print', title: 'QR استخدام', url, svg: barcode.qr(url, { size: 320, margin: 1 }), heading: 'درخواست همکاری با ' + settings.get('company_name'), sub: 'کد را اسکن کنید و فرم استخدام را به‌صورت آنلاین تکمیل نمایید.' });
});

// ---------------- دعوت‌نامه‌ها / QR ----------------
router.get('/invites', auth.requirePermission('invites.manage'), async (req, res) => {
  const rows = await db.table('invites as i').select('i.*', 'p.title as position_title', 'u.name as creator').leftJoin('job_positions as p', 'i.position_id', 'p.id').leftJoin('users as u', 'i.created_by', 'u.id').orderBy('i.id', 'desc').all();
  const today = J.todayISO();
  rows.forEach((r) => { r.expired = r.expires_at && r.expires_at < today; r.exhausted = r.max_uses && r.uses >= r.max_uses; r.url = baseUrl(req) + '/apply/i/' + r.code; });
  res.render(v('invites'), { title: 'دعوت‌نامه‌ها و QR', rows, positions: await db.table('job_positions').orderBy('title').all(), base: baseUrl(req) });
});
router.post('/invites', auth.requirePermission('invites.manage'), async (req, res) => {
  let code = utils.normalizePersian(req.body.code || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20);
  if (!code) code = utils.randomString(6).toUpperCase();
  if (await db.table('invites').where('code', code).exists()) { req.flash('danger', 'این کد قبلاً استفاده شده است.'); return res.redirect('/recruitment/invites'); }
  const id = await db.insert('invites', { code, title: utils.normalizePersian(req.body.title) || null, position_id: parseInt(req.body.position_id, 10) || null, max_uses: parseInt(req.body.max_uses, 10) || 0, uses: 0, expires_at: J.toGregorian(req.body.expires_at) || null, status: 'active', note: utils.normalizePersian(req.body.note) || null, created_by: req.user.id, created_at: db.now(), updated_at: db.now() });
  await activity.log(req, 'create', 'invite', id, 'ایجاد دعوت‌نامه ' + code);
  req.flash('success', 'دعوت‌نامه ساخته شد.');
  res.redirect('/recruitment/invites');
});
router.post('/invites/:id/toggle', auth.requirePermission('invites.manage'), async (req, res) => {
  const row = await db.findById('invites', req.params.id);
  if (row) await db.update('invites', { status: row.status === 'active' ? 'disabled' : 'active', updated_at: db.now() }, { id: row.id });
  res.redirect('/recruitment/invites');
});
router.post('/invites/:id/delete', auth.requirePermission('invites.manage'), async (req, res) => {
  await db.remove('invites', { id: req.params.id });
  res.redirect('/recruitment/invites');
});
router.get('/invites/:id/qr', auth.requirePermission('invites.manage'), async (req, res) => {
  const row = await db.findById('invites', req.params.id); if (!row) return res.redirect('/recruitment/invites');
  const pos = row.position_id ? await db.findById('job_positions', row.position_id) : null;
  const url = baseUrl(req) + '/apply/i/' + row.code;
  res.render(v('qr'), { layout: 'layouts/print', title: 'QR دعوت ' + row.code, url, svg: barcode.qr(url, { size: 320, margin: 1 }), heading: row.title || ('درخواست همکاری با ' + settings.get('company_name')), sub: pos ? 'موقعیت شغلی: ' + pos.title : 'کد را اسکن کنید و فرم استخدام را تکمیل نمایید.', code: row.code });
});

// ---------------- فرم‌ساز ----------------
router.get('/form-builder', auth.requirePermission('forms.manage'), async (req, res) => {
  const secs = await forms.definition({ all: true });
  res.render(v('form-builder'), { title: 'فرم‌ساز استخدام', secs, types: forms.TYPES, optionTypes: forms.OPTION_TYPES, requirePhoto: settings.getBool('recruitment_require_photo'), requireResume: settings.getBool('recruitment_require_resume') });
});
router.post('/form-builder/section/:key', auth.requirePermission('forms.manage'), async (req, res) => {
  const s = await db.table('form_sections').where('key', req.params.key).first(); if (!s) return res.redirect('/recruitment/form-builder');
  const a = req.body._action;
  const upd = { updated_at: db.now() };
  if (a === 'toggle') { if (['personal', 'declaration'].includes(s.key)) { req.flash('warning', 'این بخش قابل غیرفعال‌سازی نیست.'); return res.redirect('/recruitment/form-builder'); } upd.enabled = s.enabled ? 0 : 1; }
  else if (a === 'up' || a === 'down') {
    const all = await db.table('form_sections').orderBy('sort_order').orderBy('id').all();
    const i = all.findIndex((x) => x.id === s.id); const j = a === 'up' ? i - 1 : i + 1;
    if (j >= 0 && j < all.length) { await db.update('form_sections', { sort_order: all[j].sort_order }, { id: s.id }); await db.update('form_sections', { sort_order: s.sort_order }, { id: all[j].id }); if (all[j].sort_order === s.sort_order) { for (let k = 0; k < all.length; k++) await db.update('form_sections', { sort_order: (k + 1) * 10 }, { id: all[k === i ? j : k === j ? i : k].id }); } }
  } else {
    upd.title = utils.normalizePersian(req.body.title) || s.title; upd.description = utils.normalizePersian(req.body.description) || null;
    if (s.repeatable) { upd.min_rows = Math.max(0, parseInt(req.body.min_rows, 10) || 0); upd.max_rows = Math.min(20, Math.max(1, parseInt(req.body.max_rows, 10) || 5)); }
  }
  await db.update('form_sections', upd, { id: s.id });
  forms.invalidate();
  req.flash('success', 'ذخیره شد.');
  res.redirect('/recruitment/form-builder#sec-' + s.key);
});
function fieldData(body, existing) {
  const type = forms.TYPES[body.type] ? body.type : (existing ? existing.type : 'text');
  const opts = forms.OPTION_TYPES.includes(type) ? String(body.options || '').split(/\r?\n|،|,/).map((o) => utils.normalizePersian(o)).filter(Boolean) : null;
  return { label: utils.normalizePersian(body.label) || (existing ? existing.label : 'فیلد'), type, options: opts ? JSON.stringify(opts) : null, placeholder: utils.normalizePersian(body.placeholder) || null, help: utils.normalizePersian(body.help) || null, required: body.required === '1' ? 1 : 0, width: [2, 3, 4, 6, 8, 12].includes(parseInt(body.width, 10)) ? parseInt(body.width, 10) : 6, show_if: utils.normalizePersian(body.show_if) || null, updated_at: db.now() };
}
router.post('/form-builder/field', auth.requirePermission('forms.manage'), async (req, res) => {
  const sec = await db.table('form_sections').where('key', req.body.section_key).first();
  if (!sec) return res.redirect('/recruitment/form-builder');
  let key = String(req.body.key || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40);
  if (!key) key = 'custom_' + Date.now().toString(36);
  if (await db.table('form_fields').where('section_key', sec.key).where('key', key).exists()) { req.flash('danger', 'کلید فیلد تکراری است.'); return res.redirect('/recruitment/form-builder#sec-' + sec.key); }
  const max = await db.table('form_fields').where('section_key', sec.key).count();
  await db.insert('form_fields', Object.assign({ section_key: sec.key, key, enabled: 1, sort_order: (max + 1) * 10, is_system: 0, validation: null, created_at: db.now() }, fieldData(req.body)));
  forms.invalidate();
  await activity.log(req, 'create', 'form_field', null, `افزودن فیلد ${key} به ${sec.title}`);
  req.flash('success', 'فیلد افزوده شد.');
  res.redirect('/recruitment/form-builder#sec-' + sec.key);
});
router.post('/form-builder/field/:id', auth.requirePermission('forms.manage'), async (req, res) => {
  const f = await db.findById('form_fields', req.params.id); if (!f) return res.redirect('/recruitment/form-builder');
  const a = req.body._action; const locked = Number(f.is_system) === 2;
  if (a === 'toggle') { if (locked) { req.flash('warning', 'این فیلد پایه قابل غیرفعال‌سازی نیست.'); return res.redirect('/recruitment/form-builder#sec-' + f.section_key); } await db.update('form_fields', { enabled: f.enabled ? 0 : 1, updated_at: db.now() }, { id: f.id }); }
  else if (a === 'required') { if (locked) { req.flash('warning', 'این فیلد همیشه الزامی است.'); return res.redirect('/recruitment/form-builder#sec-' + f.section_key); } await db.update('form_fields', { required: f.required ? 0 : 1, updated_at: db.now() }, { id: f.id }); }
  else if (a === 'delete') { if (Number(f.is_system)) { req.flash('warning', 'فیلدهای پیش‌فرض حذف نمی‌شوند؛ آن‌ها را غیرفعال کنید.'); return res.redirect('/recruitment/form-builder#sec-' + f.section_key); } await db.remove('form_fields', { id: f.id }); }
  else if (a === 'up' || a === 'down') {
    const all = await db.table('form_fields').where('section_key', f.section_key).orderBy('sort_order').orderBy('id').all();
    const i = all.findIndex((x) => x.id === f.id); const j = a === 'up' ? i - 1 : i + 1;
    if (j >= 0 && j < all.length) { const order = all.map((x) => x.id); [order[i], order[j]] = [order[j], order[i]]; for (let k = 0; k < order.length; k++) await db.update('form_fields', { sort_order: (k + 1) * 10 }, { id: order[k] }); }
  } else {
    const d = fieldData(req.body, f);
    if (Number(f.is_system)) { d.type = f.type; } // نوع فیلدهای پیش‌فرض ثابت است
    if (locked) d.required = 1;
    await db.update('form_fields', d, { id: f.id });
  }
  forms.invalidate();
  req.flash('success', 'ذخیره شد.');
  res.redirect('/recruitment/form-builder#sec-' + f.section_key);
});
router.post('/form-builder/options', auth.requirePermission('forms.manage'), async (req, res) => {
  await settings.set('recruitment_require_photo', req.body.require_photo === '1' ? '1' : '0');
  await settings.set('recruitment_require_resume', req.body.require_resume === '1' ? '1' : '0');
  req.flash('success', 'ذخیره شد.');
  res.redirect('/recruitment/form-builder');
});
router.post('/form-builder/reset', auth.requirePermission('forms.manage'), async (req, res) => {
  await db.table('form_fields').delete(); await db.table('form_sections').delete();
  await forms.ensureDefaults();
  await activity.log(req, 'update', 'form_field', null, 'بازنشانی فرم استخدام به پیش‌فرض');
  req.flash('success', 'فرم به حالت پیش‌فرض بازگشت.');
  res.redirect('/recruitment/form-builder');
});
router.get('/form-builder/preview', auth.requirePermission('forms.manage'), async (req, res) => {
  const secs = await forms.steps();
  res.render(v('form-preview'), { title: 'پیش‌نمایش فرم', secs, forms });
});

// ---------------- واحدهای سازمانی ----------------
crud(router, {
  path: '/departments', table: 'departments', title: 'واحد سازمانی', plural: 'واحدهای سازمانی', roles: ['hr_manager', 'super'], viewRoles: ['hr_manager', 'hr_staff', 'super'], permission: 'jobs.manage', viewPermission: 'jobs.view', orderBy: 'sort_order',
  fields: [
    { name: 'title', label: 'عنوان', type: 'text', required: true, list: true, search: true },
    { name: 'code', label: 'کد', type: 'text', list: true },
    { name: 'manager_id', label: 'مدیر واحد', type: 'select', list: true, options: async () => { const u = await db.table('users').whereNotIn('role', ['applicant']).where('status', 'active').orderBy('name').all(); return u.map((x) => ({ value: x.id, label: x.name || x.username })); } },
    { name: 'description', label: 'توضیحات', type: 'textarea' },
    { name: 'sort_order', label: 'ترتیب', type: 'number', list: true }
  ]
});

module.exports = router;
