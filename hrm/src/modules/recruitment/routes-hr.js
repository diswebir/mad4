'use strict';
/** پنل منابع انسانی — پرونده‌های استخدام: فهرست، کانبان، پرونده، ارزیابی، مصاحبه، یادداشت، خروجی */
const path = require('path');
const express = require('express');
const db = require('../../core/db');
const auth = require('../../core/auth');
const settings = require('../../core/settings');
const modules = require('../../core/modules');
const utils = require('../../core/utils');
const J = require('../../core/jalali');
const activity = require('../../core/activity');
const notify = require('../../core/notify');
const permissions = require('../../core/permissions');
const forms = require('./forms');
const service = require('./service');

const router = express.Router();
const v = (n) => path.join(__dirname, 'views', 'hr', n + '.ejs');
const can = (req, k) => permissions.can(req.user, k);

router.use(auth.requireAuth, (req, res, next) => (req.user.role === 'applicant' ? res.redirect('/portal') : next()));
router.get('/', (req, res) => res.redirect('/recruitment/applications'));

// ---------------- فهرست پرونده‌ها ----------------
function baseQuery(req) {
  const q = db.table('applications as a').select('a.*', 'p.title as position_title', 'u.name as assignee_name')
    .leftJoin('job_positions as p', 'a.position_id', 'p.id').leftJoin('users as u', 'a.assigned_to', 'u.id');
  const f = req.query;
  if (f.q) q.search(utils.normalizePersian(f.q), ['a.first_name', 'a.last_name', 'a.national_id', 'a.mobile', 'a.tracking_code', 'a.email', 'p.title']);
  if (f.status && f.status !== 'all') q.where('a.status', f.status);
  else if (!f.status) q.whereNotIn('a.status', ['draft', 'archived']);
  if (f.position) q.where('a.position_id', parseInt(f.position, 10) || 0);
  if (f.source) q.where('a.source', f.source);
  if (f.assigned === 'me') q.where('a.assigned_to', req.user.id);
  else if (f.assigned === 'none') q.whereNull('a.assigned_to');
  if (f.rating) q.where('a.rating', '>=', parseInt(f.rating, 10) || 0);
  if (f.from) { const g = J.toGregorian(f.from); if (g) q.where('a.submitted_at', '>=', g + ' 00:00:00'); }
  if (f.to) { const g = J.toGregorian(f.to); if (g) q.where('a.submitted_at', '<=', g + ' 23:59:59'); }
  if (f.type) q.whereRaw('EXISTS (SELECT 1 FROM assessment_attempts t WHERE t.application_id = a.id AND t.result_type = ?)', [String(f.type).toUpperCase()]);
  if (f.tag) q.where('a.tags', 'like', '%' + utils.normalizePersian(f.tag) + '%');
  const sorts = { newest: ['a.submitted_at', 'desc'], oldest: ['a.submitted_at', 'asc'], rating: ['a.rating', 'desc'], activity: ['a.last_activity_at', 'desc'], name: ['a.last_name', 'asc'] };
  const s = sorts[f.sort] || sorts.newest;
  q.orderBy(s[0], s[1]).orderBy('a.id', 'desc');
  return q;
}
async function listCommon() {
  return { positions: await db.table('job_positions').orderBy('status').orderBy('title').all(), staff: await db.table('users').whereIn('role', ['hr_manager', 'hr_staff', 'super']).where('status', 'active').orderBy('name').all() };
}

router.get('/applications', auth.requirePermission('applicants.view'), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const perPage = settings.getInt('items_per_page', 20);
  const result = await baseQuery(req).paginate(page, perPage);
  const counts = {}; (await db.table('applications').select('status', 'COUNT(*) AS c').groupBy('status').all()).forEach((r) => (counts[r.status] = r.c));
  const ids = result.data.map((a) => a.id);
  let types = {};
  if (ids.length && modules.isEnabled('assessments')) (await db.table('assessment_attempts').whereIn('application_id', ids).where('status', 'completed').whereNotNull('result_type').all()).forEach((t) => (types[t.application_id] = t.result_type));
  res.render(v('applications'), Object.assign({ title: 'پرونده‌های استخدام', result, counts, types, query: req.query, sources: { web: 'وب', qr: 'QR / حضوری', manual: 'ثبت دستی' } }, await listCommon()));
});

router.get('/applications/board', auth.requirePermission('applicants.view'), async (req, res) => {
  const cols = ['submitted', 'screening', 'test', 'interview', 'offer', 'hired', 'rejected'];
  const rows = await baseQuery(Object.assign({}, req, { query: Object.assign({}, req.query, { status: 'all' }) })).whereIn('a.status', cols).limit(400).all();
  const board = {}; cols.forEach((c) => (board[c] = []));
  rows.forEach((r) => board[r.status].push(r));
  res.render(v('board'), Object.assign({ title: 'تابلوی فرایند استخدام', board, cols, query: req.query }, await listCommon()));
});

router.get('/applications/export', auth.requirePermission('applicants.export'), async (req, res) => {
  const rows = await baseQuery(req).limit(5000).all();
  const secs = await forms.definition({ all: true });
  const head = ['کد پیگیری', 'نام', 'نام خانوادگی', 'کد ملی', 'موبایل', 'ایمیل', 'موقعیت', 'وضعیت', 'امتیاز', 'تاریخ ارسال', 'تیپ MBTI'];
  const extraFields = [];
  for (const s of secs) if (!s.repeatable) for (const f of s.fields) if (!['first_name', 'last_name', 'national_id', 'mobile', 'email', 'accept'].includes(f.key)) extraFields.push([s, f]);
  extraFields.forEach(([s, f]) => head.push(s.title + ' / ' + f.label));
  const ids = rows.map((r) => r.id); let types = {};
  if (ids.length && modules.isEnabled('assessments')) (await db.table('assessment_attempts').whereIn('application_id', ids).where('status', 'completed').all()).forEach((t) => (types[t.application_id] = t.result_type));
  const data = rows.map((r) => {
    const d = service.data(r);
    const line = [r.tracking_code, r.first_name, r.last_name, r.national_id, r.mobile, r.email, r.position_title, service.STATUS[r.status] ? service.STATUS[r.status][1] : r.status, r.rating, J.formatDateTime(r.submitted_at), types[r.id] || ''];
    extraFields.forEach(([s, f]) => line.push(forms.display(f, d[s.key] ? d[s.key][f.key] : null)));
    return line;
  });
  await activity.log(req, 'export', 'application', null, 'خروجی اکسل پرونده‌ها');
  const columns = head.map((label, i) => ({ label, value: (r) => r[i], text: i < 6 }));
  return utils.sendExport(res, 'applications', data, columns, req.query.format || 'xlsx');
});

/** ثبت دستی پرونده توسط HR (متقاضی حضوری بدون موبایل هوشمند) */
router.get('/applications/new', auth.requirePermission('applicants.manage'), async (req, res) => {
  res.render(v('new'), Object.assign({ title: 'ثبت پروندهٔ جدید' }, await listCommon()));
});
router.post('/applications/new', auth.requirePermission('applicants.manage'), async (req, res) => {
  const mobile = utils.normalizePhone(req.body.mobile);
  const first = utils.normalizePersian(req.body.first_name), last = utils.normalizePersian(req.body.last_name);
  if (!utils.isValidMobile(mobile) || !first || !last) { req.flash('danger', 'نام، نام خانوادگی و موبایل معتبر الزامی است.'); req.keepInput(); return res.redirect('/recruitment/applications/new'); }
  let user = await db.table('users').where('mobile', mobile).where('role', 'applicant').first();
  const now = db.now();
  if (!user) {
    const id = await db.insert('users', { username: 'm' + mobile, password: null, role: 'applicant', name: first + ' ' + last, mobile, status: 'active', created_by: req.user.id, created_at: now, updated_at: now });
    user = await db.findById('users', id);
  }
  const existing = await service.currentApplication(user.id);
  if (existing && existing.status !== 'draft') { req.flash('warning', 'این متقاضی پروندهٔ فعال دارد.'); return res.redirect('/recruitment/applications/' + existing.id); }
  const app = existing || await service.createApplication(user, { positionId: parseInt(req.body.position_id, 10) || null, source: 'manual' });
  const d = service.data(app); d.personal = Object.assign({}, d.personal, { first_name: first, last_name: last, mobile, national_id: J.toEnglishDigits(req.body.national_id || '').replace(/\D/g, '') || null });
  await service.saveData(app, d, { position_id: parseInt(req.body.position_id, 10) || app.position_id || null, status: 'submitted', submitted_at: now });
  await service.addHistory(app.id, 'draft', 'submitted', req.user.id, 'ثبت دستی توسط منابع انسانی');
  await activity.log(req, 'create', 'application', app.id, 'ثبت دستی پرونده ' + app.tracking_code);
  req.flash('success', 'پرونده ایجاد شد. متقاضی می‌تواند با همین شماره وارد شود و فرم را تکمیل کند.');
  res.redirect('/recruitment/applications/' + app.id);
});

// ---------------- عملیات گروهی ----------------
router.post('/applications/bulk', auth.requirePermission('applicants.manage'), async (req, res) => {
  const ids = [].concat(req.body.ids || []).map((x) => parseInt(x, 10)).filter(Boolean);
  const back = req.get('referer') || '/recruitment/applications';
  if (!ids.length) { req.flash('warning', 'موردی انتخاب نشده است.'); return res.redirect(back); }
  const action = req.body.action;
  let n = 0;
  for (const id of ids) {
    const app = await db.findById('applications', id); if (!app) continue;
    if (action === 'status' && service.STATUS[req.body.status]) { if (['hired', 'rejected'].includes(req.body.status) && !can(req, 'applicants.decide')) continue; await service.setStatus(app, req.body.status, req.user, { note: 'تغییر گروهی', sms: req.body.sms === '1' }); n++; }
    else if (action === 'assign') { await db.update('applications', { assigned_to: parseInt(req.body.assigned_to, 10) || null, updated_at: db.now() }, { id }); n++; }
    else if (action === 'delete' && can(req, 'applicants.delete')) { await removeApplication(app); n++; }
    else if (action === 'tag' && req.body.tag) { const tags = new Set(String(app.tags || '').split(',').map((t) => t.trim()).filter(Boolean)); tags.add(utils.normalizePersian(req.body.tag)); await db.update('applications', { tags: [...tags].join(','), updated_at: db.now() }, { id }); n++; }
  }
  await activity.log(req, 'update', 'application', null, `عملیات گروهی ${action} روی ${n} پرونده`);
  req.flash('success', `${J.toPersianDigits(n)} پرونده به‌روزرسانی شد.`);
  res.redirect(back);
});

async function removeApplication(app) {
  const upload = require('../../core/upload');
  for (const f of await db.table('application_files').where('application_id', app.id).all()) upload.removeFile(f.path);
  if (app.photo) upload.removeFile(app.photo); if (app.resume) upload.removeFile(app.resume);
  for (const t of ['application_files', 'application_notes', 'application_history', 'application_evaluations', 'interviews', 'assessment_attempts']) await db.table(t).where('application_id', app.id).delete();
  await db.remove('applications', { id: app.id });
}

// ---------------- پرونده ----------------
async function loadApp(req, res) {
  const app = await db.table('applications as a').select('a.*', 'p.title as position_title', 'p.preferred_types', 'p.require_test', 'u.name as assignee_name', 'au.avatar as user_avatar', 'au.last_login_at as user_last_login')
    .leftJoin('job_positions as p', 'a.position_id', 'p.id').leftJoin('users as u', 'a.assigned_to', 'u.id').leftJoin('users as au', 'a.user_id', 'au.id').where('a.id', parseInt(req.params.id, 10) || 0).first();
  if (!app) { res.status(404).render('errors/404', { title: 'یافت نشد' }); return null; }
  app.d = service.data(app);
  return app;
}

router.get('/applications/:id', auth.requirePermission('applicants.view'), async (req, res) => {
  const app = await loadApp(req, res); if (!app) return;
  const secs = await forms.definition({ all: true });
  const [files, notes, history, evaluations, interviews] = await Promise.all([
    db.table('application_files').where('application_id', app.id).all(),
    db.table('application_notes as n').select('n.*', 'u.name as user_name', 'u.avatar as user_avatar').leftJoin('users as u', 'n.user_id', 'u.id').where('n.application_id', app.id).orderBy('n.id', 'desc').all(),
    db.table('application_history as h').select('h.*', 'u.name as user_name').leftJoin('users as u', 'h.user_id', 'u.id').where('h.application_id', app.id).orderBy('h.id', 'desc').all(),
    db.table('application_evaluations as e').select('e.*', 'u.name as user_name').leftJoin('users as u', 'e.user_id', 'u.id').where('e.application_id', app.id).all(),
    db.table('interviews as i').select('i.*', 'u.name as interviewer_name').leftJoin('users as u', 'i.interviewer_id', 'u.id').where('i.application_id', app.id).orderBy('i.scheduled_at', 'desc').all()
  ]);
  let attempts = [], tests = [], mbti = null;
  if (modules.isEnabled('assessments')) {
    const asvc = require('../assessments/service');
    attempts = await asvc.attemptsOf(app.id);
    tests = await db.table('assessments').where('enabled', 1).orderBy('sort_order').all();
    mbti = attempts.find((a) => a.type === 'mbti' && a.status === 'completed') || null;
    if (mbti) mbti.report = asvc.report(mbti, app);
  }
  const dups = await service.duplicates(app, app.d);
  const notesVisible = notes.filter((n) => !n.is_private || n.user_id === req.user.id || req.user.role === 'hr_manager' || req.user.is_super);
  const transitions = service.TRANSITIONS[app.status] || [];
  res.render(v('show'), Object.assign({ title: `پرونده ${app.tracking_code}`, app, secs, forms, files, notes: notesVisible, history, evaluations, interviews, attempts, tests, mbti, dups, transitions, tab: req.query.tab || 'form', hasEmployees: modules.isEnabled('employees') }, await listCommon()));
});

router.get('/applications/:id/print', auth.requirePermission('applicants.view'), async (req, res) => {
  const app = await loadApp(req, res); if (!app) return;
  const secs = await forms.definition({ all: true });
  const evaluations = await db.table('application_evaluations as e').select('e.*', 'u.name as user_name').leftJoin('users as u', 'e.user_id', 'u.id').where('e.application_id', app.id).all();
  res.render(v('print'), { layout: 'layouts/print', title: 'فرم استخدام ' + app.tracking_code, app, secs, forms, evaluations, forApplicant: false });
});

router.post('/applications/:id/status', auth.requirePermission('applicants.manage'), async (req, res) => {
  const app = await db.findById('applications', req.params.id); if (!app) return res.redirect('/recruitment/applications');
  const to = req.body.status;
  if (!service.STATUS[to]) { req.flash('danger', 'وضعیت نامعتبر'); return res.redirect('/recruitment/applications/' + app.id); }
  if (['hired', 'rejected', 'offer'].includes(to) && !can(req, 'applicants.decide')) { req.flash('danger', 'شما مجوز تصمیم نهایی ندارید.'); return res.redirect('/recruitment/applications/' + app.id); }
  await service.setStatus(app, to, req.user, { note: req.body.note, sms: req.body.sms === '1', message: req.body.message });
  await activity.log(req, 'update', 'application', app.id, `تغییر وضعیت ${app.tracking_code}: ${app.status} → ${to}`);
  req.flash('success', 'وضعیت پرونده به‌روزرسانی شد.');
  res.redirect('/recruitment/applications/' + app.id);
});

router.post('/applications/:id/meta', auth.requirePermission('applicants.manage'), async (req, res) => {
  const app = await db.findById('applications', req.params.id); if (!app) return res.redirect('/recruitment/applications');
  const upd = { updated_at: db.now() };
  if (req.body.rating !== undefined) upd.rating = Math.min(5, Math.max(0, parseInt(req.body.rating, 10) || 0));
  if (req.body.tags !== undefined) upd.tags = [...new Set(String(req.body.tags || '').split(/[,،]/).map((t) => utils.normalizePersian(t)).filter(Boolean))].join(',').slice(0, 250) || null;
  if (req.body.assigned_to !== undefined) { upd.assigned_to = parseInt(req.body.assigned_to, 10) || null; if (upd.assigned_to && upd.assigned_to !== app.assigned_to) await notify.push(upd.assigned_to, { title: 'پرونده به شما ارجاع شد', body: `${app.first_name || ''} ${app.last_name || ''} (${app.tracking_code})`, link: '/recruitment/applications/' + app.id }); }
  if (req.body.position_id !== undefined) upd.position_id = parseInt(req.body.position_id, 10) || null;
  await db.update('applications', upd, { id: app.id });
  if (req.xhr || req.get('accept') === 'application/json') return res.json({ ok: true });
  req.flash('success', 'ذخیره شد.');
  res.redirect('/recruitment/applications/' + app.id);
});

router.post('/applications/:id/note', auth.requirePermission('applicants.view'), async (req, res) => {
  const app = await db.findById('applications', req.params.id); if (!app) return res.redirect('/recruitment/applications');
  const body = utils.normalizePersian(req.body.body);
  if (!body) { req.flash('warning', 'متن یادداشت خالی است.'); return res.redirect('/recruitment/applications/' + app.id + '?tab=notes'); }
  await db.insert('application_notes', { application_id: app.id, user_id: req.user.id, body: body.slice(0, 4000), kind: 'note', is_private: req.body.is_private === '1' ? 1 : 0, created_at: db.now() });
  await db.update('applications', { last_activity_at: db.now() }, { id: app.id });
  req.flash('success', 'یادداشت ثبت شد.');
  res.redirect('/recruitment/applications/' + app.id + '?tab=notes');
});
router.post('/applications/:id/note/:nid/delete', auth.requirePermission('applicants.view'), async (req, res) => {
  const n = await db.findById('application_notes', req.params.nid);
  if (n && (n.user_id === req.user.id || req.user.role === 'hr_manager' || req.user.is_super)) await db.remove('application_notes', { id: n.id });
  res.redirect('/recruitment/applications/' + req.params.id + '?tab=notes');
});

/** ارزیابی سه‌مرحله‌ای (مصاحبه‌کننده / منابع انسانی / مدیریت) */
router.post('/applications/:id/evaluate', auth.requirePermission('applicants.evaluate'), async (req, res) => {
  const app = await db.findById('applications', req.params.id); if (!app) return res.redirect('/recruitment/applications');
  const stage = req.body.stage;
  if (!utils.EVAL_STAGES[stage]) return res.redirect('/recruitment/applications/' + app.id);
  if (stage === 'management' && !can(req, 'applicants.decide')) { req.flash('danger', 'ثبت نظر مدیریت نیازمند مجوز تصمیم نهایی است.'); return res.redirect('/recruitment/applications/' + app.id + '?tab=eval'); }
  const data = { opinion: utils.normalizePersian(req.body.opinion) || null, decision: utils.DECISIONS[req.body.decision] ? req.body.decision : null, score: Math.min(10, Math.max(0, parseInt(req.body.score, 10) || 0)) || null, strengths: utils.normalizePersian(req.body.strengths) || null, weaknesses: utils.normalizePersian(req.body.weaknesses) || null, user_id: req.user.id, updated_at: db.now() };
  const existing = await db.table('application_evaluations').where('application_id', app.id).where('stage', stage).first();
  if (existing) await db.update('application_evaluations', data, { id: existing.id });
  else await db.insert('application_evaluations', Object.assign({ application_id: app.id, stage, created_at: db.now() }, data));
  await db.update('applications', { last_activity_at: db.now(), updated_at: db.now() }, { id: app.id });
  await activity.log(req, 'update', 'application', app.id, `ثبت ${utils.EVAL_STAGES[stage]} برای ${app.tracking_code}`);
  // تصمیم مدیریت = تصمیم نهایی
  if (stage === 'management' && data.decision && req.body.apply_decision === '1') {
    const to = data.decision === 'suitable' ? 'offer' : data.decision === 'rejected' ? 'rejected' : 'screening';
    if (to !== app.status) await service.setStatus(app, to, req.user, { note: 'بر اساس نظر مدیریت', sms: req.body.sms === '1' });
  }
  req.flash('success', 'ارزیابی ثبت شد.');
  res.redirect('/recruitment/applications/' + app.id + '?tab=eval');
});

router.post('/applications/:id/delete', auth.requirePermission('applicants.delete'), async (req, res) => {
  const app = await db.findById('applications', req.params.id);
  if (app) { await removeApplication(app); await activity.log(req, 'delete', 'application', app.id, 'حذف پرونده ' + app.tracking_code); req.flash('success', 'پرونده حذف شد.'); }
  res.redirect('/recruitment/applications');
});

/** تبدیل به کارمند (پس از استخدام) */
router.post('/applications/:id/hire', auth.requirePermission('applicants.decide'), modules.requireEnabled('employees'), async (req, res) => {
  const app = await db.findById('applications', req.params.id); if (!app) return res.redirect('/recruitment/applications');
  const emp = await require('../employees/service').fromApplication(app, req.user, { department_id: parseInt(req.body.department_id, 10) || null, position_title: req.body.position_title, hire_date: J.toGregorian(req.body.hire_date) || J.todayISO() });
  if (app.status !== 'hired') await service.setStatus(app, 'hired', req.user, { note: 'تبدیل به کارمند', sms: req.body.sms === '1' });
  await activity.log(req, 'create', 'employee', emp.id, 'ایجاد کارمند از پرونده ' + app.tracking_code);
  req.flash('success', 'پروندهٔ کارمند ایجاد شد.');
  res.redirect('/employees/' + emp.id);
});

/** ارسال پیامک آزاد به متقاضی */
router.post('/applications/:id/sms', auth.requirePermission('applicants.manage'), modules.requireEnabled('notifications.sms'), async (req, res) => {
  const app = await db.findById('applications', req.params.id); if (!app || !app.mobile) return res.redirect('/recruitment/applications');
  const text = utils.normalizePersian(req.body.text);
  if (!text) { req.flash('warning', 'متن پیامک خالی است.'); return res.redirect('/recruitment/applications/' + app.id); }
  const r = await notify.sms(app.mobile, text, { kind: 'manual', userId: app.user_id });
  await db.insert('application_notes', { application_id: app.id, user_id: req.user.id, body: 'پیامک ارسال شد: ' + text, kind: 'sms', is_private: 0, created_at: db.now() });
  req.flash(r.ok ? 'success' : 'danger', r.ok ? 'پیامک ارسال شد.' : 'ارسال ناموفق: ' + (r.error || ''));
  res.redirect('/recruitment/applications/' + app.id + '?tab=notes');
});

// ---------------- مصاحبه‌ها ----------------
router.get('/interviews', auth.requirePermission('interviews.manage'), async (req, res) => {
  const q = db.table('interviews as i').select('i.*', 'a.first_name', 'a.last_name', 'a.tracking_code', 'a.mobile', 'u.name as interviewer_name', 'p.title as position_title')
    .join('applications as a', 'i.application_id', 'a.id').leftJoin('users as u', 'i.interviewer_id', 'u.id').leftJoin('job_positions as p', 'a.position_id', 'p.id');
  const scope = req.query.scope || 'upcoming';
  if (scope === 'upcoming') q.where('i.scheduled_at', '>=', J.todayISO() + ' 00:00:00').whereIn('i.status', ['scheduled']);
  else if (scope === 'past') q.where('i.scheduled_at', '<', J.todayISO() + ' 00:00:00');
  if (req.query.mine === '1') q.where('i.interviewer_id', req.user.id);
  q.orderBy('i.scheduled_at', scope === 'past' ? 'desc' : 'asc');
  const result = await q.paginate(Math.max(1, parseInt(req.query.page, 10) || 1), 20);
  const today = J.todayISO();
  res.render(v('interviews'), Object.assign({ title: 'مصاحبه‌ها', result, scope, query: req.query, today }, await listCommon()));
});
router.post('/applications/:id/interviews', auth.requirePermission('interviews.manage'), async (req, res) => {
  const app = await db.findById('applications', req.params.id); if (!app) return res.redirect('/recruitment/applications');
  const date = J.toGregorian(req.body.date); const time = J.toEnglishDigits(req.body.time || '').trim();
  if (!date || !/^\d{1,2}:\d{2}$/.test(time)) { req.flash('danger', 'تاریخ و ساعت مصاحبه معتبر نیست.'); return res.redirect('/recruitment/applications/' + app.id + '?tab=interviews'); }
  const scheduled_at = date + ' ' + time.padStart(5, '0') + ':00';
  const id = await db.insert('interviews', { application_id: app.id, interviewer_id: parseInt(req.body.interviewer_id, 10) || req.user.id, scheduled_at, duration_min: parseInt(req.body.duration_min, 10) || 45, location: utils.normalizePersian(req.body.location) || null, kind: ['in_person', 'phone', 'online'].includes(req.body.kind) ? req.body.kind : 'in_person', status: 'scheduled', created_by: req.user.id, created_at: db.now(), updated_at: db.now() });
  if (app.status !== 'interview' && ['submitted', 'screening', 'test'].includes(app.status)) await service.setStatus(app, 'interview', req.user, { note: 'تعیین وقت مصاحبه', notifyApplicant: false });
  const when = J.formatDateTime(scheduled_at);
  const name = [app.first_name, app.last_name].filter(Boolean).join(' ');
  if (app.user_id) await notify.push(app.user_id, { title: 'دعوت به مصاحبه', body: `زمان مصاحبهٔ شما: ${when}${req.body.location ? ' — ' + req.body.location : ''}`, link: '/portal', type: 'success' });
  if (req.body.sms === '1' && app.mobile) { const r = await notify.smsTemplate(app.mobile, 'sms_template_interview', { name, date: J.formatDate(scheduled_at), time: J.formatTime(scheduled_at), location: req.body.location || settings.get('company_address') || 'دفتر شرکت' }, { userId: app.user_id }); if (r.ok) await db.update('interviews', { notified_at: db.now() }, { id }); }
  const iv = parseInt(req.body.interviewer_id, 10); if (iv && iv !== req.user.id) await notify.push(iv, { title: 'مصاحبهٔ جدید برای شما', body: `${name} — ${when}`, link: '/recruitment/applications/' + app.id + '?tab=interviews' });
  await activity.log(req, 'create', 'interview', id, `مصاحبه برای ${app.tracking_code} در ${when}`);
  req.flash('success', 'مصاحبه ثبت شد.');
  res.redirect('/recruitment/applications/' + app.id + '?tab=interviews');
});
router.post('/interviews/:iid/status', auth.requirePermission('interviews.manage'), async (req, res) => {
  const iv = await db.findById('interviews', req.params.iid); if (!iv) return res.redirect('/recruitment/interviews');
  const st = ['scheduled', 'done', 'cancelled', 'no_show'].includes(req.body.status) ? req.body.status : iv.status;
  await db.update('interviews', { status: st, result: utils.normalizePersian(req.body.result) || iv.result, updated_at: db.now() }, { id: iv.id });
  req.flash('success', 'وضعیت مصاحبه ثبت شد.');
  res.redirect(req.get('referer') || '/recruitment/interviews');
});
router.post('/interviews/:iid/delete', auth.requirePermission('interviews.manage'), async (req, res) => {
  await db.remove('interviews', { id: req.params.iid });
  res.redirect(req.get('referer') || '/recruitment/interviews');
});

// ---------------- گزارش‌ها ----------------
router.get('/reports', auth.requirePermission('reports.view'), async (req, res) => {
  const days = Math.min(365, Math.max(7, parseInt(req.query.days, 10) || 90));
  const st = await service.stats(days);
  const all = await db.table('applications').whereNotIn('status', ['draft']).all();
  const bySource = {}; all.forEach((a) => (bySource[a.source || 'web'] = (bySource[a.source || 'web'] || 0) + 1));
  const funnel = ['submitted', 'screening', 'test', 'interview', 'offer', 'hired'].map((k) => ({ key: k, label: service.STATUS[k][1], count: all.filter((a) => { const flow = utils.APP_STATUS_FLOW; const i = flow.indexOf(a.status); const j = flow.indexOf(k); return (i >= j && i >= 0) || (a.status === 'rejected' && j <= 1); }).length }));
  // ترکیب تیپ‌ها
  let typeDist = {}, dimDist = { E: 0, I: 0, S: 0, N: 0, T: 0, F: 0, J: 0, P: 0 };
  if (modules.isEnabled('assessments')) {
    const rows = await db.table('assessment_attempts').where('status', 'completed').whereNotNull('result_type').all();
    rows.forEach((r) => { typeDist[r.result_type] = (typeDist[r.result_type] || 0) + 1; for (const ch of r.result_type) if (dimDist[ch] !== undefined) dimDist[ch]++; });
  }
  // میانگین زمان تا تصمیم
  const decided = all.filter((a) => a.decided_at && a.submitted_at);
  const avgDays = decided.length ? Math.round(decided.reduce((s, a) => s + (new Date(a.decided_at) - new Date(a.submitted_at)) / 86400000, 0) / decided.length) : 0;
  // منابع آشنایی (از فرم)
  const referral = {}; all.forEach((a) => { const d = service.data(a); const r = d.expectations && d.expectations.referral_source; if (r) referral[r] = (referral[r] || 0) + 1; });
  // جدول ماهانه
  const months = {}; all.forEach((a) => { if (!a.submitted_at) return; const p = J.toJalaliParts(a.submitted_at.slice(0, 10)); if (!p) return; const k = p.jy + '/' + String(p.jm).padStart(2, '0'); months[k] = months[k] || { total: 0, hired: 0, rejected: 0 }; months[k].total++; if (a.status === 'hired') months[k].hired++; if (a.status === 'rejected') months[k].rejected++; });
  res.render(v('reports'), { title: 'گزارش‌های استخدام', days, st, bySource, funnel, typeDist, dimDist, avgDays, referral, months: Object.keys(months).sort().reverse().slice(0, 12).map((k) => Object.assign({ month: k }, months[k])), sources: { web: 'وب', qr: 'QR / حضوری', manual: 'ثبت دستی' } });
});

module.exports = router;
