'use strict';
/**
 * سامانهٔ نقش‌ها و مجوزها (ماتریس دسترسی)
 *  - نقش‌های پایه (role): super | hr_manager | hr_staff | employee | applicant — رفتار داشبورد و دامنهٔ دید را تعیین می‌کنند.
 *  - هر کاربر می‌تواند یک «سطح دسترسی» (roles.id → role_id) داشته باشد که مجموعه‌ای از مجوزها را می‌دهد؛
 *    مدیر ارشد می‌تواند سطوح دسترسی جدید با هر ترکیبی از مجوزها بسازد.
 *  - مجوزهای اختصاصی کاربر (users.permissions JSON) به مجوزهای سطح دسترسی اضافه می‌شوند.
 *  - super همهٔ مجوزها را دارد.
 */
const db = require('./db');

const GROUPS = [
  { key: 'recruitment', title: 'استخدام و متقاضیان', items: [
    ['jobs.view', 'مشاهدهٔ موقعیت‌های شغلی'], ['jobs.manage', 'تعریف و ویرایش موقعیت‌های شغلی'],
    ['applicants.view', 'مشاهدهٔ پرونده‌های متقاضیان'], ['applicants.manage', 'تغییر وضعیت، یادداشت و برچسب پرونده‌ها'], ['applicants.evaluate', 'ثبت نظر مصاحبه‌کننده / منابع انسانی'],
    ['applicants.decide', 'تصمیم نهایی مدیریت (استخدام / رد)'], ['applicants.export', 'خروجی و چاپ فرم متقاضیان'], ['applicants.delete', 'حذف پرونده‌ها'],
    ['interviews.manage', 'زمان‌بندی مصاحبه‌ها'], ['invites.manage', 'ساخت لینک و QR دعوت'], ['forms.manage', 'طراحی فرم استخدام (فیلدها و الزامات)'] ] },
  { key: 'assessments', title: 'آزمون‌ها و تحلیل', items: [
    ['assessments.view', 'مشاهدهٔ نتایج و تحلیل آزمون‌ها'], ['assessments.assign', 'تخصیص آزمون به متقاضی'], ['assessments.manage', 'مدیریت بانک سؤال و تنظیمات آزمون'] ] },
  { key: 'employees', title: 'کارکنان', items: [
    ['employees.view', 'مشاهدهٔ فهرست کارکنان'], ['employees.manage', 'ثبت و ویرایش کارکنان'], ['announcements.manage', 'اطلاعیه‌های داخلی'] ] },
  { key: 'system', title: 'کاربران، گزارش‌ها و سیستم', items: [
    ['reports.view', 'گزارش‌ها و داشبورد مدیریتی'], ['users.manage', 'مدیریت کاربران'], ['roles.manage', 'مدیریت سطوح دسترسی'], ['notifications.send', 'ارسال اعلان و پیامک'],
    ['settings.manage', 'تنظیمات سامانه'], ['modules.manage', 'ماژول‌ها و قابلیت‌ها'], ['logs.view', 'لاگ فعالیت، ورود و پیامک'], ['backup.manage', 'پشتیبان‌گیری و بازیابی'] ] }
];
const ALL = GROUPS.flatMap((g) => g.items.map((i) => i[0]));
const LABELS = Object.fromEntries(GROUPS.flatMap((g) => g.items));

/** نقش‌های پایه و مجوزهای پیش‌فرض آن‌ها (سطوح دسترسی سیستمی) */
const DEFAULT_ROLES = [
  { key: 'hr_manager', title: 'مدیر منابع انسانی', base_role: 'hr_manager', color: 'primary', description: 'دسترسی کامل به استخدام، آزمون‌ها، کارکنان، گزارش‌ها و کاربران',
    permissions: ALL.filter((k) => !['settings.manage', 'modules.manage', 'backup.manage', 'roles.manage'].includes(k)) },
  { key: 'hr_staff', title: 'کارشناس منابع انسانی', base_role: 'hr_staff', color: 'info', description: 'بررسی پرونده‌ها، مصاحبه، تخصیص آزمون و مشاهدهٔ نتایج',
    permissions: ['jobs.view', 'applicants.view', 'applicants.manage', 'applicants.evaluate', 'applicants.export', 'interviews.manage', 'invites.manage', 'assessments.view', 'assessments.assign', 'employees.view'] },
  { key: 'employee', title: 'کارمند شرکت', base_role: 'employee', color: 'success', description: 'پنل شخصی کارمند (پروفایل، اطلاعیه‌ها)', permissions: [] },
  { key: 'applicant', title: 'متقاضی استخدام', base_role: 'applicant', color: 'warning', description: 'پنل متقاضی (فرم استخدام و آزمون)', permissions: [] }
];

let rolesCache = null;
async function roles() {
  if (!rolesCache) {
    const rows = await db.table('roles').orderBy('sort_order').orderBy('id').all();
    rolesCache = rows.map((r) => Object.assign(r, { perms: parseList(r.permissions) }));
  }
  return rolesCache;
}
function reload() { rolesCache = null; }
function parseList(v) { if (!v) return []; if (Array.isArray(v)) return v; try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch (e) { return String(v).split(',').map((x) => x.trim()).filter(Boolean); } }

/** مجموعهٔ مجوزهای مؤثر کاربر */
async function permissionsOf(user) {
  if (!user) return new Set();
  if (user.role === 'super' || Number(user.is_super)) return new Set(ALL);
  const set = new Set(parseList(user.permissions));
  const list = await roles();
  const r = user.role_id ? list.find((x) => x.id === Number(user.role_id)) : list.find((x) => x.key === user.role);
  if (r) r.perms.forEach((k) => set.add(k));
  return set;
}
function can(user, ...keys) {
  if (!user) return false;
  if (user.role === 'super' || Number(user.is_super)) return true;
  const set = user.perms || new Set();
  return keys.flat().some((k) => set.has(k));
}
/** آیا کاربر «کارکنان منابع انسانی» است (مدیر یا کارشناس یا سطح دسترسی مشتق از آن‌ها)؟ */
function isHR(user) { return !!user && (user.role === 'super' || user.role === 'hr_manager' || user.role === 'hr_staff'); }
async function ensureDefaults() {
  const existing = new Set((await db.table('roles').all()).map((r) => r.key));
  const now = db.now(); let n = 0;
  for (let i = 0; i < DEFAULT_ROLES.length; i++) {
    const r = DEFAULT_ROLES[i];
    if (existing.has(r.key)) continue;
    await db.insert('roles', { key: r.key, title: r.title, description: r.description, base_role: r.base_role, color: r.color, permissions: JSON.stringify(r.permissions), is_system: 1, sort_order: i, created_at: now, updated_at: now });
    n++;
  }
  reload(); return n;
}
module.exports = { GROUPS, ALL, LABELS, DEFAULT_ROLES, roles, reload, permissionsOf, can, isHR, parseList, ensureDefaults };
