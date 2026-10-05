'use strict';
/** سرویس مشترک دانش‌آموزان: شماره‌گذاری خودکار و ساخت حساب کاربری (استفاده در ثبت‌نام، ورود گروهی و پذیرش پیش‌ثبت‌نام) */
const db = require('../../core/db');
const settings = require('../../core/settings');
const auth = require('../../core/auth');

async function nextStudentNumber() {
  const prefix = settings.get('student_number_prefix', '') || '';
  const start = settings.getInt('student_number_next', 1001) || 1001;
  const recent = await db.table('students').select('student_number').orderBy('id', 'desc').limit(50).all();
  let n = start;
  for (const r of recent) {
    const sn = String(r.student_number || '');
    if (prefix && !sn.startsWith(prefix)) continue;
    const num = parseInt(sn.slice(prefix.length), 10);
    if (!Number.isNaN(num) && num >= n) n = num + 1;
  }
  // اطمینان از یکتایی
  while (await db.exists('students', { student_number: prefix + n })) n++;
  await settings.set('student_number_next', String(n + 1));
  return prefix + n;
}

/** ساخت حساب کاربری دانش‌آموز (نام کاربری = شماره دانش‌آموزی) و بازگرداندن { userId, username, password } */
async function createUserFor(data, opts) {
  opts = opts || {};
  const username = String(data.student_number).toLowerCase();
  if (await db.exists('users', { username })) throw new Error('نام کاربری (شماره دانش‌آموزی) قبلاً استفاده شده است');
  const password = opts.password && opts.password.length >= 6 ? opts.password : (settings.get('student_default_password', '') || (data.national_id || '123456'));
  const userId = await db.insert('users', { username, password: await auth.hashPassword(password), role: 'student', name: `${data.first_name} ${data.last_name}`, phone: data.mobile || null, email: data.email || null, status: 'active', must_change_password: settings.get('force_password_change', '0') === '1' ? 1 : 0, created_at: db.now() });
  return { userId, username, password };
}
module.exports = { nextStudentNumber, createUserFor };
