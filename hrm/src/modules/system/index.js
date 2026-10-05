'use strict';
/** ماژول سیستم (هسته): تنظیمات، ماژول‌ها، لاگ‌ها، پشتیبان‌گیری، دادهٔ نمونه، کارهای زمان‌بندی‌شده، اطلاعات سامانه */
const path = require('path');
const fs = require('fs');
const os = require('os');
const express = require('express');
const db = require('../../core/db');
const config = require('../../core/config');
const settings = require('../../core/settings');
const settingsMeta = require('../../core/settings-meta');
const modules = require('../../core/modules');
const activity = require('../../core/activity');
const utils = require('../../core/utils');
const J = require('../../core/jalali');
const schema = require('../../../database/schema');
const backup = require('../../core/backup');
const scheduler = require('../../core/scheduler');
const auth = require('../../core/auth');
const upload = require('../../core/upload');
const health = require('../../core/health');
const maintenance = require('../../core/maintenance');
const logger = require('../../core/logger');
const sms = require('../../core/sms');
const pkg = require('../../../package.json');

const router = express.Router();
const v = (n) => path.join(__dirname, 'views', n + '.ejs');
router.use(auth.requireAuth, (req, res, next) => (req.user.role === 'applicant' ? res.redirect('/portal') : next()));
router.use('/settings', auth.requirePermission('settings.manage'));
router.use('/modules', auth.requirePermission('modules.manage'));
router.use('/activity', auth.requirePermission('logs.view'));
router.use('/logins', auth.requirePermission('logs.view'));
router.use('/errors', auth.requirePermission('logs.view'));
router.use('/backup', auth.requirePermission('backup.manage'));
router.use('/demo', auth.requirePermission('settings.manage'));
router.use('/info', auth.requirePermission('settings.manage'));
router.use('/jobs', auth.requirePermission('settings.manage'));
router.get('/', (req, res) => res.redirect('/system/settings'));

// ---------------- تنظیمات ----------------
const TABS = settingsMeta.TABS;
const tabsFor = (req) => TABS.filter((t) => t.key !== 'advanced' || req.user.is_super || req.user.role === 'super' || req.user.role === 'hr_manager');
function advancedList() {
  const all = settings.all(); const storedSet = new Set(settings.storedKeys());
  return Object.keys(settings.DEFAULTS).map((key) => { const m = settingsMeta.meta(key); const value = all[key] == null ? '' : String(all[key]); const def = settings.DEFAULTS[key] == null ? '' : String(settings.DEFAULTS[key]); return { key, value, display: m.type === 'secret' && value ? '••••••' : value, label: m.label, group: m.group, groupTitle: settingsMeta.GROUPS[m.group] || m.group, type: m.type, help: m.help, stored: storedSet.has(key), isDefault: value === def, defaultValue: def }; })
    .sort((a, b) => a.group.localeCompare(b.group) || a.key.localeCompare(b.key));
}
router.get('/settings', async (req, res) => {
  const visible = tabsFor(req);
  const tab = visible.find((t) => t.key === req.query.tab) || visible[0];
  const extra = {};
  if (tab.key === 'maintenance') { extra.healthInfo = await health.check(); extra.maintenanceActive = maintenance.isOn(); }
  if (tab.key === 'advanced') { extra.allKeys = advancedList(); extra.q = utils.normalizePersian(String(req.query.q || '')).trim(); }
  if (tab.key === 'sms') { extra.smsStatus = sms.status(); extra.smsStats = {}; (await db.table('sms_logs').select('status', 'COUNT(*) AS c').groupBy('status').all()).forEach((r) => (extra.smsStats[r.status] = r.c)); }
  if (tab.key === 'company') extra.logo = settings.get('company_logo');
  res.render(v('settings'), Object.assign({ title: 'تنظیمات سامانه', tabs: visible, tab: tab.key, tabDef: tab, s: settings.all(), meta: settingsMeta.META }, extra));
});
const NUMERIC_RE = /_(attempts|minutes|days|percent|length|keep|mb|price|seconds|hour|page|next|limit)$/;
router.post('/settings/advanced/set', async (req, res) => {
  const key = String(req.body.key || '').trim();
  const back = '/system/settings?tab=advanced' + (req.body.q ? '&q=' + encodeURIComponent(req.body.q) : '');
  if (!/^[a-z][a-z0-9_]{1,60}$/.test(key) || settingsMeta.isInternal(key) || settings.DEFAULTS[key] === undefined) { req.flash('danger', 'این کلید قابل ویرایش نیست.'); return res.redirect(back); }
  const m = settingsMeta.meta(key);
  if (req.body.reset === '1') { await settings.unset(key); req.flash('success', `«${m.label}» به مقدار پیش‌فرض برگشت.`); return res.redirect(back); }
  let val = req.body.value === undefined ? '' : String(Array.isArray(req.body.value) ? req.body.value[req.body.value.length - 1] : req.body.value);
  if (m.type === 'secret' && val === '••••••') return res.redirect(back);
  val = utils.normalizePersian(val);
  if (m.type === 'number') { val = J.toEnglishDigits(val).trim(); if (val && !/^-?\d+(\.\d+)?$/.test(val)) { req.flash('danger', 'مقدار باید عددی باشد.'); return res.redirect(back); } }
  if (m.type === 'bool') val = val === '1' || val === 'true' ? '1' : '0';
  await settings.set(key, val.slice(0, 5000));
  if (key === 'timezone_offset') J.setTimezoneOffset(val);
  await activity.log(req, 'settings', 'settings', null, `ویرایش تنظیم «${key}»` + (m.type === 'secret' ? '' : `: ${val.slice(0, 60)}`));
  req.flash('success', `«${m.label}» ذخیره شد.`);
  res.redirect(back);
});
router.get('/settings/export.json', (req, res) => {
  const out = {}; for (const k of Object.keys(settings.DEFAULTS)) if (!settingsMeta.isSecret(k) && !settingsMeta.isInternal(k)) out[k] = settings.get(k);
  res.setHeader('Content-Disposition', 'attachment; filename="hrm-settings.json"'); res.json(out);
});
router.post('/settings/import', ...upload.form('settings', 'single', 'file', { maxMb: 2, maxFiles: 1, types: ['application/json', 'text/json', 'text/plain', 'application/octet-stream'] }), async (req, res) => {
  if (!req.file) { req.flash('danger', 'فایلی انتخاب نشده است.'); return res.redirect('/system/settings?tab=advanced'); }
  try {
    const data = JSON.parse(fs.readFileSync(req.file.path, 'utf8')); const patch = {};
    for (const [k, val] of Object.entries(data)) if (settings.DEFAULTS[k] !== undefined && !settingsMeta.isInternal(k) && !settingsMeta.isSecret(k)) patch[k] = String(val).slice(0, 5000);
    await settings.setMany(patch); req.flash('success', `${J.toPersianDigits(Object.keys(patch).length)} تنظیم وارد شد.`);
  } catch (e) { req.flash('danger', 'فایل نامعتبر: ' + e.message); } finally { try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ } }
  res.redirect('/system/settings?tab=advanced');
});
router.post('/settings/test-sms', async (req, res) => {
  const mobile = utils.normalizePhone(req.body.mobile || req.user.mobile);
  if (!utils.isValidMobile(mobile)) { req.flash('danger', 'شمارهٔ موبایل معتبر وارد کنید.'); return res.redirect('/system/settings?tab=sms'); }
  const r = await sms.send(mobile, `پیامک آزمایشی ${settings.get('company_short_name') || settings.get('company_name')} — ${J.formatDateTime(J.nowISO())}`, { kind: 'test', userId: req.user.id });
  req.flash(r.ok ? 'success' : 'danger', r.ok ? `پیامک آزمایشی به ${J.toPersianDigits(mobile)} ارسال شد.` : 'ارسال ناموفق: ' + (r.error || 'نامشخص'));
  res.redirect('/system/settings?tab=sms');
});
router.post('/settings/:tab', ...upload.form('branding', 'fields', [{ name: 'company_logo', maxCount: 1 }], { images: true, maxMb: 2, maxFiles: 1 }), async (req, res) => {
  const tab = TABS.find((t) => t.key === req.params.tab && t.key !== 'advanced');
  if (!tab) return res.redirect('/system/settings');
  if (req.uploadError) { req.flash('danger', req.uploadError); return res.redirect('/system/settings?tab=' + tab.key); }
  const data = {};
  for (const k of tab.keys) {
    const m = settingsMeta.meta(k);
    let val = req.body[k];
    if (Array.isArray(val)) val = val[val.length - 1];
    if (m.type === 'bool') { data[k] = val === '1' || val === 'on' ? '1' : '0'; continue; }
    if (val === undefined) continue;
    val = utils.normalizePersian(String(val));
    if (m.type === 'secret' && val === '••••••') continue;
    if (m.type === 'number' || NUMERIC_RE.test(k)) val = J.toEnglishDigits(val).trim();
    if (m.type === 'select' && m.options && !m.options[val]) continue;
    data[k] = val.slice(0, 5000);
  }
  if (tab.key === 'company') {
    const f = req.files && req.files.company_logo && req.files.company_logo[0];
    if (f) { upload.removeFile(settings.get('company_logo')); data.company_logo = upload.relPath(f); }
    if (req.body.remove_logo === '1') { upload.removeFile(settings.get('company_logo')); data.company_logo = ''; }
    if (data.timezone_offset && !/^[+-]\d{2}:\d{2}$/.test(data.timezone_offset)) delete data.timezone_offset;
  }
  if (data.password_min_length) data.password_min_length = String(Math.min(32, Math.max(4, parseInt(data.password_min_length, 10) || 8)));
  if (data.otp_length) data.otp_length = String(Math.min(8, Math.max(4, parseInt(data.otp_length, 10) || 5)));
  if (data.disk_alert_percent) data.disk_alert_percent = String(Math.min(99, Math.max(50, parseInt(data.disk_alert_percent, 10) || 90)));
  if (data.primary_color && !/^#[0-9a-fA-F]{6}$/.test(data.primary_color)) delete data.primary_color;
  if (tab.key === 'maintenance') { const before = settings.getBool('maintenance_mode'); if (before !== (data.maintenance_mode === '1')) await activity.log(req, 'toggle', 'maintenance', null, data.maintenance_mode === '1' ? 'فعال‌سازی حالت نگهداری' : 'خروج از حالت نگهداری'); health.invalidate(); }
  await settings.setMany(data);
  if (data.timezone_offset) J.setTimezoneOffset(data.timezone_offset);
  await activity.log(req, 'settings', 'settings', null, 'به‌روزرسانی تنظیمات: ' + tab.title);
  req.flash('success', 'تنظیمات ذخیره شد.');
  res.redirect('/system/settings?tab=' + tab.key);
});

// ---------------- ماژول‌ها ----------------
router.get('/modules', (req, res) => {
  const list = modules.modules.map((m) => ({ key: m.key, name: m.name, description: m.description, icon: m.icon, category: m.category || 'main', core: !!m.core, enabled: modules.isEnabled(m.key), dependencies: m.dependencies || [], features: m.features.map((f) => Object.assign({}, f, { enabled: modules.isEnabled(f.fullKey) })) }));
  res.render(v('modules'), { title: 'ماژول‌ها و قابلیت‌ها', list, stats: modules.stats(), categories: modules.CATEGORIES });
});
router.post('/modules/toggle', async (req, res) => {
  try {
    const key = String(req.body.key || '');
    const enabled = req.body.enabled === true || req.body.enabled === 'true' || req.body.enabled === '1';
    const [modKey] = key.split('.');
    const mod = modules.getModule(modKey);
    if (!mod) throw new Error('ماژول نامعتبر');
    if (enabled && !key.includes('.')) for (const dep of mod.dependencies || []) if (!modules.isEnabled(dep)) throw new Error('ابتدا ماژول «' + (modules.getModule(dep) || {}).name + '» را فعال کنید');
    await modules.setState(key, enabled);
    await activity.log(req, 'toggle', 'module', null, `${enabled ? 'فعال' : 'غیرفعال'}‌سازی ${key}`);
    const name = key.includes('.') ? (mod.features.find((f) => f.fullKey === key) || {}).name : mod.name;
    res.json({ ok: true, message: `«${name}» ${enabled ? 'فعال' : 'غیرفعال'} شد`, stats: modules.stats(), reload: !key.includes('.') });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// ---------------- لاگ‌ها ----------------
router.get('/activity', async (req, res) => {
  const q = db.table('activity_logs as a').select('a.*', 'u.name as user_name', 'u.role as user_role', 'i.name as impersonator_name').leftJoin('users as u', 'a.user_id', 'u.id').leftJoin('users as i', 'a.impersonator_id', 'i.id').orderBy('a.id', 'desc');
  if (req.query.action) q.where('a.action', req.query.action);
  if (req.query.user) q.where('a.user_id', parseInt(req.query.user, 10) || 0);
  if (req.query.entity) q.where('a.entity', req.query.entity);
  if (req.query.q) q.search(utils.normalizePersian(req.query.q), ['a.description', 'u.name', 'a.entity']);
  if (!req.user.is_super) q.whereRaw('(u.is_super IS NULL OR u.is_super = 0)');
  const result = await q.paginate(req.query.page, 40);
  const actions = (await db.table('activity_logs').select('action').distinct().all()).map((r) => r.action).filter(Boolean);
  const entities = (await db.table('activity_logs').select('entity').distinct().all()).map((r) => r.entity).filter(Boolean);
  res.render(v('activity'), { title: 'گزارش فعالیت‌ها', result, actions, entities, query: req.query, users: await db.table('users').whereNotIn('role', ['applicant']).where('is_super', 0).orderBy('name').all() });
});
router.post('/activity/clear', async (req, res) => {
  const days = Math.max(7, parseInt(req.body.days, 10) || 90);
  const n = await db.table('activity_logs').where('created_at', '<', new Date(Date.now() - days * 86400000).toISOString().slice(0, 19).replace('T', ' ')).delete();
  req.flash('success', `${J.toPersianDigits(n)} رکورد قدیمی‌تر از ${J.toPersianDigits(days)} روز پاک شد.`);
  res.redirect('/system/activity');
});
router.get('/logins', async (req, res) => {
  const q = db.table('login_logs as l').select('l.*', 'u.name as user_name', 'u.role as user_role').leftJoin('users as u', 'l.user_id', 'u.id').orderBy('l.id', 'desc');
  if (req.query.q) q.search(J.toEnglishDigits(req.query.q), ['l.username', 'l.ip', 'u.name']);
  if (req.query.success === '0') q.where('l.success', 0); else if (req.query.success === '1') q.where('l.success', 1);
  if (req.query.kind) q.where('l.kind', req.query.kind);
  const result = await q.paginate(req.query.page, 40);
  const since = new Date(Date.now() - 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const failed24 = await db.table('login_logs').where('success', 0).where('created_at', '>=', since).count();
  res.render(v('logins'), { title: 'گزارش ورودها', result, query: req.query, failed24 });
});
router.get('/errors', async (req, res) => {
  const files = logger.files();
  const date = req.query.date || (files[0] && files[0].date) || J.todayISO();
  const lines = logger.read(date, { limit: 300, level: req.query.level || null, q: req.query.q || '' });
  res.render(v('errors'), { title: 'خطاهای سرور', files, date, lines });
});

// ---------------- پشتیبان‌گیری ----------------
router.get('/backup', async (req, res) => {
  const files = backup.list();
  const up = backup.walkUploads(); const uploadsInfo = { count: up.length, bytes: up.reduce((a, f) => a + f.size, 0) };
  const counts = {};
  for (const t of ['users', 'applications', 'assessment_attempts', 'employees', 'job_positions']) counts[t] = await db.count(t);
  res.render(v('backup'), { title: 'پشتیبان‌گیری و بازیابی', files, counts, uploadsInfo, dbInfo: db.info, fmtBytes: health.fmt, keep: settings.getInt('backup_keep', 7) });
});
router.post('/backup/create', async (req, res) => {
  const type = ['file', 'json', 'full'].includes(req.body.type) ? req.body.type : 'json';
  let name;
  try { name = await backup.create(type); } catch (e) { req.flash('danger', 'ساخت پشتیبان ناموفق: ' + e.message); return res.redirect('/system/backup'); }
  await activity.log(req, 'backup', 'system', null, 'ایجاد پشتیبان ' + name);
  req.flash('success', 'نسخهٔ پشتیبان ساخته شد: ' + name);
  res.redirect('/system/backup');
});
router.get('/backup/download/:name', (req, res) => {
  const name = path.basename(req.params.name);
  const file = path.join(backup.dir(), name);
  if (!fs.existsSync(file)) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  res.download(file, name);
});
router.post('/backup/delete/:name', (req, res) => { backup.remove(req.params.name); req.flash('success', 'فایل پشتیبان حذف شد.'); res.redirect('/system/backup'); });
router.post('/backup/restore', ...upload.form('restore', 'single', 'file', { maxMb: 2048, maxFiles: 1, types: ['application/json', 'text/json', 'text/plain', 'application/gzip', 'application/x-gzip', 'application/zip', 'application/x-zip-compressed', 'application/octet-stream'] }), async (req, res) => {
  if (req.uploadError) { req.flash('danger', req.uploadError); return res.redirect('/system/backup'); }
  if (!req.file) { req.flash('danger', 'فایلی انتخاب نشده است.'); return res.redirect('/system/backup'); }
  if (!/\.(json|gz|zip)$/i.test(req.file.originalname || '')) { try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ } req.flash('danger', 'فقط فایل‌های .json، .json.gz یا .zip پذیرفته می‌شوند.'); return res.redirect('/system/backup'); }
  const opts = { db: req.body.restore_db !== '0', files: req.body.restore_files !== '0', trusted: true };
  try {
    const r = await backup.restoreFromFile(req.file.path, req.file.originalname, opts);
    if (opts.db) { await settings.load(); await modules.loadStates(); require('../../core/permissions').reload(); require('../recruitment/forms').invalidate(); }
    await activity.log(req, 'backup', 'system', null, `بازیابی پشتیبان (${r.rows} سطر، ${r.files} فایل)`);
    req.flash('success', `بازیابی انجام شد (${J.toPersianDigits(r.rows)} سطر${r.type === 'zip' ? `، ${J.toPersianDigits(r.files)} فایل` : ''}).`);
  } catch (e) { req.flash('danger', 'بازیابی ناموفق: ' + e.message); }
  finally { try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ } }
  res.redirect('/system/backup');
});

// ---------------- دادهٔ نمونه ----------------
router.post('/demo/load', async (req, res) => {
  try {
    const seeder = require('../../../database/seeds/demo');
    await seeder.run({ db, log: () => {}, adminId: req.user.id });
    await settings.set('demo_mode', '1');
    req.flash('success', 'دادهٔ نمونه بارگذاری شد.');
  } catch (e) { console.error(e); req.flash('danger', 'خطا: ' + e.message); }
  res.redirect('/system/settings?tab=maintenance');
});
router.post('/demo/clear', async (req, res) => {
  try {
    const seeder = require('../../../database/seeds/demo');
    await seeder.clear({ db, keepUserId: req.user.id });
    await settings.set('demo_mode', '0');
    req.flash('success', 'دادهٔ نمونه و همهٔ رکوردها (به‌جز حساب شما، تنظیمات و فرم) پاک شدند.');
  } catch (e) { req.flash('danger', 'خطا: ' + e.message); }
  res.redirect('/system/settings?tab=maintenance');
});

// ---------------- اطلاعات سامانه ----------------
router.get('/info', async (req, res) => {
  const tables = [];
  for (const t of Object.keys(schema)) tables.push({ name: t, count: await db.count(t) });
  const mem = process.memoryUsage();
  const info = { version: pkg.version, node: process.versions.node, platform: `${os.type()} ${os.release()} (${os.arch()})`, uptime: Math.round(process.uptime()), pid: process.pid, rss: mem.rss, heap: mem.heapUsed, freeMem: os.freemem(), totalMem: os.totalmem(), cpus: os.cpus().length, env: config.get().env, db: db.info, passenger: !!process.env.PASSENGER_APP_ENV || !!process.env.PASSENGER_BASE_URI, cwd: process.cwd(), storage: config.get().storage, modules: modules.stats() };
  res.render(v('info'), { title: 'اطلاعات سامانه', info, tables, healthInfo: await health.check(), fmtBytes: health.fmt });
});

// ---------------- کارهای زمان‌بندی‌شده ----------------
router.get('/jobs', async (req, res) => {
  const jobs = await scheduler.state();
  const runs = await scheduler.recentRuns(40);
  const token = await scheduler.cronToken();
  const base = settings.get('app_url', '') || `${req.protocol}://${req.get('host')}`;
  res.render(v('jobs'), { title: 'کارهای زمان‌بندی‌شده', jobs, runs, token, cronUrl: `${base.replace(/\/$/, '')}/cron?token=${token}`, mode: settings.get('scheduler_mode', 'internal'), appRoot: process.cwd() });
});
router.post('/jobs/token', async (req, res) => { await settings.set('cron_token', require('crypto').randomBytes(16).toString('hex')); req.flash('success', 'توکن جدید ساخته شد.'); res.redirect('/system/jobs'); });
router.post('/jobs/:key', async (req, res) => {
  const key = String(req.params.key);
  const job = scheduler.definitions().find((j) => j.key === key);
  if (!job) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  if (req.body.action === 'run') {
    const r = await scheduler.runJob(key, 'manual', true);
    await activity.log(req, 'run', 'jobs', null, `اجرای دستی ${job.name}: ${r.status || ''} ${r.message || ''}`);
    req.flash(r.ok ? 'success' : (r.skipped ? 'warning' : 'danger'), `${job.name}: ${r.message}${r.ms != null ? ' (' + J.toPersianDigits(r.ms) + ' ms)' : ''}`);
  } else {
    const patch = { updated_at: db.now() };
    if (req.body.action === 'toggle') { const row = await db.table('scheduled_jobs').where('key', key).first(); patch.is_enabled = row && row.is_enabled ? 0 : 1; }
    if (req.body.run_at && /^\d{2}:\d{2}$/.test(J.toEnglishDigits(req.body.run_at))) patch.run_at = J.toEnglishDigits(req.body.run_at);
    await db.table('scheduled_jobs').where('key', key).update(patch);
    req.flash('success', 'ذخیره شد');
  }
  res.redirect('/system/jobs');
});

module.exports = {
  key: 'system', name: 'سیستم', icon: 'bi-gear', category: 'system', order: 90, core: true,
  description: 'تنظیمات، ماژول‌ها، لاگ‌ها، پشتیبان‌گیری، کارهای زمان‌بندی‌شده',
  mount: ['/system'], routes: [router],
  features: [
    { key: 'login_captcha', name: 'کپچای ریاضی در صفحهٔ ورود', description: 'سؤال سادهٔ جمع برای جلوگیری از ربات' },
    { key: 'dark_mode', name: 'پوستهٔ تیره', description: 'امکان انتخاب پوستهٔ تیره توسط کاربران' },
    { key: 'backup', name: 'پشتیبان‌گیری', description: 'پشتیبان دستی و خودکار' },
    { key: 'activity_log', name: 'لاگ فعالیت', description: 'ثبت فعالیت کاربران' },
    { key: 'disk_alert', name: 'هشدار فضای دیسک', description: 'هشدار به مدیر ارشد هنگام کمبود فضا' },
    { key: 'maintenance', name: 'حالت نگهداری', description: 'بستن موقت سامانه برای کاربران' },
    { key: 'scheduler', name: 'کارهای زمان‌بندی‌شده', description: 'اجرای خودکار کارهای دوره‌ای', locked: true }
  ],
  menu: [
    { href: '/system/settings', title: 'تنظیمات', icon: 'bi-sliders', match: '/system/settings', permission: 'settings.manage' },
    { href: '/system/modules', title: 'ماژول‌ها و قابلیت‌ها', icon: 'bi-toggles', match: '/system/modules', permission: 'modules.manage' },
    { href: '/system/activity', title: 'گزارش فعالیت‌ها', icon: 'bi-clock-history', match: '/system/activity', permission: 'logs.view', feature: 'activity_log' },
    { href: '/system/logins', title: 'گزارش ورودها', icon: 'bi-door-open', match: '/system/logins', permission: 'logs.view' },
    { href: '/system/backup', title: 'پشتیبان‌گیری', icon: 'bi-cloud-arrow-down', match: '/system/backup', permission: 'backup.manage', feature: 'backup' },
    { href: '/system/jobs', title: 'کارهای زمان‌بندی‌شده', icon: 'bi-alarm', match: '/system/jobs', permission: 'settings.manage' },
    { href: '/system/info', title: 'اطلاعات سامانه', icon: 'bi-info-circle', match: '/system/info', permission: 'settings.manage' }
  ],
  jobs: [
    { key: 'system.backup_auto', name: 'پشتیبان‌گیری خودکار', description: 'پشتیبان روزانه و حذف نسخه‌های قدیمی', schedule: 'daily', defaultTime: '02:00',
      run: async () => { if (!modules.isEnabled('system.backup')) return 'غیرفعال'; const name = await backup.create(settings.get('backup_auto_type') === 'full' ? 'full' : 'json', 'auto-'); backup.prune(settings.getInt('backup_keep', 7), 'auto-'); return 'ساخته شد: ' + name; } },
    { key: 'system.cleanup', name: 'پاک‌سازی لاگ‌های قدیمی', description: 'حذف لاگ فعالیت/ورود قدیمی و نشست‌های منقضی', schedule: 'daily', defaultTime: '03:00',
      run: async () => { const days = settings.getInt('activity_keep_days', 180); const before = new Date(Date.now() - days * 86400000).toISOString().slice(0, 19).replace('T', ' '); const a = await db.table('activity_logs').where('created_at', '<', before).delete(); const l = await db.table('login_logs').where('created_at', '<', before).delete(); const s = await db.table('sessions').where('expires_at', '<', Date.now()).delete(); const r = await db.table('job_runs').where('started_at', '<', before).delete(); return `${a} فعالیت، ${l} ورود، ${s} نشست، ${r} اجرای کار`; } }
  ]
};
