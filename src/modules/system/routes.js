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
router.use('/notify-queue', P('system.logs'), modules.requireEnabled('notifications.retry_queue'));
const logger = require('../../core/logger');
const maintenance = require('../../core/maintenance');
const health = require('../../core/health');
const updater = require('../../core/updater');
const settingsMeta = require('../../core/settings-meta');
router.use('/maintenance', P('system.settings'), modules.requireEnabled('system.maintenance'));
router.use('/update', P('system.settings'), modules.requireEnabled('system.updates'));

const TABS = [
  { key: 'school', title: 'مدرسه', icon: 'bi-building' },
  { key: 'academic', title: 'آموزشی', icon: 'bi-mortarboard' },
  { key: 'communication', title: 'ارتباطات و تیکت', icon: 'bi-chat-dots' },
  { key: 'services', title: 'خدمات', icon: 'bi-briefcase' },
  { key: 'finance', title: 'مالی', icon: 'bi-cash-coin' },
  { key: 'users', title: 'کاربران و رمزها', icon: 'bi-people' },
  { key: 'appearance', title: 'ظاهر', icon: 'bi-palette', feature: 'system.appearance' },
  { key: 'security', title: 'امنیت', icon: 'bi-shield-lock', feature: 'system.security_settings' },
  { key: 'sms', title: 'پیامک', icon: 'bi-chat-left-text', feature: 'system.sms_settings' },
  { key: 'email', title: 'ایمیل', icon: 'bi-envelope', feature: 'system.email_settings' },
  { key: 'birthdays', title: 'تولدها', icon: 'bi-cake2', feature: 'students.birthdays' },
  { key: 'payment', title: 'درگاه پرداخت', icon: 'bi-credit-card', feature: 'finance.online_payment' },
  { key: 'offsite', title: 'پشتیبان بیرونی', icon: 'bi-cloud-upload', feature: 'system.backup_offsite' },
  { key: 'documents', title: 'اسناد و سربرگ', icon: 'bi-file-earmark-ruled', feature: 'documents.letterhead' },
  { key: 'admissions', title: 'پیش‌ثبت‌نام', icon: 'bi-person-plus', feature: 'admissions.public_form' },
  { key: 'maintenance', title: 'نگهداری و دیسک', icon: 'bi-tools' },
  { key: 'advanced', title: 'همهٔ تنظیمات', icon: 'bi-list-ul', feature: 'system.advanced_settings' },
  { key: 'demo', title: 'دادهٔ نمونه', icon: 'bi-database-add', feature: 'system.demo_data' }
];
const tabEnabled = (t) => !t.feature || [].concat(t.feature).some((f) => modules.isEnabled(f));
const FIELDS = {
  school: ['school_name', 'school_slogan', 'school_short_name', 'site_url', 'school_type', 'school_gender', 'school_code', 'school_phone', 'school_email', 'school_address', 'school_website', 'principal_name', 'deputy_name', 'timezone_offset'],
  academic: ['school_days', 'working_hours', 'weekly_periods', 'period_times', 'attendance_periods', 'late_threshold_minutes', 'attendance_alert_threshold', 'attendance_absent_notify', 'attendance_sms_mode', 'attendance_edit_days', 'grading_pass_score', 'grading_max_score', 'lesson_log_edit_days', 'max_weekly_hours', 'homework_late_allowed', 'homework_reminder_days'],
  communication: ['ticket_categories', 'ticket_auto_close_days', 'allow_student_tickets_to_admin', 'ticket_sla_hours', 'ticket_sla_urgent_hours', 'ticket_sla_high_hours', 'ticket_sla_low_hours', 'ticket_sla_resolve_days', 'ticket_sla_warn_percent', 'ticket_sla_notify', 'announcement_days_on_dashboard', 'dashboard_announcements_count', 'dashboard_events_days', 'reminder_interval_days', 'notify_retry_max'],
  services: ['library_loan_days', 'library_max_loans', 'leave_days_per_year', 'discipline_report_days'],
  finance: ['currency_unit', 'invoice_prefix', 'invoice_due_days'],
  users: ['student_number_prefix', 'student_number_next', 'student_default_password', 'parent_default_password', 'parent_force_change_password', 'force_password_change', 'password_min_length', 'items_per_page'],
  appearance: ['primary_color', 'default_theme', 'sidebar_style', 'sidebar_mode', 'sidebar_single', 'items_per_page'],
  security: ['login_captcha', 'login_max_attempts', 'login_lock_minutes', 'session_days', 'password_reset_enabled', 'password_min_length', 'log_keep_days'],
  documents: ['school_district', 'letterhead_header', 'letterhead_footer', 'signatory_title', 'certificate_template'],
  admissions: ['admissions_open', 'admissions_year', 'admissions_text', 'admissions_docs'],
  sms: ['sms_enabled', 'sms_provider', 'sms_api_key', 'sms_sender', 'sms_webhook_url', 'sms_template_absent', 'site_url', 'sms_price', 'notify_retry_max'],
  payment: ['payment_gateway', 'zarinpal_merchant_id', 'zarinpal_sandbox', 'zarinpal_base_url', 'payment_min_amount', 'payment_allow_partial', 'payment_description', 'site_url'],
  birthdays: ['birthday_days_before', 'birthday_notify_admin', 'birthday_notify_teacher', 'birthday_notify_student', 'birthday_notify_parents', 'birthday_sms_student', 'birthday_sms_parents', 'birthday_tpl_admin_upcoming', 'birthday_tpl_admin_today', 'birthday_tpl_teacher', 'birthday_tpl_student', 'birthday_tpl_parent'],
  maintenance: ['maintenance_mode', 'maintenance_message', 'maintenance_until', 'maintenance_allow_ips', 'disk_alert_enabled', 'disk_alert_min_mb', 'disk_alert_percent', 'upload_max_mb', 'log_keep_days', 'cleanup_notifications_days', 'cleanup_login_logs_days', 'cleanup_job_runs_days'],
  email: ['email_enabled', 'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from', 'smtp_secure'],
  offsite: ['backup_offsite_mode', 'backup_offsite_max_mb', 'backup_email_to', 'backup_ftp_host', 'backup_ftp_port', 'backup_ftp_user', 'backup_ftp_pass', 'backup_ftp_dir', 'backup_ftp_secure', 'backup_webdav_url', 'backup_webdav_user', 'backup_webdav_pass']
};

router.get('/settings', async (req, res) => {
  const tab = TABS.find((t) => t.key === req.query.tab && tabEnabled(t)) || TABS[0];
  const extra = {};
  if (tab.key === 'maintenance') { extra.healthInfo = modules.isEnabled('system.disk_alert') ? await health.check() : null; extra.maintenanceActive = maintenance.isOn(); extra.maintenanceReason = maintenance.reason(); }
  if (tab.key === 'advanced') { extra.allKeys = advancedList(); extra.groupTitle = settingsMeta.groupTitle; extra.q = utils.normalizePersian(String(req.query.q || '')).trim(); }
  if (tab.key === 'birthdays') { const bd = require('../students/birthdays'); extra.birthdayPreview = bd.preview(); extra.birthdayDefaults = bd.DEFAULT_TPL; }
  if (tab.key === 'admissions') { extra.gradeLevels = await db.table('grade_levels').orderBy('sort_order').all(); extra.years = await db.table('academic_years').orderBy('id', 'desc').all(); extra.appCount = await db.table('applications').count(); }
  res.render(v('settings'), Object.assign({ title: 'تنظیمات مدرسه', tabs: TABS.filter(tabEnabled), tab: tab.key, s: settings.all() }, extra));
});

const advancedGuard = [P('system.settings'), modules.requireEnabled('system.advanced_settings')];
const KEY_RE = /^[a-z][a-z0-9_]{1,60}$/;
router.post('/settings/advanced/set', ...advancedGuard, async (req, res) => {
  const key = String(req.body.key || '').trim();
  const back = '/system/settings?tab=advanced' + (req.body.q ? '&q=' + encodeURIComponent(req.body.q) : '');
  if (!KEY_RE.test(key) || settingsMeta.isInternal(key)) { req.flash('danger', 'این کلید قابل ویرایش نیست.'); return res.redirect(back); }
  const m = settingsMeta.meta(key);
  if (req.body.reset === '1') { await settings.unset(key); await activity.log(req, 'settings', 'settings', null, `بازگشت «${key}» به مقدار پیش‌فرض`); req.flash('success', `«${m.label}» به مقدار پیش‌فرض برگشت.`); return res.redirect(back); }
  let val = req.body.value === undefined ? '' : String(Array.isArray(req.body.value) ? req.body.value[req.body.value.length - 1] : req.body.value);
  if (m.type === 'secret' && val === '••••••') return res.redirect(back);
  val = utils.normalizePersian(val);
  if (m.type === 'number') { val = J.toEnglishDigits(val).trim(); if (val && !/^-?\d+(\.\d+)?$/.test(val)) { req.flash('danger', 'مقدار باید عددی باشد.'); return res.redirect(back); } }
  if (m.type === 'bool') val = val === '1' || val === 'true' ? '1' : '0';
  if (key === 'disk_alert_percent') val = String(Math.min(99, Math.max(50, parseInt(val, 10) || 90)));
  if (key === 'password_min_length') val = String(Math.min(32, Math.max(4, parseInt(val, 10) || 6)));
  await settings.setMany({ [key]: val.slice(0, 5000) });
  if (key === 'timezone_offset') J.setTimezoneOffset(val);
  if (key.startsWith('disk_alert')) health.invalidate();
  await activity.log(req, 'settings', 'settings', null, `ویرایش تنظیم «${key}»` + (m.type === 'secret' ? '' : `: ${val.slice(0, 60)}`));
  req.flash('success', `«${m.label}» ذخیره شد.`);
  res.redirect(back);
});
router.get('/settings/export.json', ...advancedGuard, (req, res) => {
  const out = {};
  for (const it of advancedList()) { if (it.type === 'secret' || it.type === 'internal') continue; out[it.key] = it.value; }
  const name = `settings-${J.todayISO()}.json`;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.send(JSON.stringify({ app: pkg.name, version: pkg.version, exported_at: new Date().toISOString(), settings: out }, null, 2));
});
router.post('/settings/import', ...advancedGuard, ...upload.form('settings', 'single', 'file', { maxMb: 2, maxFiles: 1, types: ['application/json', 'text/json', 'text/plain', 'application/octet-stream'] }), async (req, res) => {
  const back = '/system/settings?tab=advanced';
  const cleanup = () => { try { if (req.file) fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ } };
  if (req.uploadError) { req.flash('danger', req.uploadError); return res.redirect(back); }
  if (!req.file) { req.flash('danger', 'فایل JSON انتخاب نشده است.'); return res.redirect(back); }
  let data;
  try { data = JSON.parse(fs.readFileSync(req.file.path, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { cleanup(); req.flash('danger', 'فایل JSON معتبر نیست.'); return res.redirect(back); }
  cleanup();
  const src = data && typeof data.settings === 'object' ? data.settings : data;
  if (!src || typeof src !== 'object' || Array.isArray(src)) { req.flash('danger', 'ساختار فایل شناخته نشد.'); return res.redirect(back); }
  const known = new Set(Object.keys(settings.DEFAULTS));
  const apply = {}; let skipped = 0;
  for (const [k, v] of Object.entries(src)) {
    if (!KEY_RE.test(k) || settingsMeta.isInternal(k) || settingsMeta.isSecret(k) || (!known.has(k) && req.body.allow_unknown !== '1') || v == null || typeof v === 'object') { skipped++; continue; }
    apply[k] = String(v).slice(0, 5000);
  }
  if (!Object.keys(apply).length) { req.flash('warning', 'هیچ کلید قابل‌اعمالی در فایل نبود.'); return res.redirect(back); }
  await settings.setMany(apply);
  if (apply.timezone_offset) J.setTimezoneOffset(apply.timezone_offset);
  health.invalidate();
  await activity.log(req, 'import', 'settings', null, `ورود ${Object.keys(apply).length} تنظیم از فایل JSON`);
  req.flash('success', `${J.toPersianDigits(Object.keys(apply).length)} تنظیم اعمال شد${skipped ? `؛ ${J.toPersianDigits(skipped)} مورد (کلید ناشناخته/محرمانه/داخلی) نادیده گرفته شد` : ''}.`);
  res.redirect(back);
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
    if (/_(score|attempts|minutes|hours|days|percent|periods|threshold|next|page|port|loans|length|keep|year|mb|price|count|amount)$/.test(k) || k === 'items_per_page') val = J.toEnglishDigits(val);
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
  if (tab === 'maintenance') {
    if (!modules.isEnabled('system.maintenance')) for (const k of Object.keys(data)) if (k.startsWith('maintenance_')) delete data[k];
    if (!modules.isEnabled('system.disk_alert')) for (const k of Object.keys(data)) if (k.startsWith('disk_alert_')) delete data[k];
    if (data.disk_alert_min_mb !== undefined) data.disk_alert_min_mb = String(Math.max(50, parseInt(data.disk_alert_min_mb, 10) || 500));
    if (data.disk_alert_percent !== undefined) data.disk_alert_percent = String(Math.min(99, Math.max(50, parseInt(data.disk_alert_percent, 10) || 90)));
    const before = settings.get('maintenance_mode') === '1';
    const after = data.maintenance_mode === '1';
    if (before !== after) await activity.log(req, 'toggle', 'maintenance', null, after ? 'فعال‌سازی حالت تعمیر و نگهداری' : 'خروج از حالت تعمیر و نگهداری');
    health.invalidate();
  }
  await settings.setMany(data);
  await activity.log(req, 'settings', 'settings', null, 'به‌روزرسانی تنظیمات: ' + tab);
  req.flash('success', 'تنظیمات ذخیره شد.');
  res.redirect('/system/settings?tab=' + tab);
});

// ---------- همهٔ تنظیمات (پیشرفته): فهرست همهٔ کلیدها با جستجو، ویرایش تکی، بازگشت به پیش‌فرض، خروجی/ورودی JSON ----------
function advancedList() {
  const all = settings.all(); const storedSet = new Set(settings.storedKeys());
  const keys = [...new Set([...Object.keys(settings.DEFAULTS), ...Object.keys(all)])];
  return keys.map((key) => { const m = settingsMeta.meta(key); const value = all[key] == null ? '' : String(all[key]); const def = settings.DEFAULTS[key] == null ? '' : String(settings.DEFAULTS[key]); return { key, value, display: m.type === 'secret' && value ? '••••••' : value, label: m.label, group: m.group, groupTitle: settingsMeta.groupTitle(m.group), type: m.type, help: m.help, stored: storedSet.has(key), isDefault: value === def, defaultValue: def }; })
    .sort((a, b) => a.group.localeCompare(b.group) || a.key.localeCompare(b.key));
}
router.post('/settings/test/offsite', modules.requireEnabled('system.backup_offsite'), async (req, res) => {
  const r = await offsite.test();
  req.flash(r.ok ? 'success' : 'danger', r.ok ? 'اتصال برقرار است: ' + (r.detail || '') : 'آزمایش ناموفق: ' + (r.error || ''));
  res.redirect('/system/settings?tab=offsite');
});
router.post('/settings/test/sms', async (req, res) => {
  const r = await notify.sms(req.body.to, 'پیام آزمایشی از سامانه مدیریت مدرسه ' + settings.get('school_name'), 'test');
  req.flash(r.ok ? 'success' : (r.queued ? 'warning' : 'danger'), r.ok ? 'پیامک آزمایشی ارسال شد.' : 'ارسال ناموفق: ' + (r.error || (r.skipped ? 'پیامک غیرفعال است' : 'خطای درگاه')) + (r.queued ? ' — در <a href="/system/notify-queue">صف تلاش مجدد</a> قرار گرفت.' : ''));
  res.redirect('/system/settings?tab=sms');
});
router.post('/settings/test/email', async (req, res) => {
  const r = await notify.email(req.body.to, 'ایمیل آزمایشی', '<p>این یک ایمیل آزمایشی از سامانه مدیریت مدرسه است.</p>');
  req.flash(r.ok ? 'success' : (r.queued ? 'warning' : 'danger'), r.ok ? 'ایمیل آزمایشی ارسال شد.' : 'ارسال ناموفق: ' + (r.error || 'ایمیل غیرفعال است') + (r.queued ? ' — در <a href="/system/notify-queue">صف تلاش مجدد</a> قرار گرفت.' : ''));
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
  const up = backup.walkUploads(); const uploadsInfo = { count: up.length, bytes: up.reduce((a, f) => a + f.size, 0) };
  const counts = {};
  for (const t of ['users', 'students', 'teachers', 'classes', 'attendance', 'grades', 'tickets']) counts[t] = await db.count(t);
  res.render(v('backup'), { title: 'پشتیبان‌گیری', files, counts, uploadsInfo, dbInfo: db.info, offsite: { enabled: modules.isEnabled('system.backup_offsite'), mode: offsite.mode(), modeTitle: offsite.MODES[offsite.mode()], configured: offsite.configured(), last: offsite.last() } });
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
  const type = ['file', 'json', 'full'].includes(req.body.type) ? req.body.type : 'json';
  let name;
  try { name = await backup.create(type); } catch (e) { req.flash('danger', 'ساخت پشتیبان ناموفق: ' + e.message); return res.redirect('/system/backup'); }
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
router.post('/backup/restore', modules.requireEnabled('system.backup'), ...upload.form('restore', 'single', 'file', { maxMb: 2048, maxFiles: 1, types: ['application/json', 'text/json', 'text/plain', 'application/gzip', 'application/x-gzip', 'application/zip', 'application/x-zip-compressed', 'application/octet-stream'] }), async (req, res) => {
  if (req.uploadError) { req.flash('danger', req.uploadError); return res.redirect('/system/backup'); }
  if (!req.file) { req.flash('danger', 'فایلی انتخاب نشده است.'); return res.redirect('/system/backup'); }
  if (!/\.(json|gz|zip)$/i.test(req.file.originalname || '')) { try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ } req.flash('danger', 'فقط فایل‌های .json، .json.gz یا .zip (پشتیبان کامل) پذیرفته می‌شوند.'); return res.redirect('/system/backup'); }
  const opts = { db: req.body.restore_db !== '0', files: req.body.restore_files !== '0' };
  try {
    const r = await backup.restoreFromFile(req.file.path, req.file.originalname, opts);
    if (opts.db) { await settings.load(); await modules.loadStates(); }
    await activity.log(req, 'backup', 'system', null, `بازیابی پشتیبان ${r.type === 'zip' ? 'کامل' : 'JSON'} (${r.rows} سطر، ${r.files} فایل)`);
    req.flash('success', `بازیابی با موفقیت انجام شد (${J.toPersianDigits(r.rows)} سطر${r.type === 'zip' ? `، ${J.toPersianDigits(r.files)} فایل` : ''}${r.skipped ? `، ${J.toPersianDigits(r.skipped)} مسیر نامعتبر نادیده گرفته شد` : ''}).`);
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

// ---------- حالت تعمیر و نگهداری (کلید سریع) ----------
router.post('/maintenance/toggle', async (req, res) => {
  const on = req.body.enabled === '1' || req.body.enabled === 'on';
  const data = { maintenance_mode: on ? '1' : '0' };
  if (on && req.body.message !== undefined) data.maintenance_message = utils.normalizePersian(String(req.body.message || '')).slice(0, 500);
  if (on && req.body.until !== undefined) data.maintenance_until = utils.normalizePersian(String(req.body.until || '')).slice(0, 80);
  if (!on) { maintenance.clearFlag(); data.maintenance_until = ''; }
  await settings.setMany(data);
  await activity.log(req, 'toggle', 'maintenance', null, on ? 'فعال‌سازی حالت تعمیر و نگهداری' : 'خروج از حالت تعمیر و نگهداری');
  if (auth.wantsJson(req)) return res.json({ ok: true, maintenance: maintenance.isOn() });
  req.flash(on ? 'warning' : 'success', on ? 'حالت تعمیر و نگهداری فعال شد؛ فقط مدیران به سامانه دسترسی دارند.' : 'سامانه از حالت تعمیر و نگهداری خارج شد.');
  res.redirect(req.body.back && /^\/[^/\\]/.test(req.body.back) ? req.body.back : '/system/settings?tab=maintenance');
});

// ---------- به‌روزرسانی سامانه ----------
const UPDATE_ZIP_TYPES = ['application/zip', 'application/x-zip-compressed', 'application/octet-stream', 'multipart/x-zip'];
router.get('/update', async (req, res) => {
  if (req.session) req.session.updateSeen = pkg.version;
  const st = updater.state(settings);
  const npm = updater.npmBin();
  const h = await health.check({ withUsage: false });
  const recent = await db.table('activity_logs').where('action', 'update').orderBy('id', 'desc').limit(10).all();
  const lastBackup = backup.list().slice(0, 1)[0] || null;
  res.render(v('update'), { title: 'به‌روزرسانی سامانه', st, npm, healthInfo: h, recent, lastBackup, log: updater.readLog(60), maintenanceActive: maintenance.isOn(), changelog: readChangelog() });
});
function readChangelog() {
  try {
    const txt = fs.readFileSync(path.join(config.ROOT, 'CHANGELOG.md'), 'utf8');
    const m = txt.match(/^## [^\n]*\n([\s\S]*?)(?=^## |\Z(?![\s\S]))/m);
    return m ? m[0].trim().split('\n').slice(0, 40).join('\n') : '';
  } catch (e) { return ''; }
}
router.get('/update/log', (req, res) => {
  const st = updater.readState();
  res.json({ ok: true, running: !!st.running && Date.now() - new Date(st.startedAt || 0).getTime() < 30 * 60 * 1000, status: st.status || null, message: st.message || null, finishedAt: st.finishedAt || null, lines: updater.readLog(parseInt(req.query.lines, 10) || 120), maintenance: maintenance.isOn(), version: pkg.version });
});
router.post('/update/run', async (req, res) => {
  const st = updater.readState();
  if (st.running && Date.now() - new Date(st.startedAt || 0).getTime() < 30 * 60 * 1000) { req.flash('warning', 'یک به‌روزرسانی در حال اجراست.'); return res.redirect('/system/update'); }
  updater.clearLog();
  const args = [];
  if (req.body.force_install === '1') args.push('--force-install');
  if (req.body.skip_install === '1') args.push('--skip-install');
  if (req.body.backup_first === '1') { try { const name = await backup.create(db.info.client === 'sqlite' ? 'file' : 'json', 'auto'); updater.appendLog('پشتیبان پیش از به‌روزرسانی: ' + name); } catch (e) { updater.appendLog('پشتیبان‌گیری پیش از به‌روزرسانی ناموفق: ' + e.message); } }
  const pid = updater.spawnRunner(args);
  await activity.log(req, 'update', 'system', null, `اجرای به‌روزرسانی از پنل (pid ${pid})`);
  if (auth.wantsJson(req)) return res.json({ ok: true, pid });
  req.flash('info', 'به‌روزرسانی در پس‌زمینه آغاز شد؛ گزارش زنده را در همین صفحه دنبال کنید.');
  res.redirect('/system/update');
});
router.post('/update/upload', ...upload.form('updates', 'single', 'package', { maxMb: 512, maxFiles: 1, types: UPDATE_ZIP_TYPES }), async (req, res) => {
  const cleanup = () => { try { if (req.file) fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ } };
  if (req.uploadError) { req.flash('danger', req.uploadError); return res.redirect('/system/update'); }
  if (!req.file || !/\.zip$/i.test(req.file.originalname || '')) { cleanup(); req.flash('danger', 'فقط بستهٔ ZIP نسخهٔ جدید پذیرفته می‌شود.'); return res.redirect('/system/update'); }
  const st = updater.readState();
  if (st.running && Date.now() - new Date(st.startedAt || 0).getTime() < 30 * 60 * 1000) { cleanup(); req.flash('warning', 'یک به‌روزرسانی در حال اجراست.'); return res.redirect('/system/update'); }
  updater.clearLog();
  try {
    const name = await backup.create(db.info.client === 'sqlite' ? 'file' : 'json', 'auto');
    updater.appendLog('پشتیبان پیش از به‌روزرسانی: ' + name);
    const before = pkg.version;
    const r = await updater.applyPackage(req.file.path, { log: (m) => updater.appendLog(m), force: req.body.force === '1' });
    await activity.log(req, 'update', 'system', null, `بارگذاری بستهٔ نسخهٔ ${r.version} (${r.files} فایل) روی نسخهٔ ${before}`);
    const pid = updater.spawnRunner([]);
    updater.appendLog(`مراحل نصب در پس‌زمینه آغاز شد (pid ${pid})`);
    req.flash('success', `بستهٔ نسخهٔ ${r.version} اعمال شد (${r.files} فایل). مراحل نصب در حال اجراست…`);
  } catch (e) {
    updater.appendLog('خطا: ' + e.message);
    logger.error('update upload failed', e, req);
    req.flash('danger', 'به‌روزرسانی انجام نشد: ' + e.message);
  } finally { cleanup(); }
  res.redirect('/system/update');
});
router.post('/update/restart', async (req, res) => {
  const ok = updater.touchRestart();
  await activity.log(req, 'update', 'system', null, 'درخواست ری‌استارت برنامه');
  const passenger = !!(process.env.PASSENGER_APP_ENV || process.env.PASSENGER_BASE_URI);
  if (auth.wantsJson(req)) return res.json({ ok, passenger });
  req.flash(ok ? 'success' : 'danger', ok ? (passenger ? 'درخواست ری‌استارت ثبت شد؛ Passenger در درخواست بعدی برنامه را از نو اجرا می‌کند.' : 'فایل tmp/restart.txt نوشته شد. اگر برنامه با Passenger اجرا نمی‌شود، سرویس را به‌صورت دستی دوباره اجرا کنید (pm2 restart / systemctl restart).') : 'نوشتن tmp/restart.txt ممکن نشد؛ دسترسی پوشه را بررسی کنید.');
  res.redirect('/system/update');
});
router.post('/update/disk-check', modules.requireEnabled('system.disk_alert'), async (req, res) => {
  health.invalidate();
  const h = await health.check();
  if (auth.wantsJson(req)) return res.json({ ok: true, level: h.level, disk: h.disk, usage: h.usage, message: h.message });
  req.flash(h.level === 'ok' ? 'success' : (h.level === 'critical' ? 'danger' : 'warning'), h.level === 'ok' ? `فضای دیسک کافی است: ${health.fmt(h.disk ? h.disk.free : 0)} آزاد.` : h.message);
  res.redirect(req.get('referer') || '/system/info');
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
  const healthInfo = modules.isEnabled('system.disk_alert') ? await health.check() : null;
  res.render(v('info'), { title: 'اطلاعات سامانه', info, tables, healthInfo, fmtBytes: health.fmt });
});

// ---------- کارهای زمان‌بندی‌شده ----------
router.get('/jobs', async (req, res) => {
  const jobs = await scheduler.state();
  const runs = await scheduler.recentRuns(40);
  const token = await scheduler.cronToken();
  const base = settings.get('site_url', '') || `${req.protocol}://${req.get('host')}`;
  res.render(v('jobs'), { title: 'کارهای زمان‌بندی‌شده', jobs, runs, token, cronUrl: `${base.replace(/\/$/, '')}/cron?token=${token}`, mode: settings.get('scheduler_mode', 'internal'), autoType: settings.get('backup_auto_type', 'db'), keep: settings.get('backup_keep', 7), appRoot: process.cwd() });
});
router.post('/jobs/settings', async (req, res) => {
  await settings.setMany({ scheduler_mode: ['internal', 'external'].includes(req.body.scheduler_mode) ? req.body.scheduler_mode : 'internal', backup_keep: String(Math.max(1, Math.min(60, Number(req.body.backup_keep) || 7))), backup_auto_type: req.body.backup_auto_type === 'full' ? 'full' : 'db' });
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
// ---------- گزارش مصرف پیامک ----------
const SMS_CONTEXTS = { attendance: 'غیبت/تأخیر', finance: 'یادآوری شهریه', discipline: 'انضباطی/تشویق', broadcast: 'اطلاع‌رسانی گروهی', students_bulk: 'ارسال گروهی به دانش‌آموزان', students_birthday: 'تبریک تولد', parent_credentials: 'حساب اولیا', password_reset: 'بازیابی رمز', admissions: 'پیش‌ثبت‌نام', test: 'آزمایشی' };
/** تعداد بخش‌های پیامک (استاندارد UCS-2 برای متن فارسی: ۷۰ نویسه تک‌بخشی، سپس ۶۷ نویسه در هر بخش) */
function smsParts(text) { const len = [...String(text || '')].length; if (len <= 70) return len ? 1 : 0; return Math.ceil(len / 67); }
router.get('/sms-log/report', modules.requireEnabled('system.sms_report'), async (req, res) => {
  const cur = J.currentJalali(); const month = J.jalaliMonthRange(cur.jy, cur.jm);
  const from = (req.query.from && J.toGregorian(req.query.from)) || month.start;
  const to = (req.query.to && J.toGregorian(req.query.to)) || J.todayISO();
  const rows = await db.table('sms_log').select('recipient', 'message', 'status', 'context', 'created_at', 'provider').whereRaw('created_at >= ? AND created_at < ?', [J.localToUtc(from + ' 00:00:00'), J.localToUtc(J.addDays(to, 1) + ' 00:00:00')]).orderBy('id').all();
  const price = settings.getInt('sms_price', 0);
  const byDay = new Map(); const byContext = new Map(); const byRecipient = new Map(); const byProvider = new Map();
  const tot = { count: 0, sent: 0, failed: 0, parts: 0, partsSent: 0, cost: 0 };
  for (const r of rows) {
    const parts = smsParts(r.message); const day = J.localDateOf(r.created_at); const ok = r.status === 'sent'; const ctx = r.context || 'other';
    tot.count++; tot.parts += parts; if (ok) { tot.sent++; tot.partsSent += parts; } else tot.failed++;
    const bump = (m, k) => { const o = m.get(k) || { key: k, count: 0, sent: 0, failed: 0, parts: 0 }; o.count++; o.parts += ok ? parts : 0; if (ok) o.sent++; else o.failed++; m.set(k, o); };
    bump(byDay, day); bump(byContext, ctx); bump(byRecipient, r.recipient); bump(byProvider, r.provider || '-');
  }
  tot.cost = tot.partsSent * price;
  const days = [...byDay.values()].sort((a, b) => a.key.localeCompare(b.key));
  const contexts = [...byContext.values()].sort((a, b) => b.count - a.count).map((c) => Object.assign(c, { title: SMS_CONTEXTS[c.key] || (c.key === 'other' ? 'سایر' : c.key), cost: c.parts * price }));
  const recipients = [...byRecipient.values()].sort((a, b) => b.count - a.count).slice(0, 10);
  const providers = [...byProvider.values()].sort((a, b) => b.count - a.count);
  if (req.query.export === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="sms-usage-${from}-${to}.csv"`);
    return res.send(utils.toCSV(days.map((d) => ({ date: J.formatDate(d.key), count: d.count, sent: d.sent, failed: d.failed, parts: d.parts, cost: d.parts * price })), [{ key: 'date', label: 'تاریخ' }, { key: 'count', label: 'تعداد' }, { key: 'sent', label: 'موفق' }, { key: 'failed', label: 'ناموفق' }, { key: 'parts', label: 'بخش‌های ارسال‌شده' }, { key: 'cost', label: 'هزینهٔ تقریبی' }]));
  }
  res.render(v('sms-report'), { title: 'گزارش مصرف پیامک', from, to, tot, days, contexts, recipients, providers, price, provider: settings.get('sms_provider', 'log'), smsEnabled: settings.getBool('sms_enabled') });
});
router.post('/sms-log/clear', async (req, res) => { await db.table('sms_log').where('created_at', '<', J.addDays(J.todayISO(), -30)).delete(); req.flash('success', 'لاگ‌های قدیمی‌تر از ۳۰ روز پاک شد'); res.redirect('/system/sms-log'); });

// ---------- گزارش خطاها و لاگ سامانه ----------
// ---------- صف تلاش مجدد پیامک/ایمیل ----------
const notifyQueue = require('../../core/notifyQueue');
router.get('/notify-queue', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1), per = 40;
  const q = db.table('notify_queue');
  if (req.query.status) q.where('status', req.query.status);
  if (req.query.channel) q.where('channel', req.query.channel);
  if (req.query.q) q.where('recipient', 'like', `%${J.toEnglishDigits(req.query.q)}%`);
  const total = await q.clone().count();
  const rows = (await q.clone().orderBy('id', 'desc').limit(per).offset((page - 1) * per).all()).map((r) => { try { r.data = JSON.parse(r.payload || '{}'); } catch (e) { r.data = {}; } return r; });
  const stats = await notifyQueue.stats();
  const job = await db.table('scheduled_jobs').where('key', 'notify_retry').first();
  res.render(v('notify-queue'), { title: 'صف ارسال پیامک/ایمیل', rows, total, page, pages: Math.ceil(total / per), stats, job, f: { status: req.query.status || '', channel: req.query.channel || '', q: req.query.q || '' }, STATUSES: notifyQueue.STATUSES, CHANNELS: notifyQueue.CHANNELS, maxAttempts: notifyQueue.maxAttempts(), backoff: notifyQueue.BACKOFF_MINUTES });
});
router.post('/notify-queue/process', async (req, res) => {
  const r = await notifyQueue.process({ force: req.body.force === '1' });
  await activity.log(req, 'run', 'notify_queue', null, 'پردازش دستی صف ارسال');
  req.flash(r.failed ? 'warning' : 'success', r.processed ? `${J.toPersianDigits(r.processed)} مورد پردازش شد: ${J.toPersianDigits(r.sent)} ارسال، ${J.toPersianDigits(r.retry)} در انتظار تلاش بعدی، ${J.toPersianDigits(r.failed)} ناموفق نهایی.` : 'موردی برای پردازش نبود.');
  res.redirect('/system/notify-queue');
});
router.post('/notify-queue/:id/retry', async (req, res) => {
  const id = Number(req.params.id); const row = await db.findById('notify_queue', id);
  if (!row) { req.flash('error', 'مورد یافت نشد'); return res.redirect('/system/notify-queue'); }
  await notifyQueue.requeue([id]);
  const r = await notifyQueue.process({ force: true, ids: [id] });
  req.flash(r.sent ? 'success' : 'warning', r.sent ? 'با موفقیت ارسال شد.' : `ارسال دوباره ناموفق بود${r.failed ? ' و از صف خارج شد' : '؛ در زمان بعدی دوباره تلاش می‌شود'}.`);
  res.redirect(req.get('referer') || '/system/notify-queue');
});
router.post('/notify-queue/:id/cancel', async (req, res) => {
  await notifyQueue.cancel([Number(req.params.id)]);
  req.flash('success', 'از صف خارج شد.'); res.redirect(req.get('referer') || '/system/notify-queue');
});
router.post('/notify-queue/retry-failed', async (req, res) => {
  const ids = await db.table('notify_queue').where('status', 'failed').pluck('id');
  if (ids.length) await notifyQueue.requeue(ids);
  const r = ids.length ? await notifyQueue.process({ force: true, ids }) : { processed: 0, sent: 0, retry: 0, failed: 0 };
  req.flash(r.sent ? 'success' : 'warning', `${J.toPersianDigits(ids.length)} مورد ناموفق دوباره تلاش شد: ${J.toPersianDigits(r.sent)} ارسال، ${J.toPersianDigits(r.retry)} در صف، ${J.toPersianDigits(r.failed)} ناموفق.`);
  res.redirect('/system/notify-queue');
});
router.post('/notify-queue/purge', async (req, res) => {
  const n = await notifyQueue.purge(Number(req.body.days) || 30);
  req.flash('success', `${J.toPersianDigits(n || 0)} مورد قدیمی پاک شد.`); res.redirect('/system/notify-queue');
});

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
