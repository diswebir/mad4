'use strict';
/**
 * مجوز دسترسی به فایل‌های بارگذاری‌شده (/files/*) بر اساس «رکورد» صاحب فایل
 *  - هر پوشهٔ آپلود به جدول مربوطه نگاشت می‌شود و دسترسی طبق نقش/مالکیت/کلاس بررسی می‌گردد.
 *  - مدیر همه‌چیز را می‌بیند؛ کارمند بر اساس مجوزهایش؛ معلم فقط کلاس‌های خودش؛ دانش‌آموز/ولی فقط پروندهٔ خودش/فرزندش.
 *  - فایل‌هایی که به هیچ رکوردی وصل نیستند (یتیم) فقط برای مدیر قابل دسترسی‌اند.
 */
const db = require('./db');
const settings = require('./settings');
const people = require('./people');

const isStaffLike = (u) => u.role === 'admin' || u.role === 'staff';
const can = (req, ...keys) => (req.can ? req.can(...keys) : req.user.role === 'admin');

async function teacherOf(req) {
  if (req.user.role !== 'teacher') return null;
  if (!req._teacherRow) req._teacherRow = (await db.table('teachers').where('user_id', req.user.id).first()) || false;
  return req._teacherRow || null;
}
async function teacherClasses(req) {
  if (!req._teacherClassIds) req._teacherClassIds = await people.teacherClassIds(req.user.id);
  return req._teacherClassIds;
}
async function myStudentIds(req) {
  if (req.user.role === 'student') { const s = await db.table('students').where('user_id', req.user.id).first(); return s ? [s.id] : []; }
  if (req.user.role === 'parent') return (await people.childrenOf(req.user.id)).map((k) => k.id);
  return [];
}
async function myClassIds(req) {
  const ids = await myStudentIds(req);
  if (!ids.length) return [];
  return db.table('students').whereIn('id', ids).pluck('class_id');
}

/** دسترسی به پروندهٔ یک دانش‌آموز */
async function canSeeStudent(req, student, opts) {
  opts = opts || {};
  const u = req.user;
  if (!student) return u.role === 'admin';
  if (u.role === 'admin') return true;
  if (u.role === 'staff') return can(req, 'students.view', 'students.manage', ...(opts.extraPerms || []));
  if (u.role === 'teacher') {
    if (opts.photo) return true; // عکس پروفایل در فهرست‌ها/حضور و غیاب/کارت‌ها برای همهٔ معلمان نمایش داده می‌شود
    return student.class_id ? (await teacherClasses(req)).includes(student.class_id) : false;
  }
  if (u.role === 'student' || u.role === 'parent') return (await myStudentIds(req)).includes(student.id);
  return false;
}

const RULES = {
  async branding(req) { return true; }, // لوگو/امضا/مهر: برای کاربران واردشده (لوگو حتی بدون ورود — در app.js)
  async students(req, rel, parts) {
    if (parts[1] === 'docs') {
      const doc = await db.table('student_documents').where('file_path', rel).first();
      if (!doc) return req.user.role === 'admin';
      return canSeeStudent(req, await db.findById('students', doc.student_id));
    }
    const s = await db.table('students').where('photo', rel).first();
    if (!s) {
      // عکس قدیمی که فقط در users.avatar مانده
      const owner = await db.table('users').where('avatar', rel).first();
      if (owner && owner.id === req.user.id) return true;
      return isStaffLike(req.user) || req.user.role === 'teacher';
    }
    return canSeeStudent(req, s, { photo: true });
  },
  async teachers(req, rel) {
    const doc = await db.table('teacher_documents').where('file_path', rel).first();
    if (!doc) return req.user.role === 'admin';
    if (req.user.role === 'admin') return true;
    if (req.user.role === 'staff') return can(req, 'teachers.view', 'teachers.manage', 'hr.view_all', 'hr.manage');
    const t = await teacherOf(req); return !!(t && t.id === doc.teacher_id);
  },
  async homework(req, rel, parts) {
    const u = req.user;
    if (parts[1] === 'submissions') {
      const sub = await db.table('homework_submissions as hs').join('homework as h', 'h.id', 'hs.homework_id').select('hs.student_id', 'h.class_id', 'h.created_by', 'h.class_subject_id').where('hs.file_path', rel).first();
      if (!sub) return u.role === 'admin';
      if (u.role === 'admin') return true;
      if (u.role === 'staff') return can(req, 'homework.view_all');
      if (u.role === 'teacher') return sub.created_by === u.id || (await teacherClasses(req)).includes(sub.class_id);
      return (await myStudentIds(req)).includes(sub.student_id);
    }
    const hw = await db.table('homework').where('file_path', rel).first();
    if (!hw) return u.role === 'admin';
    if (u.role === 'admin') return true;
    if (u.role === 'staff') return can(req, 'homework.view_all');
    if (u.role === 'teacher') return hw.created_by === u.id || (await teacherClasses(req)).includes(hw.class_id);
    return (await myClassIds(req)).includes(hw.class_id);
  },
  async materials(req, rel) {
    const u = req.user;
    const m = await db.table('materials').where('file_path', rel).first();
    if (!m) return u.role === 'admin';
    if (isStaffLike(u) || u.role === 'teacher') return true; // منابع آموزشی بین همکاران مشترک است
    if (!m.class_id) return true; // منبع عمومی
    return (await myClassIds(req)).includes(m.class_id);
  },
  async tickets(req, rel) {
    const u = req.user;
    const r = await db.table('ticket_replies as r').join('tickets as t', 't.id', 'r.ticket_id').select('t.created_by', 't.assigned_to', 't.student_id', 't.department', 't.class_id', 'r.user_id').where('r.file_path', rel).first();
    if (!r) return u.role === 'admin';
    if (u.role === 'admin') return true;
    if (r.created_by === u.id || r.assigned_to === u.id || r.user_id === u.id) return true;
    if (u.role === 'staff') return can(req, 'tickets.manage', 'tickets.assign');
    if (u.role === 'teacher') return r.class_id ? (await teacherClasses(req)).includes(r.class_id) : false;
    if (r.student_id) return (await myStudentIds(req)).includes(r.student_id);
    return false;
  },
  async excuses(req, rel) {
    const u = req.user;
    const e = await db.table('absence_excuses').where('file_path', rel).first();
    if (!e) return u.role === 'admin';
    if (u.role === 'admin') return true;
    if (u.role === 'staff') return can(req, 'attendance.excuses', 'attendance.view_all', 'attendance.manage_all');
    if (u.role === 'teacher') { const s = await db.findById('students', e.student_id); return !!(s && s.class_id && (await teacherClasses(req)).includes(s.class_id)); }
    return (await myStudentIds(req)).includes(e.student_id);
  },
  async applications(req) { return req.user.role === 'admin' || (req.user.role === 'staff' && can(req, 'admissions.manage')); },
  async imports(req) { return req.user.role === 'admin'; },
  async restore(req) { return req.user.role === 'admin'; },
  async backups(req) { return req.user.role === 'admin'; }
};

/** آیا فایل عمومی است؟ (لوگوی مدرسه در صفحات ورود/پیش‌ثبت‌نام) */
function isPublic(rel) { return !!rel && rel === settings.get('school_logo'); }

/** تصمیم نهایی برای کاربر واردشده */
async function canAccess(req, rel) {
  if (!req.user) return isPublic(rel);
  if (req.user.role === 'admin') return true;
  const parts = String(rel).split('/');
  const rule = RULES[parts[0]];
  if (!rule) return false;
  try { return !!(await rule(req, rel, parts)); } catch (e) { return false; }
}

module.exports = { canAccess, canSeeStudent, isPublic, RULES };
