'use strict';
/**
 * سامانهٔ مجوزها (ماتریس دسترسی)
 *  - مدیر (admin) همهٔ مجوزها را دارد.
 *  - کارمند (staff) مجوزها را از «سمت» (positions) + مجوزهای اختصاصی کاربر می‌گیرد.
 *  - معلم/دانش‌آموز/ولی رفتار نقشی ثابت دارند ولی می‌توان مجوز اضافی به آن‌ها داد (مثلاً معلمی که کتابدار هم هست).
 */
const db = require('./db');

const GROUPS = [
  { key: 'students', title: 'دانش‌آموزان و اولیا', items: [
    ['students.view', 'مشاهدهٔ پروندهٔ دانش‌آموزان'], ['students.manage', 'ثبت و ویرایش دانش‌آموزان'], ['students.import_export', 'ورود/خروج گروهی (CSV)'], ['students.notes', 'یادداشت‌های پرونده'], ['parents.manage', 'مدیریت حساب اولیا'] ] },
  { key: 'staffing', title: 'معلمان، کارکنان و کاربران', items: [
    ['teachers.view', 'مشاهدهٔ معلمان'], ['teachers.manage', 'ثبت و ویرایش معلمان'], ['users.manage', 'مدیریت کاربران'], ['positions.manage', 'مدیریت سمت‌ها و مجوزها'], ['hr.view_all', 'مشاهدهٔ همهٔ مرخصی‌ها'], ['hr.manage', 'بررسی و تأیید مرخصی‌ها'] ] },
  { key: 'academic', title: 'آموزش', items: [
    ['academic.manage', 'ساختار آموزشی (پایه، درس، کلاس)'], ['academic.schedule', 'برنامهٔ هفتگی'], ['attendance.view_all', 'مشاهدهٔ حضور و غیاب همهٔ کلاس‌ها'], ['attendance.manage_all', 'ثبت/ویرایش حضور و غیاب همهٔ کلاس‌ها'], ['attendance.excuses', 'بررسی موجه‌سازی غیبت'],
    ['exams.view_all', 'مشاهدهٔ آزمون‌ها و نمرات همه'], ['exams.manage_all', 'ثبت/ویرایش آزمون و نمرات همه'], ['exams.lock', 'قفل/بازکردن نوبت و ویرایش نمرات قفل‌شده'], ['homework.view_all', 'مشاهدهٔ تکالیف همهٔ کلاس‌ها'], ['lessons.view_all', 'مشاهدهٔ دفتر کلاسی همهٔ معلمان'], ['lessons.syllabus', 'مدیریت بودجه‌بندی دروس'] ] },
  { key: 'communication', title: 'ارتباطات', items: [
    ['tickets.manage', 'پاسخ‌گویی به تیکت‌ها'], ['tickets.assign', 'ارجاع و مدیریت تیکت‌ها'], ['announcements.manage', 'اطلاعیه‌ها'], ['messages.broadcast', 'ارسال پیام گروهی'], ['notifications.send', 'ارسال اعلان/پیامک گروهی'], ['polls.manage', 'نظرسنجی‌ها'], ['calendar.manage', 'رویدادهای تقویم'] ] },
  { key: 'affairs', title: 'امور دانش‌آموزی و خدمات', items: [
    ['discipline.view', 'مشاهدهٔ موارد انضباطی'], ['discipline.manage', 'ثبت موارد انضباطی/تشویقی'], ['health.manage', 'سوابق سلامت'], ['counseling.manage', 'جلسات مشاوره'], ['counseling.confidential', 'مشاهدهٔ جلسات محرمانه'],
    ['transport.manage', 'سرویس مدرسه'], ['library.manage', 'کتابخانه و امانت'], ['admissions.manage', 'پیش‌ثبت‌نام و پذیرش'], ['documents.issue', 'صدور گواهی و فرم‌های رسمی'] ] },
  { key: 'finance', title: 'مالی', items: [
    ['finance.view', 'مشاهدهٔ امور مالی'], ['finance.manage', 'تعریف شهریه و صدور صورت‌حساب'], ['finance.payments', 'ثبت پرداخت'] ] },
  { key: 'system', title: 'گزارش‌ها و سیستم', items: [
    ['reports.view', 'گزارش‌های مدیریتی'], ['system.settings', 'تنظیمات سامانه'], ['system.modules', 'ماژول‌ها و قابلیت‌ها'], ['system.backup', 'پشتیبان‌گیری'], ['system.logs', 'لاگ فعالیت و پیامک'], ['system.jobs', 'کارهای زمان‌بندی‌شده'] ] }
];
const ALL = GROUPS.flatMap((g) => g.items.map((i) => i[0]));
const LABELS = Object.fromEntries(GROUPS.flatMap((g) => g.items));

const DEFAULT_POSITIONS = [
  { title: 'معاون آموزشی', description: 'آموزش، حضور و غیاب، آزمون‌ها و ارتباط با اولیا', permissions: ['students.view', 'students.manage', 'students.notes', 'parents.manage', 'teachers.view', 'academic.manage', 'academic.schedule', 'attendance.view_all', 'attendance.manage_all', 'attendance.excuses', 'exams.view_all', 'exams.manage_all', 'homework.view_all', 'lessons.view_all', 'lessons.syllabus', 'tickets.manage', 'announcements.manage', 'messages.broadcast', 'notifications.send', 'calendar.manage', 'reports.view', 'documents.issue'] },
  { title: 'معاون پرورشی و انضباطی', description: 'انضباط، سلامت، مشاوره، فعالیت‌های پرورشی', permissions: ['students.view', 'students.notes', 'parents.manage', 'attendance.view_all', 'attendance.excuses', 'discipline.view', 'discipline.manage', 'health.manage', 'counseling.manage', 'polls.manage', 'announcements.manage', 'calendar.manage', 'tickets.manage', 'messages.broadcast', 'notifications.send', 'reports.view'] },
  { title: 'دفتردار و مسئول ثبت‌نام', description: 'پرونده‌ها، ثبت‌نام، گواهی‌ها و سرویس', permissions: ['students.view', 'students.manage', 'students.import_export', 'parents.manage', 'admissions.manage', 'documents.issue', 'transport.manage', 'tickets.manage', 'reports.view'] },
  { title: 'حسابدار', description: 'شهریه، صورت‌حساب و پرداخت‌ها', permissions: ['students.view', 'finance.view', 'finance.manage', 'finance.payments', 'transport.manage', 'reports.view'] },
  { title: 'مشاور', description: 'جلسات مشاوره و پیگیری دانش‌آموزان', permissions: ['students.view', 'students.notes', 'counseling.manage', 'counseling.confidential', 'discipline.view', 'health.manage', 'tickets.manage'] },
  { title: 'کتابدار', description: 'کتابخانه و امانت کتاب', permissions: ['students.view', 'library.manage'] },
  { title: 'مسئول فناوری', description: 'کاربران، تنظیمات، پشتیبان‌گیری و زمان‌بند', permissions: ['users.manage', 'system.settings', 'system.modules', 'system.backup', 'system.logs', 'system.jobs', 'notifications.send'] }
];

let positionsCache = null;
async function positions() {
  if (!positionsCache) {
    const rows = await db.table('positions').orderBy('id').all();
    positionsCache = rows.map((r) => Object.assign(r, { perms: parseList(r.permissions) }));
  }
  return positionsCache;
}
function reload() { positionsCache = null; }
function parseList(v) { if (!v) return []; if (Array.isArray(v)) return v; try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch (e) { return String(v).split(',').map((x) => x.trim()).filter(Boolean); } }

/** مجموعهٔ مجوزهای مؤثر کاربر */
async function permissionsOf(user) {
  if (!user) return new Set();
  if (user.role === 'admin') return new Set(ALL);
  const set = new Set(parseList(user.permissions));
  if (user.position_id) { const p = (await positions()).find((x) => x.id === Number(user.position_id)); if (p) p.perms.forEach((k) => set.add(k)); }
  return set;
}
function can(user, ...keys) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const set = user.perms || new Set();
  return keys.flat().some((k) => set.has(k));
}
async function ensureDefaults() {
  if (await db.table('positions').exists()) return 0;
  const now = db.now(); let n = 0;
  for (const p of DEFAULT_POSITIONS) { await db.insert('positions', { title: p.title, description: p.description, permissions: JSON.stringify(p.permissions), is_system: 1, created_at: now, updated_at: now }); n++; }
  reload(); return n;
}
module.exports = { GROUPS, ALL, LABELS, DEFAULT_POSITIONS, positions, reload, permissionsOf, can, parseList, ensureDefaults };
