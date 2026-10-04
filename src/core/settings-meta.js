'use strict';
/**
 * فراداده‌ی کلیدهای تنظیمات: برچسب فارسی، گروه، نوع و راهنما
 *  - زبانهٔ «همهٔ تنظیمات» (جستجو، ویرایش هر کلید، بازگشت به پیش‌فرض، خروجی/ورودی JSON) از این فهرست استفاده می‌کند
 *  - کلیدهای internal فقط خواندنی‌اند؛ کلیدهای secret پوشانده می‌شوند و در خروجی JSON قرار نمی‌گیرند
 */
const GROUPS = {
  school: 'مدرسه', academic: 'آموزشی', attendance: 'حضور و غیاب', grading: 'نمرات', students: 'دانش‌آموزان و کاربران', communication: 'ارتباطات و تیکت', services: 'خدمات', finance: 'مالی', payment: 'درگاه پرداخت',
  appearance: 'ظاهر', security: 'امنیت', sms: 'پیامک', email: 'ایمیل', birthdays: 'تولدها', backup: 'پشتیبان‌گیری', maintenance: 'نگهداری و دیسک', documents: 'اسناد', admissions: 'پیش‌ثبت‌نام', system: 'سیستم (داخلی)'
};
const T = (group, label, type, help) => ({ group, label, type: type || 'text', help: help || '' });
const META = {
  // مدرسه
  school_name: T('school', 'نام مدرسه'), school_slogan: T('school', 'شعار / زیرعنوان'), school_short_name: T('school', 'نام کوتاه (آیکون اپلیکیشن)', 'text', 'برای PWA وقتی نام مدرسه طولانی است'),
  school_type: T('school', 'مقطع'), school_gender: T('school', 'جنسیت مدرسه', 'select'), school_code: T('school', 'کد مدرسه'), school_phone: T('school', 'تلفن'), school_email: T('school', 'ایمیل'),
  school_address: T('school', 'آدرس', 'textarea'), school_website: T('school', 'وب‌سایت'), school_logo: T('school', 'مسیر لوگو', 'internal'), principal_name: T('school', 'نام مدیر'), deputy_name: T('school', 'نام معاون'),
  school_district: T('documents', 'منطقه / ناحیهٔ آموزش و پرورش'), timezone_offset: T('school', 'منطقهٔ زمانی'), site_url: T('school', 'نشانی عمومی سامانه', 'text', 'برای لینک پیامک‌ها، بازگشت درگاه و cron'),
  // آموزشی
  school_days: T('academic', 'روزهای کاری هفته', 'text', '۰=شنبه … ۶=جمعه با کاما'), working_hours: T('academic', 'ساعت کاری'), weekly_periods: T('academic', 'تعداد زنگ در روز', 'number'), period_times: T('academic', 'زمان زنگ‌ها'),
  attendance_periods: T('attendance', 'حضور و غیاب زنگ‌به‌زنگ', 'bool'), late_threshold_minutes: T('attendance', 'آستانهٔ تأخیر (دقیقه)', 'number'), attendance_alert_threshold: T('attendance', 'هشدار پس از چند غیبت در ماه', 'number'),
  attendance_absent_notify: T('attendance', 'اعلان غیبت به دانش‌آموز/ولی', 'bool'), attendance_sms_mode: T('attendance', 'زمان ارسال پیامک غیبت', 'select'), attendance_edit_days: T('attendance', 'مهلت ویرایش حضور و غیاب توسط معلم (روز)', 'number'),
  grading_max_score: T('grading', 'نمرهٔ کامل', 'number'), grading_pass_score: T('grading', 'نمرهٔ قبولی', 'number'), lesson_log_edit_days: T('academic', 'مهلت ویرایش گزارش تدریس (روز)', 'number'),
  max_weekly_hours: T('academic', 'سقف ساعت تدریس هفتگی هر معلم', 'number'), homework_late_allowed: T('academic', 'اجازهٔ ارسال تکلیف پس از مهلت', 'bool'), homework_reminder_days: T('academic', 'یادآوری تکلیف چند روز قبل از مهلت', 'number'),
  // دانش‌آموزان و کاربران
  student_number_prefix: T('students', 'پیشوند شمارهٔ دانش‌آموزی'), student_number_next: T('students', 'شمارهٔ دانش‌آموزی بعدی', 'number'), student_default_password: T('students', 'رمز پیش‌فرض دانش‌آموز جدید', 'secret', 'خالی = کد ملی'),
  parent_default_password: T('students', 'رمز پیش‌فرض ولی جدید', 'secret', 'خالی = ۱۲۳۴۵۶'), parent_force_change_password: T('students', 'اجبار تغییر رمز ولی در اولین ورود', 'bool'), force_password_change: T('students', 'اجبار تغییر رمز کارکنان/معلمان جدید', 'bool'),
  items_per_page: T('appearance', 'تعداد ردیف در هر صفحه', 'number'),
  // ارتباطات
  ticket_categories: T('communication', 'دسته‌بندی تیکت‌ها', 'text', 'با کاما'), ticket_auto_close_days: T('communication', 'بستن خودکار تیکت پاسخ‌داده‌شده (روز)', 'number'), allow_student_tickets_to_admin: T('communication', 'ارسال تیکت دانش‌آموز به مدیر', 'bool'),
  ticket_sla_hours: T('communication', 'SLA پاسخ — عادی (ساعت)', 'number'), ticket_sla_urgent_hours: T('communication', 'SLA پاسخ — فوری (ساعت)', 'number'), ticket_sla_high_hours: T('communication', 'SLA پاسخ — زیاد (ساعت)', 'number'), ticket_sla_low_hours: T('communication', 'SLA پاسخ — کم (ساعت)', 'number'),
  ticket_sla_resolve_days: T('communication', 'مهلت حل نهایی تیکت (روز)', 'number'), ticket_sla_warn_percent: T('communication', 'هشدار نزدیک مهلت از (٪)', 'number'), ticket_sla_notify: T('communication', 'اعلان خودکار خارج از مهلت', 'bool'),
  announcement_days_on_dashboard: T('communication', 'اطلاعیه‌های چند روز اخیر در داشبورد', 'number'), dashboard_announcements_count: T('communication', 'تعداد اطلاعیه در داشبورد', 'number'), dashboard_events_days: T('communication', 'رویدادهای چند روز آینده در داشبورد', 'number'),
  reminder_interval_days: T('communication', 'فاصلهٔ تکرار یادآوری معوقات (روز)', 'number', 'شهریهٔ معوق و دیرکرد کتاب'), notify_retry_max: T('communication', 'حداکثر تلاش مجدد پیامک/ایمیل', 'number'),
  // خدمات
  library_loan_days: T('services', 'مدت امانت کتاب (روز)', 'number'), library_max_loans: T('services', 'حداکثر امانت هم‌زمان', 'number'), leave_days_per_year: T('services', 'سقف مرخصی سالانهٔ کارکنان (روز)', 'number'), discipline_report_days: T('services', 'بازهٔ پیش‌فرض گزارش انضباطی (روز)', 'number'),
  // مالی
  currency_unit: T('finance', 'واحد پول'), invoice_prefix: T('finance', 'پیشوند شمارهٔ صورت‌حساب'), invoice_due_days: T('finance', 'سررسید پیش‌فرض صورت‌حساب (روز)', 'number'),
  payment_gateway: T('payment', 'درگاه پرداخت', 'select'), zarinpal_merchant_id: T('payment', 'مرچنت زرین‌پال', 'secret'), zarinpal_sandbox: T('payment', 'حالت آزمایشی زرین‌پال', 'bool'), zarinpal_base_url: T('payment', 'آدرس API زرین‌پال'),
  payment_min_amount: T('payment', 'حداقل مبلغ پرداخت آنلاین', 'number'), payment_allow_partial: T('payment', 'اجازهٔ پرداخت جزئی', 'bool'), payment_description: T('payment', 'شرح پرداخت در درگاه'),
  // ظاهر
  primary_color: T('appearance', 'رنگ اصلی'), default_theme: T('appearance', 'پوستهٔ پیش‌فرض', 'select'), sidebar_style: T('appearance', 'سبک منوی کناری', 'select'), sidebar_mode: T('appearance', 'چیدمان منوی کناری', 'select'), sidebar_single: T('appearance', 'فقط یک گروه منو باز باشد', 'bool'),
  // امنیت
  login_captcha: T('security', 'سؤال امنیتی ورود', 'bool'), login_max_attempts: T('security', 'حداکثر تلاش ناموفق ورود', 'number'), login_lock_minutes: T('security', 'مدت قفل حساب (دقیقه)', 'number'), session_days: T('security', 'طول نشست «مرا به خاطر بسپار» (روز)', 'number'),
  password_reset_enabled: T('security', 'بازیابی رمز توسط کاربر', 'bool'), password_min_length: T('security', 'حداقل طول رمز عبور', 'number'), log_keep_days: T('maintenance', 'نگه‌داری فایل‌های لاگ (روز)', 'number'),
  // پیامک / ایمیل
  sms_enabled: T('sms', 'ارسال پیامک فعال', 'bool'), sms_provider: T('sms', 'سرویس‌دهندهٔ پیامک', 'select'), sms_api_key: T('sms', 'کلید API پیامک', 'secret'), sms_sender: T('sms', 'شمارهٔ فرستنده'), sms_webhook_url: T('sms', 'آدرس وب‌هوک پیامک'),
  sms_template_absent: T('sms', 'الگوی پیامک غیبت', 'textarea'), sms_price: T('sms', 'هزینهٔ هر پیامک', 'number'),
  email_enabled: T('email', 'ارسال ایمیل فعال', 'bool'), smtp_host: T('email', 'سرور SMTP'), smtp_port: T('email', 'پورت SMTP', 'number'), smtp_user: T('email', 'نام کاربری SMTP'), smtp_pass: T('email', 'رمز SMTP', 'secret'), smtp_from: T('email', 'فرستندهٔ ایمیل'), smtp_secure: T('email', 'اتصال امن (TLS/SSL)', 'bool'),
  // تولدها
  birthday_days_before: T('birthdays', 'یادآوری چند روز قبل', 'number'), birthday_notify_admin: T('birthdays', 'اعلان به مدیر', 'bool'), birthday_notify_teacher: T('birthdays', 'اعلان به معلم راهنما', 'bool'), birthday_notify_student: T('birthdays', 'تبریک به دانش‌آموز', 'bool'), birthday_notify_parents: T('birthdays', 'تبریک به اولیا', 'bool'),
  birthday_sms_student: T('birthdays', 'پیامک تبریک به دانش‌آموز', 'bool'), birthday_sms_parents: T('birthdays', 'پیامک تبریک به اولیا', 'bool'), birthday_tpl_admin_upcoming: T('birthdays', 'الگوی پیام مدیر (پیش از تولد)', 'textarea'), birthday_tpl_admin_today: T('birthdays', 'الگوی پیام مدیر (روز تولد)', 'textarea'),
  birthday_tpl_teacher: T('birthdays', 'الگوی پیام معلم', 'textarea'), birthday_tpl_student: T('birthdays', 'الگوی پیام دانش‌آموز', 'textarea'), birthday_tpl_parent: T('birthdays', 'الگوی پیام اولیا', 'textarea'),
  // پشتیبان
  scheduler_mode: T('backup', 'حالت زمان‌بند', 'select', 'internal یا cron'), backup_keep: T('backup', 'تعداد پشتیبان خودکار نگه‌داشته‌شده', 'number'), backup_auto_type: T('backup', 'نوع پشتیبان خودکار', 'select', 'db یا full'),
  backup_offsite_mode: T('backup', 'ارسال پشتیبان به بیرون', 'select'), backup_offsite_max_mb: T('backup', 'حداکثر حجم ارسال (مگابایت)', 'number'), backup_email_to: T('backup', 'ایمیل مقصد پشتیبان'), backup_ftp_host: T('backup', 'سرور FTP'), backup_ftp_port: T('backup', 'پورت FTP', 'number'),
  backup_ftp_user: T('backup', 'کاربر FTP'), backup_ftp_pass: T('backup', 'رمز FTP', 'secret'), backup_ftp_dir: T('backup', 'پوشهٔ FTP'), backup_ftp_secure: T('backup', 'FTPS', 'bool'), backup_webdav_url: T('backup', 'آدرس WebDAV'), backup_webdav_user: T('backup', 'کاربر WebDAV'), backup_webdav_pass: T('backup', 'رمز WebDAV', 'secret'),
  backup_offsite_last: T('backup', 'آخرین ارسال پشتیبان', 'internal'), cron_token: T('system', 'توکن cron', 'secret'),
  // نگهداری و دیسک
  maintenance_mode: T('maintenance', 'حالت تعمیر و نگهداری', 'bool'), maintenance_message: T('maintenance', 'پیام حالت نگهداری', 'textarea'), maintenance_until: T('maintenance', 'زمان بازگشت'), maintenance_allow_ips: T('maintenance', 'IPهای مجاز در حالت نگهداری'),
  disk_alert_enabled: T('maintenance', 'هشدار پرشدن دیسک', 'bool'), disk_alert_min_mb: T('maintenance', 'حداقل فضای آزاد (مگابایت)', 'number'), disk_alert_percent: T('maintenance', 'حداکثر درصد استفادهٔ دیسک', 'number'),
  upload_max_mb: T('maintenance', 'سقف حجم پیوست‌های کاربران (مگابایت)', 'number', 'تکالیف، مدارک، تیکت‌ها، گواهی غیبت، پیش‌ثبت‌نام؛ ۰ = سقف پیش‌فرض هر فرم (۵ تا ۲۰ مگابایت)'), cleanup_notifications_days: T('maintenance', 'حذف اعلان‌های خوانده‌شده پس از (روز)', 'number'),
  cleanup_login_logs_days: T('maintenance', 'حذف لاگ ورود پس از (روز)', 'number'), cleanup_job_runs_days: T('maintenance', 'حذف سابقهٔ اجرای کارها پس از (روز)', 'number'),
  // اسناد
  letterhead_header: T('documents', 'سربرگ اسناد', 'textarea'), letterhead_footer: T('documents', 'پانویس اسناد', 'textarea'), signatory_title: T('documents', 'عنوان امضاکننده'), certificate_template: T('documents', 'الگوی گواهی اشتغال به تحصیل', 'textarea'),
  signature_image: T('documents', 'مسیر تصویر امضا', 'internal'), stamp_image: T('documents', 'مسیر تصویر مهر', 'internal'),
  // پیش‌ثبت‌نام
  admissions_open: T('admissions', 'پیش‌ثبت‌نام باز است', 'bool'), admissions_year: T('admissions', 'سال تحصیلی پیش‌ثبت‌نام'), admissions_grades: T('admissions', 'پایه‌های مجاز (شناسه با کاما)'), admissions_text: T('admissions', 'متن راهنمای فرم', 'textarea'), admissions_docs: T('admissions', 'مدارک لازم'),
  // داخلی
  demo_mode: T('system', 'دادهٔ نمونه بارگذاری شده', 'internal'), installed_at: T('system', 'تاریخ نصب', 'internal'), app_version: T('system', 'نسخهٔ ثبت‌شده', 'internal'), app_updated_at: T('system', 'زمان آخرین به‌روزرسانی', 'internal'),
  current_year_id: T('system', 'سال تحصیلی جاری', 'internal'), setup_checklist_dismissed: T('system', 'چک‌لیست راه‌اندازی پنهان شده', 'internal')
};
const SECRET_RE = /(pass|secret|api_key|token|merchant)/i;
function meta(key) { return META[key] || { group: 'system', label: key, type: SECRET_RE.test(key) ? 'secret' : 'text', help: '' }; }
function isSecret(key) { const m = meta(key); return m.type === 'secret' || SECRET_RE.test(key); }
function isInternal(key) { return meta(key).type === 'internal'; }
function groupTitle(g) { return GROUPS[g] || g; }
module.exports = { META, GROUPS, meta, isSecret, isInternal, groupTitle };
