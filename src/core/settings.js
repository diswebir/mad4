'use strict';
/**
 * تنظیمات سامانه (جدول settings) با کش در حافظه
 */
const db = require('./db');

const DEFAULTS = {
  school_name: 'مدرسه نمونه', school_slogan: 'سامانه جامع مدیریت مدرسه', school_type: 'متوسطه اول', school_gender: 'mixed', school_code: '',
  school_phone: '', school_email: '', school_address: '', school_website: '', school_logo: '', principal_name: '', deputy_name: '',
  primary_color: '#2563eb', sidebar_style: 'dark', default_theme: 'light', items_per_page: '20', timezone_offset: '+03:30',
  attendance_alert_threshold: '3', attendance_absent_notify: '1', attendance_periods: '4', late_threshold_minutes: '15',
  grading_pass_score: '10', grading_max_score: '20', ticket_categories: 'آموزشی,انضباطی,مالی,فنی,سایر', ticket_auto_close_days: '7',
  sms_enabled: '0', sms_provider: 'log', sms_api_key: '', sms_sender: '', sms_template_absent: 'ولی گرامی، دانش‌آموز {name} امروز {date} در مدرسه حضور نداشت. {school}',
  email_enabled: '0', smtp_host: '', smtp_port: '587', smtp_user: '', smtp_pass: '', smtp_from: '', smtp_secure: '0',
  login_captcha: '1', login_max_attempts: '5', login_lock_minutes: '15', session_days: '7', demo_mode: '0', allow_student_tickets_to_admin: '1',
  school_days: '0,1,2,3,4', working_hours: '07:30-13:30', currency_unit: 'تومان', student_number_prefix: '', student_number_next: '1001',
  scheduler_mode: 'internal', backup_keep: '7', cron_token: '', site_url: '', password_reset_enabled: '1', password_min_length: '6', parent_default_password: '123456', parent_force_change_password: '0', attendance_sms_mode: 'scheduled',
  admissions_open: '0', admissions_year: '', admissions_grades: '', admissions_text: '', admissions_docs: 'شناسنامه، کارت ملی، کارنامهٔ سال قبل، عکس ۳×۴', school_district: '', signature_image: '', stamp_image: '', letterhead_header: 'جمهوری اسلامی ایران\nوزارت آموزش و پرورش', letterhead_footer: '', signatory_title: 'مدیر مدرسه',
  certificate_template: 'بدین‌وسیله گواهی می‌شود {student} فرزند {father} به شمارهٔ دانش‌آموزی {student_number} و کد ملی {national_id}، در سال تحصیلی {year} در پایهٔ {grade} کلاس {class} این آموزشگاه مشغول به تحصیل است.\nاین گواهی بنا به درخواست نامبرده جهت ارائه به {recipient} صادر گردیده و فاقد هرگونه ارزش دیگری است.',
  invoice_prefix: 'INV-', homework_late_allowed: '1', library_loan_days: '14', library_max_loans: '3', announcement_days_on_dashboard: '30', weekly_periods: '4', period_times: '07:45-08:30,08:40-09:25,09:45-10:30,10:40-11:25,11:35-12:20,12:30-13:15'
};

let cache = null;

async function load() {
  const rows = await db.table('settings').all();
  cache = Object.assign({}, DEFAULTS);
  for (const r of rows) cache[r.key] = r.value;
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
  cache[key] = value;
}
async function setMany(obj) { for (const [k, v] of Object.entries(obj)) await set(k, v); }
function reset() { cache = null; }

module.exports = { DEFAULTS, load, get, getInt, getBool, getList, all, set, setMany, reset };
