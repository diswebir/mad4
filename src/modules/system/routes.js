'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const express = require('express');
const db = require('../../core/db');
const config = require('../../core/config');
const settings = require('../../core/settings');
const modules = require('../../core/modules');
const activity = require('../../core/activity');
const notify = require('../../core/notify');
const utils = require('../../core/utils');
const J = require('../../core/jalali');
const schema = require('../../../database/schema');
const backup = require('../../core/backup');
const offsite = require('../../core/offsite');
const scheduler = require('../../core/scheduler');
const auth = require('../../core/auth');
const upload = require('../../core/upload');
const { relPath, removeFile } = upload;
const pkg = require('../../../package.json');

const router = express.Router();
const v = (n) => path.join(__dirname, 'views', n + '.ejs');
router.use(auth.requireRoleOrPermission(['admin'], 'system.settings', 'system.modules', 'system.backup', 'system.logs', 'system.jobs'));
const P = (...k) => auth.requireRoleOrPermission(['admin'], ...k);
router.use('/settings', P('system.settings'));
router.use('/modules', P('system.modules'));
router.use('/activity', P('system.logs'));
router.use('/backup', P('system.backup'));
router.use('/demo', auth.requireAdmin);
router.use('/info', P('system.settings', 'system.logs'));
router.use('/jobs', P('system.jobs'), modules.requireEnabled('system.scheduler'));
router.use('/sms-log', P('system.logs'), modules.requireEnabled('system.sms_log'));
router.use('/logs', P('system.logs'), modules.requireEnabled('system.error_log'));
const logger = require('../../core/logger');

const TABS = [
  { key: 'school', title: 'مدرسه', icon: 'bi-building' },
  { key: 'academic', title: 'آموزشی', icon: 'bi-mortarboard' },
  { key: 'appearance', title: 'ظاهر', icon: 'bi-palette', feature: 'system.appearance' },
  { key: 'security', title: 'امنیت', icon: 'bi-shield-lock', feature: 'system.security_settings' },
  { key: 'sms', title: 'پیامک', icon: 'bi-chat-left-text', feature: 'system.sms_settings' },
  { key: 'email', title: 'ایمیل', icon: 'bi-envelope', feature: 'system.email_settings' },
  { key: 'offsite', title: 'پشتیبان بیرونی', icon: 'bi-cloud-upload', feature: 'system.backup_offsite' },
  { key: 'documents', title: 'اسناد و سربرگ', icon: 'bi-file-earmark-ruled', feature: 'documents.letterhead' },
  { key: 'admissions', title: 'پیش‌ثبت‌نام', icon: 'bi-person-plus', feature: 'admissions.public_form' },
  { key: 'demo', title: 'دادهٔ نمونه', icon: 'bi-database-add', feature: 'system.demo_data' }
];
const FIELDS = {
  school: ['school_name', 'school_slogan', 'school_type', 'school_gender', 'school_code', 'school_phone', 'school_email', 'school_address', 'school_website', 'principal_name', 'deputy_name', 'timezone_offset'],
  academic: ['school_days', 'working_hours', 'weekly_periods', 'period_times', 'attendance_periods', 'late_threshold_minutes', 'attendance_alert_threshold', 'attendance_absent_notify', 'attendance_sms_mode', 'grading_pass_score', 'grading_max_score', 'lesson_log_edit_days', 'student_number_prefix', 'student_number_next', 'ticket_categories', 'ticket_auto_close_days', 'ticket_sla_hours', 'ticket_sla_urgent_hours', 'ticket_sla_high_hours', 'ticket_sla_low_hours', 'ticket_sla_resolve_days', 'ticket_sla_warn_percent', 'ticket_sla_notify', 'homework_late_allowed', 'library_loan_days', 'library_max_loans', 'currency_unit', 'invoice_prefix', 'items_per_page', 'announcement_days_on_dashboard'],
  appearance: ['primary_color', 'default_theme', 'sidebar_style'],
  security: ['login_captcha', 'login_max_attempts', 'login_lock_minutes', 'session_days', 'password_reset_enabled', 'password_min_length', 'log_keep_days'],
  documents: ['school_district', 'letterhead_header', 'letterhead_footer', 'signatory_title', 'certificate_template'],
  admissions: ['admissions_open', 'admissions_year', 'admissions_text', 'admissions_docs'],
  sms: ['sms_enabled', 'sms_provider', 'sms_api_key', 'sms_sender', 'sms_webhook_url', 'sms_template_absent', 'site_url'],
  email: ['email_enabled', 'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from', 'smtp_secure'],
  offsite: ['backup_offsite_mode', 'backup_offsite_max_mb', 'backup_email_to', 'backup_ftp_host', 'backup_ftp_port', 'backup_ftp_user', 'backup_ftp_pass', 'backup_ftp_dir', 'backup_ftp_secure', 'backup_webdav_url', 'backup_webdav_user', 'backup_webdav_pass']
};

router.get('/settings', async (req, res) => {
  const tab = TABS.find((t) => t.key === req.query.tab && (!t.feature || modules.isEnabled(t.feature))) || TABS[0];
  const extra = {};
  if (tab.key === 'admissions') { extra.gradeLevels = await db.table('grade_levels').orderBy('sort_order').all(); extra.years = await db.table('academic_years').orderBy('id', 'desc').all(); extra.appCount = await db.table('applications').count(); }
  res.render(v('settings'), Object.assign({ title: 'تنظیمات مدرسه', tabs: TABS.filter((t) => !t.feature || modules.isEnabled(t.feature)), tab: tab.key, s: settings.all() }, extra));
});

router.post('/settings/:tab', ...upload.form('branding', 'fields', [{ name: 'school_logo', maxCount: 1 }, { name: 'signature_image', maxCount: 1 }, { name: 'stamp_image', maxCount: 1 }], { images: true, maxMb: 2, maxFiles: 3 }), async (req, res) => {
  const file = (n) => (req.files && req.files[n] && req.files[n][0]) || null;
  if (req.uploadError) { req.flash('danger', req.uploadError); return res.redirect('/system/settings?tab=' + req.params.tab); }
  const tab = req.params.tab;
  const keys = FIELDS[tab];
  if (!keys) return res.redirect('/system/settings');
  const data = {};
  for (const k of keys) {
    let val = req.body[k];
    if (Array.isArray(val)) val = val[val.length - 1];
    if (val === undefined) continue;
    val = utils.normalizePersian(String(val));
    if (/_(score|attempts|minutes|hours|days|percent|periods|threshold|next|page|port|loans|length|keep|year|mb)$/.test(k) || k === 'items_per_page') val = J.toEnglishDigits(val);
    data[k] = val;
  }
  if (tab === 'school' && file('school_logo')) { removeFile(settings.get('school_logo')); data.school_logo = relPath(file('school_logo')); }
  if (tab === 'school' && req.body.remove_logo === '1') { removeFile(settings.get('school_logo')); data.school_logo = ''; }
  if (tab === 'documents') {
    for (const k of ['signature_image', 'stamp_image']) {
      if (file(k)) { removeFile(settings.get(k)); data[k] = relPath(file(k)); }
      if (req.body['remove_' + k] === '1') { removeFile(settings.get(k)); data[k] = ''; }
    }
  }
  if (tab === 'admissions') { data.admissions_open = req.body.admissions_open === '1' ? '1' : '0'; data.admissions_grades = [].concat(req.body.admissions_grades || []).map((x) => parseInt(x, 10)).filter(Boolean).join(','); }
  if (data.timezone_offset) J.setTimezoneOffset(data.timezone_offset);
  await settings.setMany(data);
  await activity.log(req, 'settings', 'settings', null, 'به‌روزرسانی تنظیمات: ' + tab);
  req.flash('success', 'تنظیمات ذخیره شد.');
  res.redirect('/system/settings?tab=' + tab);
});

router.post('/settings/test/offsite', modules.requireEnabled('system.backup_offsite'), async (req, res) => {
  const r = await offsite.test();
  req.flash(r.ok ? 'success' : 'danger', r.ok ? 'اتصال برقرار است: ' + (r.detail || '') : 'آزمایش ناموفق: ' + (r.error || ''));
  res.redirect('/system/settings?tab=offsite');
});
router.post('/settings/test/sms', async (req, res) => {
  const r = await notify.sms(req.body.to, 'پیام آزمایشی از سامانه مدیریت مدرسه ' + settings.get('school_name'));
  req.flash(r.ok ? 'success' : 'danger', r.ok ? 'پیامک آزمایشی ارسال شد.' : 'ارسال ناموفق: ' + (r.error || r.skipped ? 'پیامک غیرفعال است' : 'خطای درگاه'));
  res.redirect('/system/settings?tab=sms');
});
router.post('/settings/test/email', async (req, res) => {
  const r = await notify.email(req.body.to, 'ایمیل آزمایشی', '<p>این یک ایمیل آزمایشی از سامانه مدیریت مدرسه است.</p>');
  req.flash(r.ok ? 'success' : 'danger', r.ok ? 'ایمیل آزمایشی ارسال شد.' : 'ارسال ناموفق: ' + (r.error || 'ایمیل غیرفعال است'));
  res.redirect('/system/settings?tab=email');
});

// ماژول‌ها
router.get('/modules', (req, res) => {
  const list = modules.modules.map((m) => ({ key: m.key, name: m.name, description: m.description, icon: m.icon, category: m.category, core: !!m.core, enabled: modules.isEnabled(m.key), dependencies: m.dependencies || [], features: m.features.map((f) => Object.assign({}, f, { enabled: modules.isEnabled(f.fullKey) })) }));
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
router.post('/modules/bulk', async (req, res) => {
  const enable = req.body.action === 'enable';
  for (const m of modules.modules) if (!m.core) { try { await modules.setState(m.key, enable); } catch (e) { /* ignore */ } }
  req.flash('success', enable ? 'همهٔ ماژول‌ها فعال شدند.' : 'ماژول‌های غیرهسته غیرفعال شدند.');
  res.redirect('/system/modules');
});

// گزارش فعالیت
router.get('/activity', modules.requireEnabled('system.activity_log'), async (req, res) => {
  const q = db.table('activity_logs as a').select('a.*', 'u.name as user_name', 'u.role as user_role').leftJoin('users as u', 'a.user_id', 'u.id').orderBy('a.id', 'desc');
  if (req.query.action) q.where('a.action', req.query.action);
  if (req.query.user) q.where('a.user_id', req.query.user);
  if (req.query.q) q.search(req.query.q, ['a.description', 'u.name', 'a.entity']);
  const result = await q.paginate(req.query.page, 30);
  const logins = modules.isEnabled('auth.login_history') ? await db.table('login_logs as l').select('l.*', 'u.name as user_name').leftJoin('users as u', 'l.user_id', 'u.id').orderBy('l.id', 'desc').limit(15).all() : [];
  res.render(v('activity'), { title: 'گزارش فعالیت', result, logins, actions: activity.ACTIONS });
});
router.post('/activity/clear', async (req, res) => {
  const before = J.addDays(J.todayISO(), -30);
  await db.table('activity_logs').where('created_at', '<', before).delete();
  await db.table('login_logs').where('created_at', '<', before).delete();
  req.flash('success', 'گزارش‌های قدیمی‌تر از ۳۰ روز پاک شدند.');
  res.redirect('/system/activity');
});

// پشتیبان‌گیری
router.get('/backup', modules.requireEnabled('system.backup'), async (req, res) => {
  const files = backup.list();
  const counts = {};
  for (const t of ['users', 'students', 'teachers', 'classes', 'attendance', 'grades', 'tickets']) counts[t] = await db.count(t);
  res.render(v('backup'), { title: 'پشتیبان‌گیری', files, counts, dbInfo: db.info, offsite: { enabled: modules.isEnabled('system.backup_offsite'), mode: offsite.mode(), modeTitle: offsite.MODES[offsite.mode()], configured: offsite.configured(), last: offsite.last() } });
});
// ارسال دستی یک فایل پشتیبان به مقصد بیرونی
router.post('/backup/offsite/:name', modules.requireEnabled('system.backup'), modules.requireEnabled('system.backup_offsite'), async (req, res) => {
  const name = path.basename(req.params.name);
  const file = path.join(config.get().storage, 'backups', name);
  if (!fs.existsSync(file)) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const r = await offsite.send(file);
  await activity.log(req, 'backup_offsite', 'system', null, (r.ok ? 'ارسال پشتیبان به بیرون: ' : 'ارسال ناموفق پشتیبان: ') + name + (r.ok ? ' → ' + r.detail : ' — ' + r.error));
  req.flash(r.ok ? 'success' : 'danger', r.ok ? 'ارسال شد: ' + r.detail : 'ارسال ناموفق: ' + (r.error || ''));
  res.redirect('/system/backup');
});
router.post('/backup/create', modules.requireEnabled('system.backup'), async (req, res) => {
  const name = await backup.create(req.body.type === 'file' ? 'file' : 'json');
  await activity.log(req, 'backup', 'system', null, 'ایجاد پشتیبان ' + name);
  req.flash('success', 'نسخهٔ پشتیبان ساخته شد: ' + name);
  res.redirect('/system/backup');
});
router.get('/backup/download/:name', modules.requireEnabled('system.backup'), (req, res) => {
  const name = path.basename(req.params.name);
  const file = path.join(config.get().storage, 'backups', name);
  if (!fs.existsSync(file)) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  res.download(file, name);
});
router.post('/backup/delete/:name', modules.requireEnabled('system.backup'), (req, res) => {
  const file = path.join(config.get().storage, 'backups', path.basename(req.params.name));
  try { fs.unlinkSync(file); } catch (e) { /* ignore */ }
  req.flash('success', 'فایل پشتیبان حذف شد.');
  res.redirect('/system/backup');
});
router.post('/backup/restore', modules.requireEnabled('system.backup'), ...upload.form('restore', 'single', 'file', { maxMb: 200, maxFiles: 1 }), async (req, res) => {
  if (req.uploadError) { req.flash('danger', req.uploadError); return res.redirect('/system/backup'); }
  if (!req.file) { req.flash('danger', 'فایلی انتخاب نشده است.'); return res.redirect('/system/backup'); }
  try {
    const raw = fs.readFileSync(req.file.path, 'utf8');
    const data = JSON.parse(raw);
    if (!data.tables) throw new Error('ساختار فایل پشتیبان نامعتبر است');
    await db.transaction(async (tx) => {
      for (const [t, rows] of Object.entries(data.tables)) {
        if (!schema[t] || t === 'sessions') continue;
        await tx.remove(t);
        const cols = Object.keys(schema[t]).filter((c) => !c.startsWith('__'));
        for (const row of rows) await tx.insert(t, utils.pick(row, cols));
      }
    });
    await settings.load();
    await modules.loadStates();
    await activity.log(req, 'backup', 'system', null, 'بازیابی پشتیبان');
    req.flash('success', 'بازیابی با موفقیت انجام شد.');
  } catch (e) { req.flash('danger', 'بازیابی ناموفق: ' + e.message); }
  finally { try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ } }
  res.redirect('/system/backup');
});

// دادهٔ نمونه
router.post('/demo/load', modules.requireEnabled('system.demo_data'), async (req, res) => {
  try {
    const seeder = require('../../../database/seeds/demo');
    const year = await db.findOne('academic_years', { is_current: 1 });
    await seeder.run({ db, log: () => {}, adminId: req.user.id, yearId: year ? year.id : null, adminUsername: req.user.username });
    await settings.set('demo_mode', '1');
    await modules.loadStates();
    req.flash('success', 'دادهٔ نمونه بارگذاری شد.');
  } catch (e) { console.error(e); req.flash('danger', 'خطا: ' + e.message); }
  res.redirect('/system/settings?tab=demo');
});
router.post('/demo/clear', modules.requireEnabled('system.demo_data'), async (req, res) => {
  try {
    const seeder = require('../../../database/seeds/demo');
    await seeder.clear({ db, keepUserId: req.user.id });
    await settings.set('demo_mode', '0');
    req.flash('success', 'دادهٔ نمونه و همهٔ رکوردها (به‌جز حساب شما و تنظیمات) پاک شدند.');
  } catch (e) { req.flash('danger', 'خطا: ' + e.message); }
  res.redirect('/system/settings?tab=demo');
});

// اطلاعات سامانه
router.get('/info', modules.requireEnabled('system.system_info'), async (req, res) => {
  const tables = [];
  for (const t of Object.keys(schema)) tables.push({ name: t, count: await db.count(t) });
  const mem = process.memoryUsage();
  const info = {
    version: pkg.version, node: process.versions.node, platform: `${os.type()} ${os.release()} (${os.arch()})`, uptime: Math.round(process.uptime()), pid: process.pid,
    rss: mem.rss, heap: mem.heapUsed, freeMem: os.freemem(), totalMem: os.totalmem(), cpus: os.cpus().length, env: config.get().env, db: db.info,
    passenger: !!process.env.PASSENGER_APP_ENV || !!process.env.PASSENGER_BASE_URI, cwd: process.cwd(), storage: config.get().storage,
    modules: modules.stats(), installedAt: settings.get('installed_at')
  };
  res.render(v('info'), { title: 'اطلاعات سامانه', info, tables });
});

// ---------- کارهای زمان‌بندی‌شده ----------
router.get('/jobs', async (req, res) => {
  const jobs = await scheduler.state();
  const runs = await scheduler.recentRuns(40);
  const token = await scheduler.cronToken();
  const base = settings.get('site_url', '') || `${req.protocol}://${req.get('host')}`;
  res.render(v('jobs'), { title: 'کارهای زمان‌بندی‌شده', jobs, runs, token, cronUrl: `${base.replace(/\/$/, '')}/cron?token=${token}`, mode: settings.get('scheduler_mode', 'internal'), keep: settings.get('backup_keep', 7), appRoot: process.cwd() });
});
router.post('/jobs/settings', async (req, res) => {
  await settings.setMany({ scheduler_mode: ['internal', 'external'].includes(req.body.scheduler_mode) ? req.body.scheduler_mode : 'internal', backup_keep: String(Math.max(1, Math.min(60, Number(req.body.backup_keep) || 7))) });
  await activity.log(req, 'update', 'system', null, 'تنظیمات زمان‌بند');
  req.flash('success', 'تنظیمات زمان‌بند ذخیره شد'); res.redirect('/system/jobs');
});
router.post('/jobs/token', async (req, res) => {
  await settings.set('cron_token', require('crypto').randomBytes(16).toString('hex'));
  req.flash('success', 'توکن جدید ساخته شد؛ آدرس cron بیرونی را به‌روزرسانی کنید.'); res.redirect('/system/jobs');
});
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
// ---------- لاگ پیامک ----------
router.get('/sms-log', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1), per = 40;
  const q = db.table('sms_log');
  if (req.query.q) q.where((b) => b.where('recipient', 'like', `%${J.toEnglishDigits(req.query.q)}%`).orWhere('message', 'like', `%${utils.normalizePersian(req.query.q)}%`));
  if (req.query.status) q.where('status', req.query.status);
  if (req.query.context) q.where('context', req.query.context);
  const total = await q.clone().count();
  const rows = await q.clone().orderBy('id', 'desc').limit(per).offset((page - 1) * per).all();
  const stats = Object.fromEntries((await db.table('sms_log').select('status', 'COUNT(*) as c').groupBy('status').all()).map((r) => [r.status, Number(r.c)]));
  const contexts = await db.table('sms_log').select('context').whereNotNull('context').groupBy('context').pluck('context');
  res.render(v('sms-log'), { title: 'لاگ پیامک', rows, total, page, pages: Math.ceil(total / per), stats, contexts, f: { q: req.query.q || '', status: req.query.status || '', context: req.query.context || '' }, provider: settings.get('sms_provider', 'log'), smsEnabled: settings.getBool('sms_enabled') });
});
router.post('/sms-log/clear', async (req, res) => { await db.table('sms_log').where('created_at', '<', J.addDays(J.todayISO(), -30)).delete(); req.flash('success', 'لاگ‌های قدیمی‌تر از ۳۰ روز پاک شد'); res.redirect('/system/sms-log'); });

// ---------- گزارش خطاها و لاگ سامانه ----------
const LOG_LEVELS = { error: 'خطا', warn: 'هشدار', info: 'اطلاع', debug: 'اشکال‌زدایی' };
router.get('/logs', async (req, res) => {
  const files = logger.files();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? req.query.date : (files[0] ? files[0].date : J.todayISO());
  const level = Object.keys(LOG_LEVELS).includes(req.query.level) ? req.query.level : '';
  const q = String(req.query.q || '').slice(0, 100);
  const rows = logger.read(date, { limit: 300, level: level || null, q });
  const counts = { error: 0, warn: 0, info: 0, debug: 0 }; for (const r of logger.read(date, { limit: 5000 })) counts[r.level] = (counts[r.level] || 0) + 1;
  res.render(v('logs'), { title: 'گزارش خطاها', files, date, level, q, rows, counts, LOG_LEVELS, stats: logger.stats(), logDir: logger.dir() });
});
router.get('/logs/download', (req, res) => {
  const f = logger.pathFor(req.query.date); if (!f || !fs.existsSync(f)) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  res.download(f, path.basename(f));
});
router.post('/logs/test', async (req, res) => {
  logger.error('خطای آزمایشی (ثبت‌شده توسط مدیر برای بررسی عملکرد لاگ)', new Error('TEST_LOG_ENTRY'), req, { test: true });
  logger.warn('هشدار آزمایشی', { user: req.user.username, test: true });
  req.flash('success', 'یک خطا و یک هشدار آزمایشی ثبت شد.'); res.redirect('/system/logs?date=' + J.todayISO());
});
router.post('/logs/prune', async (req, res) => {
  const n = logger.prune(settings.getInt('log_keep_days', 14));
  await activity.log(req, 'prune_logs', 'system', null, `حذف ${n} فایل لاگ قدیمی`);
  req.flash('success', `${J.toPersianDigits(n)} فایل لاگ قدیمی‌تر از ${J.toPersianDigits(settings.getInt('log_keep_days', 14))} روز حذف شد.`); res.redirect('/system/logs');
});
router.post('/logs/delete', async (req, res) => {
  const ok = logger.remove(req.body.date);
  if (ok) await activity.log(req, 'delete_log', 'system', null, `حذف فایل لاگ ${req.body.date}`);
  req.flash(ok ? 'success' : 'danger', ok ? 'فایل لاگ حذف شد.' : 'فایل یافت نشد.'); res.redirect('/system/logs');
});

module.exports = router;
