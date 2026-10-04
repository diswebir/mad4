'use strict';
/** چک‌لیست راه‌اندازی اولیهٔ مدرسه — وضعیت زنده از پایگاه داده و تنظیمات */
const db = require('../../core/db');
const settings = require('../../core/settings');
const modules = require('../../core/modules');
const auth = require('../../core/auth');
const backup = require('../../core/backup');
const J = require('../../core/jalali');

const on = (k) => modules.isEnabled(k);

/**
 * @returns {Promise<{items: Array, done: number, total: number, percent: number, requiredLeft: number, dismissed: boolean}>}
 */
let cached = null; let cachedAt = 0;
const TTL_MS = 30 * 1000;
/** نتیجهٔ محاسبه برای ۳۰ ثانیه کش می‌شود (داشبورد پربازدید است؛ مقایسهٔ bcrypt هزینه دارد) — با force=true تازه‌سازی می‌شود */
async function compute(force) {
  if (!force && cached && Date.now() - cachedAt < TTL_MS) return cached;
  cached = await computeFresh(); cachedAt = Date.now();
  return cached;
}
function invalidate() { cached = null; }

async function computeFresh() {
  const items = [];
  const add = (it) => items.push(Object.assign({ required: true }, it));

  // ۱) اطلاعات مدرسه
  const phone = settings.get('school_phone'), addr = settings.get('school_address');
  add({ key: 'school', title: 'اطلاعات مدرسه تکمیل شود', desc: 'نام، مقطع، تلفن و آدرس مدرسه (در سربرگ اسناد و پیامک‌ها استفاده می‌شود)', href: '/system/settings?tab=school', icon: 'bi-building', done: !!(phone && addr) });
  add({ key: 'logo', title: 'لوگوی مدرسه بارگذاری شود', desc: 'در منو، صفحهٔ ورود، کارت‌ها و اسناد رسمی نمایش داده می‌شود', href: '/system/settings?tab=school', icon: 'bi-image', done: !!settings.get('school_logo'), required: false });

  // ۲) امنیت
  const admin = await db.table('users').where('role', 'admin').orderBy('id').first();
  let weak = false;
  if (admin) weak = await auth.verifyPassword('admin123', admin.password) || await auth.verifyPassword('123456', admin.password) || await auth.verifyPassword(admin.username, admin.password);
  add({ key: 'password', title: 'رمز عبور پیش‌فرض مدیر تغییر کند', desc: 'رمز فعلی مدیر، یکی از رمزهای پیش‌فرض/ساده است', href: '/auth/password', icon: 'bi-shield-lock', done: !!admin && !weak });

  // ۳) ساختار آموزشی
  const year = await db.table('academic_years').where('is_current', 1).first();
  add({ key: 'year', title: 'سال تحصیلی جاری تعریف شود', desc: 'همهٔ کلاس‌ها، نمرات و حضور و غیاب به سال تحصیلی جاری وابسته‌اند', href: '/academic/years', icon: 'bi-calendar-range', done: !!year });
  const grades = await db.count('grade_levels'); const classes = await db.count('classes', { is_active: 1 });
  add({ key: 'classes', title: 'پایه‌ها و کلاس‌ها ساخته شوند', desc: grades ? `${J.toPersianDigits(grades)} پایه و ${J.toPersianDigits(classes)} کلاس فعال` : 'ابتدا پایه‌های تحصیلی، سپس کلاس‌های هر پایه', href: '/academic/classes', icon: 'bi-door-open', done: grades > 0 && classes > 0 });
  const subjects = await db.count('subjects'); const cs = await db.count('class_subjects');
  add({ key: 'subjects', title: 'درس‌ها تعریف و به کلاس‌ها/معلمان تخصیص یابند', desc: 'بدون تخصیص درس، معلم نمی‌تواند نمره، تکلیف یا حضور زنگی ثبت کند', href: '/academic/subjects', icon: 'bi-journal-bookmark', done: subjects > 0 && cs > 0 });

  // ۴) افراد
  const teachers = await db.count('teachers', { status: 'active' });
  add({ key: 'teachers', title: 'معلمان ثبت شوند', desc: teachers ? `${J.toPersianDigits(teachers)} معلم فعال` : 'برای هر معلم حساب کاربری ساخته می‌شود؛ کلاس را به معلم راهنما بسپارید', href: '/teachers/new', icon: 'bi-person-video3', done: teachers > 0 });
  const students = await db.count('students', { status: 'active' });
  add({ key: 'students', title: 'دانش‌آموزان ثبت‌نام شوند', desc: students ? `${J.toPersianDigits(students)} دانش‌آموز فعال` : 'ثبت تکی یا ورود گروهی از فایل CSV (الگو در صفحهٔ ورود گروهی)', href: students ? '/students' : (on('students.import') ? '/students/import' : '/students/new'), icon: 'bi-people', done: students > 0 });
  const noClass = students ? await db.table('students').where('status', 'active').whereNull('class_id').count() : 0;
  add({ key: 'placement', title: 'همهٔ دانش‌آموزان فعال کلاس داشته باشند', desc: noClass ? `${J.toPersianDigits(noClass)} دانش‌آموز بدون کلاس` : 'کلاس‌بندی کامل است', href: '/students?no_class=1', icon: 'bi-diagram-3', done: students > 0 && noClass === 0, required: false });
  if (on('academic.schedule')) {
    const slots = await db.count('schedule_slots');
    add({ key: 'schedule', title: 'برنامهٔ هفتگی کلاس‌ها تنظیم شود', desc: 'مبنای حضور و غیاب زنگی، دفتر کلاسی و برنامهٔ معلم/دانش‌آموز', href: '/academic/schedule', icon: 'bi-table', done: slots > 0, required: false });
  }
  if (on('parents')) {
    const parents = await db.count('parents');
    add({ key: 'parents', title: 'حساب اولیا ساخته شود', desc: parents ? `${J.toPersianDigits(parents)} حساب ولی` : 'از پروندهٔ دانش‌آموز یا به‌صورت گروهی برای همهٔ دانش‌آموزان', href: '/parents', icon: 'bi-person-hearts', done: parents > 0, required: false });
  }

  // ۵) ارتباطات و نگهداری
  if (on('notifications.sms')) {
    const smsOk = settings.getBool('sms_enabled') && settings.get('sms_provider', 'log') !== 'log';
    add({ key: 'sms', title: 'درگاه پیامک پیکربندی شود', desc: 'برای پیامک غیبت به اولیا، کد بازیابی رمز و اطلاع‌رسانی‌ها (اختیاری)', href: '/system/settings?tab=sms', icon: 'bi-chat-left-text', done: smsOk, required: false });
  }
  add({ key: 'site_url', title: 'نشانی اینترنتی سامانه ثبت شود', desc: 'در لینک‌های پیامک/ایمیل و فرم پیش‌ثبت‌نام استفاده می‌شود', href: '/system/settings?tab=sms', icon: 'bi-link-45deg', done: !!settings.get('site_url'), required: false });
  if (on('system.backup')) {
    let hasBackup = false; try { hasBackup = backup.list().length > 0; } catch (e) { hasBackup = false; }
    const autoJob = await db.table('scheduled_jobs').where('key', 'backup_auto').first().catch(() => null);
    add({ key: 'backup', title: 'پشتیبان‌گیری فعال باشد', desc: 'حداقل یک نسخهٔ پشتیبان بگیرید و کار «پشتیبان‌گیری خودکار» را فعال نگه دارید', href: '/system/backup', icon: 'bi-cloud-arrow-down', done: hasBackup || !!(autoJob && autoJob.is_enabled && autoJob.last_run_at) });
    if (on('system.backup_offsite')) {
      const offsite = require('../../core/offsite');
      add({ key: 'backup_offsite', title: 'نسخهٔ پشتیبان بیرون از سرور', desc: 'مقصد ایمیل/FTP/WebDAV را تنظیم کنید تا پشتیبان شبانه خارج از هاست هم نگه‌داری شود', href: '/system/settings?tab=offsite', icon: 'bi-cloud-upload', done: offsite.configured(), required: false });
    }
  }
  if (on('system.scheduler')) {
    const recent = await db.table('scheduled_jobs').whereNotNull('last_run_at').orderBy('last_run_at', 'desc').first().catch(() => null);
    const alive = recent && recent.last_run_at && J.localDateOf(recent.last_run_at) >= J.addDays(J.todayISO(), -2);
    add({ key: 'cron', title: 'زمان‌بند کارها در حال اجرا باشد', desc: alive ? 'آخرین اجرا: ' + J.formatDateTime(recent.last_run_at) : 'اگر هاست برنامه را به خواب می‌برد، cron هاست یا سرویس بیرونی را تنظیم کنید', href: '/system/jobs', icon: 'bi-alarm', done: !!alive, required: false });
  }
  if (settings.getBool('demo_mode')) {
    add({ key: 'demo', title: 'دادهٔ نمونه قبل از استفادهٔ واقعی حذف شود', desc: 'حساب‌های نمونه (admin123 / 123456) در صفحهٔ ورود نمایش داده می‌شوند', href: '/system/settings?tab=demo', icon: 'bi-database-x', done: false });
  }

  const required = items.filter((i) => i.required);
  const doneAll = items.filter((i) => i.done).length;
  const requiredLeft = required.filter((i) => !i.done).length;
  return {
    items, done: doneAll, total: items.length, percent: items.length ? Math.round((doneAll / items.length) * 100) : 100,
    requiredLeft, dismissed: settings.getBool('setup_checklist_dismissed')
  };
}

module.exports = { compute, invalidate };
