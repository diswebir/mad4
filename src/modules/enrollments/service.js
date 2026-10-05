'use strict';
/** سوابق تحصیلی (enrollments): یک ردیف برای هر دانش‌آموز در هر سال تحصیلی. */
const db = require('../../core/db');
const modules = require('../../core/modules');
const J = require('../../core/jalali');

const STATUS = { active: 'در حال تحصیل', promoted: 'ارتقا یافته', retained: 'مردود/تکرار پایه', graduated: 'فارغ‌التحصیل', transferred: 'انتقالی', dropped: 'ترک تحصیل' };
const COLORS = { active: 'primary', promoted: 'success', retained: 'warning', graduated: 'info', transferred: 'secondary', dropped: 'danger' };

async function currentYear() { return db.table('academic_years').where('is_current', 1).first(); }
async function classInfo(classId) {
  if (!classId) return null;
  return db.table('classes as c').leftJoin('grade_levels as g', 'g.id', 'c.grade_level_id').select('c.id', 'c.title', 'c.grade_level_id', 'c.academic_year_id', 'g.title as grade_title').where('c.id', classId).first();
}
/** تضمین وجود ردیف فعال برای دانش‌آموز در سال جاری (هنگام ثبت‌نام/تغییر کلاس). */
async function ensureActive(studentId, classId, opts = {}) {
  if (!modules.isEnabled('enrollments')) return null;
  const year = opts.year || (await currentYear());
  if (!year) return null;
  const cls = await classInfo(classId);
  const row = await db.table('enrollments').where({ student_id: studentId, academic_year_id: year.id }).first();
  const now = db.now();
  if (row) {
    const patch = { updated_at: now };
    if (cls) Object.assign(patch, { class_id: cls.id, class_title: cls.title, grade_level_id: cls.grade_level_id, grade_title: cls.grade_title });
    if (row.status !== 'active' && opts.reactivate) Object.assign(patch, { status: 'active', left_at: null });
    await db.update('enrollments', patch, { id: row.id });
    return row.id;
  }
  return db.insert('enrollments', {
    student_id: studentId, academic_year_id: year.id, class_id: cls ? cls.id : null, class_title: cls ? cls.title : null, grade_level_id: cls ? cls.grade_level_id : null, grade_title: cls ? cls.grade_title : null,
    status: 'active', enrolled_at: opts.startDate || J.todayISO(), left_at: null, note: opts.note || null, created_at: now, updated_at: now,
  });
}
/** بستن ردیف فعال با وضعیت نهایی (انتقالی/ترک تحصیل/فارغ‌التحصیل…). */
async function close(studentId, status, opts = {}) {
  if (!modules.isEnabled('enrollments') || !STATUS[status]) return 0;
  const year = opts.year || (await currentYear());
  if (!year) return 0;
  const row = await db.table('enrollments').where({ student_id: studentId, academic_year_id: year.id }).first();
  if (!row) return 0;
  return db.update('enrollments', { status, left_at: opts.endDate || J.todayISO(), note: opts.note || row.note, updated_at: db.now() }, { id: row.id });
}
/** واکنش به تغییر وضعیت تحصیلی دانش‌آموز. */
async function onStatusChange(studentId, newStatus, opts = {}) {
  const map = { active: null, graduated: 'graduated', transferred: 'transferred', dropped: 'dropped', suspended: null };
  if (newStatus === 'active') { const s = await db.findById('students', studentId); return ensureActive(studentId, s && s.class_id, Object.assign({ reactivate: true }, opts)); }
  if (map[newStatus]) return close(studentId, map[newStatus], opts);
  return 0;
}
async function history(studentId) {
  return db.table('enrollments as e').leftJoin('academic_years as y', 'y.id', 'e.academic_year_id')
    .select('e.*', 'y.title as year_title').where('e.student_id', studentId).orderBy('y.start_date', 'desc').orderBy('e.id', 'desc').all();
}
/** پر کردن سوابق برای دانش‌آموزان فعال بدون ردیف در سال جاری. */
async function backfill(userId) {
  const year = await currentYear(); if (!year) return 0;
  const students = await db.table('students').where('status', 'active').all();
  const have = new Set(await db.table('enrollments').where('academic_year_id', year.id).pluck('student_id'));
  let n = 0;
  for (const s of students) { if (have.has(s.id)) continue; await ensureActive(s.id, s.class_id, { year, userId, startDate: year.start_date, note: 'ثبت خودکار' }); n++; }
  return n;
}
module.exports = { STATUS, COLORS, ensureActive, close, onStatusChange, history, backfill, currentYear, classInfo };
