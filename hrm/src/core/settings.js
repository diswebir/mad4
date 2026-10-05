'use strict';
/**
 * تنظیمات سامانه (جدول settings) با کش در حافظه
 */
const db = require('./db');

const DEFAULTS = {
  // شرکت و برندینگ
  company_name: 'شرکت دانش‌بنیان عرفان صنعت اصفهان', company_short_name: 'عرفان صنعت', company_slogan: 'سامانهٔ مدیریت منابع انسانی', company_logo: '',
  company_phone: '', company_email: '', company_address: '', company_website: '', company_city: 'اصفهان', company_intro: '',
  primary_color: '#7c6cf5', accent_palette: 'lavender', default_theme: 'light', sidebar_mode: 'accordion', sidebar_single: '0', items_per_page: '20', timezone_offset: '+03:30',
  // پیامک (IPPanel Edge)
  sms_enabled: '0', sms_provider: 'log', sms_api_key: '', sms_sender: '', sms_api_base: 'https://edge.ippanel.com/v1', sms_pattern_otp: '', sms_pattern_otp_var: 'code',
  sms_pattern_status: '', sms_template_otp: 'کد ورود شما به سامانهٔ استخدام {company}: {code}', sms_template_status: '{name} گرامی، وضعیت درخواست استخدام شما ({code}) به «{status}» تغییر کرد. {company}',
  sms_template_interview: '{name} گرامی، مصاحبهٔ شما در تاریخ {date} ساعت {time} در {location} برگزار می‌شود. {company}', sms_template_submitted: '{name} گرامی، درخواست استخدام شما با کد پیگیری {code} ثبت شد. {company}',
  sms_notify_status: '1', sms_notify_submitted: '1', sms_notify_hr_new: '0', sms_hr_mobiles: '', sms_price: '0',
  // رمز یکبارمصرف
  otp_length: '5', otp_ttl_minutes: '3', otp_max_attempts: '5', otp_resend_seconds: '90', otp_max_per_hour: '5', otp_dev_show: '0',
  // امنیت
  login_max_attempts: '5', login_lock_minutes: '15', session_days: '7', force_password_change: '0', password_min_length: '8', allowed_login_roles: 'super,hr_manager,hr_staff,employee',
  // استخدام
  recruitment_open: '1', recruitment_intro: 'به سامانهٔ استخدام خوش آمدید. لطفاً ابتدا موقعیت شغلی موردنظر را انتخاب و سپس فرم استخدام را با دقت تکمیل کنید.',
  recruitment_closed_text: 'در حال حاضر فرصت شغلی فعالی وجود ندارد. اطلاعات تماس شما ثبت و در صورت نیاز با شما تماس گرفته می‌شود.',
  recruitment_require_photo: '0', recruitment_require_resume: '0', recruitment_allow_edit_after_submit: '0', recruitment_allow_multiple: '0', recruitment_duplicate_check: 'national_id,mobile',
  recruitment_declaration: 'اینجانب صحت کلیهٔ اطلاعات مندرج در این فرم را تأیید می‌نمایم و در صورت اثبات خلاف آن، شرکت مجاز به اتخاذ هرگونه تصمیم از جمله قطع همکاری خواهد بود.',
  recruitment_form_code: 'OF-FR-01-03', recruitment_tracking_prefix: 'EM', recruitment_auto_archive_days: '180', recruitment_notify_hr_inapp: '1',
  recruitment_thanks_text: 'درخواست شما با موفقیت ثبت شد. همکاران ما پس از بررسی، از طریق پیامک یا تماس تلفنی با شما در ارتباط خواهند بود.',
  // آزمون
  assessment_form_code: 'OF-FR-05-00', assessment_required: '1', assessment_time_limit: '0',
  // سیستم
  demo_mode: '0', maintenance_mode: '0', maintenance_message: '', maintenance_until: '', maintenance_allow_ips: '', disk_alert_enabled: '1', disk_alert_min_mb: '500', disk_alert_percent: '90',
  app_version: '', app_updated_at: '', scheduler_mode: 'internal', cron_token: '', backup_keep: '7', backup_auto_type: 'db', notify_retry_max: '5', upload_max_mb: '5', activity_keep_days: '180',
  employee_code_prefix: 'EMP-', employee_code_next: '1001', dashboard_days: '30', app_url: '',
  // اعلان‌ها و یادآوری‌ها
  sms_template_test: '{name} گرامی، لطفاً «{test}» را در پنل استخدام {company} تکمیل کنید.', sms_notify_interview_reminder: '1', sms_notify_test_reminder: '0',
  assessment_auto_assign: '1', recruitment_sla_days: '5', recruitment_draft_days: '30'
};

let cache = null;
let stored = new Set();

async function load() {
  const rows = await db.table('settings').all();
  cache = Object.assign({}, DEFAULTS);
  stored = new Set();
  for (const r of rows) { cache[r.key] = r.value; stored.add(r.key); }
  return cache;
}
function get(key, def) {
  if (!cache) return def !== undefined ? def : DEFAULTS[key];
  const v = cache[key];
  return v === undefined || v === null ? (def !== undefined ? def : DEFAULTS[key]) : v;
}
function getInt(key, def) { const n = parseInt(get(key), 10); return Number.isNaN(n) ? (def || 0) : n; }
function getBool(key, def) { const v = get(key); if ((v === undefined || v === null || v === '') && def !== undefined) return !!def; return v === '1' || v === 'true' || v === 1 || v === true; }
function getList(key) { return String(get(key) || '').split(',').map((s) => s.trim()).filter(Boolean); }
function all() { return Object.assign({}, DEFAULTS, cache || {}); }
async function set(key, value) {
  value = value == null ? '' : String(value);
  await db.upsert('settings', { key }, { value, updated_at: db.now() });
  if (!cache) cache = Object.assign({}, DEFAULTS);
  cache[key] = value; stored.add(key);
}
async function setMany(obj) { for (const [k, v] of Object.entries(obj)) await set(k, v); }
async function unset(key) { await db.table('settings').where('key', key).delete(); stored.delete(key); if (cache) { if (DEFAULTS[key] !== undefined) cache[key] = DEFAULTS[key]; else delete cache[key]; } }
function storedKeys() { return [...stored]; }
function reset() { cache = null; }

module.exports = { DEFAULTS, load, get, getInt, getBool, getList, all, set, setMany, unset, storedKeys, reset };
