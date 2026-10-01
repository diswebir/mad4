'use strict';
/** کمکی‌های مشترک ماژول‌های پرونده‌ای (انضباط، سلامت، مشاوره، مالی…) */
const db = require('./db');

/** شناسهٔ کلاس‌های یک معلم (تدریس + سرپرستی) */
async function teacherClassIds(userId) {
  const t = await db.table('teachers').where('user_id', userId).first();
  if (!t) return [];
  const a = await db.table('class_subjects').where('teacher_id', t.id).pluck('class_id');
  const b = await db.table('classes').where('teacher_id', t.id).pluck('id');
  return [...new Set(a.concat(b))];
}
/** گزینه‌های انتخاب دانش‌آموز (محدود به کلاس‌های معلم) */
async function studentOptions(req, opts) {
  opts = opts || {};
  const q = db.table('students as s').leftJoin('classes as c', 'c.id', 's.class_id').select('s.id', 's.first_name', 's.last_name', 's.student_number', 'c.title as class_title').orderBy('c.title').orderBy('s.last_name');
  if (opts.activeOnly !== false) q.where('s.status', 'active');
  if (req && req.user && req.user.role === 'teacher') q.whereIn('s.class_id', await teacherClassIds(req.user.id));
  if (opts.classId) q.where('s.class_id', opts.classId);
  return (await q.all()).map((s) => ({ value: s.id, label: `${s.first_name} ${s.last_name}${s.class_title ? ' — ' + s.class_title : ''}` }));
}
async function classOptions(req) {
  const q = db.table('classes').where('is_active', 1).orderBy('title');
  if (req && req.user && req.user.role === 'teacher') q.whereIn('id', await teacherClassIds(req.user.id));
  return (await q.all()).map((c) => ({ value: c.id, label: c.title }));
}
async function staffOptions() {
  return (await db.table('users').select('id', 'name', 'role').whereIn('role', ['admin', 'staff', 'teacher']).where('status', 'active').orderBy('role').orderBy('name').all()).map((u) => ({ value: u.id, label: u.name }));
}
async function studentOf(req) { return req.user.role === 'student' ? db.table('students').where('user_id', req.user.id).first() : null; }
module.exports = { teacherClassIds, studentOptions, classOptions, staffOptions, studentOf };
