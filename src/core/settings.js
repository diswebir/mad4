'use strict';
/**
 * تنظیمات سامانه (جدول settings) با کش در حافظه
 */
const db = require('./db');

const DEFAULTS = {
  school_name: 'مدرسه نمونه', school_slogan: 'سامانه جامع مدیریت مدرسه', school_type: 'متوسطه اول', school_gender: 'mixed', school_code: '',
  school_phone: '', school_email: '', school_address: '', school_website: '', school_logo: '', principal_name: '', deputy_name: '',
  primary_color: '#2563eb', sidebar_style: 'dark', sidebar_mode: 'accordion', sidebar_single: '0',
  notify_retry_max: '5', backup_auto_type: 'db',
  payment_gateway: 'none', zarinpal_merchant_id: '', zarinpal_sandbox: '0', zarinpal_base_url: '', payment_min_amount: '', payment_allow_partial: '1', payment_description: 'پرداخت {title} — {school}',
  // تولد دانش‌آموزان
  birthday_days_before: '3', birthday_notify_admin: '1', birthday_notify_teacher: '1', birthday_notify_student: '1', birthday_notify_parents: '1', birthday_sms_student: '0', birthday_sms_parents: '0',
  birthday_tpl_admin_upcoming: '', birthday_tpl_admin_today: '', birthday_tpl_teacher: '', birthday_tpl_student: '', birthday_tpl_parent: '', default_theme: 'light', items_per_page: '20', timezone_offset: '+03:30',
  attendance_alert_threshold: '3', attendance_absent_notify: '1', attendance_periods: '4', late_threshold_minutes: '15',
  grading_pass_score: '10', grading_max_score: '20', ticket_categories: 'آموزشی,انضباطی,مالی,فنی,سایر', ticket_auto_close_days: '7', ticket_sla_hours: '48', ticket_sla_urgent_hours: '4', ticket_sla_high_hours: '24', ticket_sla_low_hours: '96', ticket_sla_resolve_days: '7', ticket_sla_warn_percent: '75', ticket_sla_notify: '1',
  sms_enabled: '0', sms_provider: 'log', sms_api_key: '', sms_sender: '', sms_template_absent: 'ولی گرامی، دانش‌آموز {name} امروز {date} در مدرسه حضور نداشت. {school}',
  email_enabled: '0', smtp_host: '', smtp_port: '587', smtp_user: '', smtp_pass: '', smtp_from: '', smtp_secure: '0',
  login_captcha: '1', login_max_attempts: '5', login_lock_minutes: '15', session_days: '7', demo_mode: '0', allow_student_tickets_to_admin: '1',
  school_days: '0,1,2,3,4', working_hours: '07:30-13:30', currency_unit: 'تومان', student_number_prefix: '', student_number_next: '1001',
  sms_webhook_url: '', attendance_edit_days: '3', max_weekly_hours: '24', leave_days_per_year: '30', student_default_password: '', force_password_change: '0', school_short_name: '', invoice_due_days: '30', reminder_interval_days: '7', homework_reminder_days: '1', upload_max_mb: '0', cleanup_notifications_days: '90', cleanup_login_logs_days: '180', cleanup_job_runs_days: '30', dashboard_events_days: '30', dashboard_announcements_count: '5', discipline_report_days: '90',
  maintenance_mode: '0', maintenance_message: '', maintenance_until: '', maintenance_allow_ips: '', disk_alert_enabled: '1', disk_alert_min_mb: '500', disk_alert_percent: '90', app_version: '', app_updated_at: '',
  scheduler_mode: 'internal', backup_keep: '7', backup_offsite_mode: 'none', sms_price: '0', backup_offsite_max_mb: '20', backup_email_to: '', backup_ftp_host: '', backup_ftp_port: '21', backup_ftp_user: '', backup_ftp_pass: '', backup_ftp_dir: 'backups', backup_ftp_secure: '0', backup_webdav_url: '', backup_webdav_user: '', backup_webdav_pass: '', backup_offsite_last: '', log_keep_days: '14', cron_token: '', site_url: '', password_reset_enabled: '1', password_min_length: '6', parent_default_password: '123456', parent_force_change_password: '0', attendance_sms_mode: 'scheduled',
  // کنسول سازنده و گزارش خطا
  superadmin_allow_ips: '', superadmin_alert_email: '', superadmin_session_hours: '12', support_contact_text: '', support_max_per_hour: '10', module_request_note: '',
  lesson_log_edit_days: '7',   admissions_open: '0', admissions_year: '', admissions_grades: '', admissions_text: '', admissions_docs: 'شناسنامه، کارت ملی، کارنامهٔ سال قبل، عکس ۳×۴', school_district: '', signature_image: '', stamp_image: '', letterhead_header: 'جمهوری اسلامی ایران\nوزارت آموزش و پرورش', letterhead_footer: '', signatory_title: 'مدیر مدرسه',
  certificate_template: 'بدین‌وسیله گواهی می‌شود {student} فرزند {father} به شمارهٔ دانش‌آموزی {student_number} و کد ملی {national_id}، در سال تحصیلی {year} در پایهٔ {grade} کلاس {class} این آموزشگاه مشغول به تحصیل است.\nاین گواهی بنا به درخواست نامبرده جهت ارائه به {recipient} صادر گردیده و فاقد هرگونه ارزش دیگری است.',
  invoice_prefix: 'INV-', homework_late_allowed: '1', library_loan_days: '14', library_max_loans: '3', announcement_days_on_dashboard: '30', weekly_periods: '4', period_times: '07:45-08:30,08:40-09:25,09:45-10:30,10:40-11:25,11:35-12:20,12:30-13:15'
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
function getBool(key) { const v = get(key); return v === '1' || v === 'true' || v === 1 || v === true; }
function getList(key) { return String(get(key) || '').split(',').map((s) => s.trim()).filter(Boolean); }
function all() { return Object.assign({}, DEFAULTS, cache || {}); }
async function set(key, value) {
  value = value == null ? '' : String(value);
  await db.upsert('settings', { key }, { value, updated_at: db.now() });
  if (!cache) cache = Object.assign({}, DEFAULTS);
  cache[key] = value; stored.add(key);
}
async function setMany(obj) { for (const [k, v] of Object.entries(obj)) await set(k, v); }
/** حذف مقدار ذخیره‌شده (بازگشت به پیش‌فرض) */
async function unset(key) { await db.table('settings').where('key', key).delete(); stored.delete(key); if (cache) { if (DEFAULTS[key] !== undefined) cache[key] = DEFAULTS[key]; else delete cache[key]; } }
/** کلیدهایی که در پایگاه داده مقدار دارند (برای تشخیص «تغییر یافته نسبت به پیش‌فرض») */
function storedKeys() { return [...stored]; }
function reset() { cache = null; }

module.exports = { DEFAULTS, load, get, getInt, getBool, getList, all, set, setMany, unset, storedKeys, reset };
