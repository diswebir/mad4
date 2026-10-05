'use strict';
const db = require('../../core/db');
const auth = require('../../core/auth');
const settings = require('../../core/settings');
const utils = require('../../core/utils');
const people = require('../../core/people');
const notify = require('../../core/notify');
const J = require('../../core/jalali');

const childrenOf = people.childrenOf;

async function parentsOfStudent(studentId) {
  return db.table('student_parents as sp').join('parents as p', 'p.id', 'sp.parent_id').leftJoin('users as u', 'u.id', 'p.user_id')
    .select('p.*', 'sp.relation', 'sp.is_primary', 'u.username', 'u.status as user_status', 'u.last_login_at').where('sp.student_id', studentId).orderBy('sp.is_primary', 'desc').all();
}
function normPhone(p) { const d = J.toEnglishDigits(String(p || '')).replace(/\D/g, ''); return d.startsWith('98') && d.length === 12 ? '0' + d.slice(2) : d; }
async function uniqueUsername(base) {
  let u = base, i = 1;
  while (await db.table('users').where('username', u).exists()) u = `${base}_${++i}`;
  return u;
}
/**
 * ساخت یا پیوند حساب ولی برای دانش‌آموز. اگر ولی با همین شماره/کد ملی وجود داشته باشد (خواهر/برادر) همان حساب پیوند می‌خورد.
 * @returns {{parentId, userId, username, password|null, created:boolean, linked:boolean}}
 */
async function linkParent(studentId, input, opts = {}) {
  const phone = normPhone(input.phone);
  const nationalId = J.toEnglishDigits(String(input.national_id || '')).replace(/\D/g, '') || null;
  const relation = utils.RELATIONS[input.relation] ? input.relation : 'father';
  const name = utils.normalizePersian(String(input.name || '')).trim();
  if (!name) throw new Error('نام ولی الزامی است');
  if (!/^09\d{9}$/.test(phone)) throw new Error('شمارهٔ موبایل ولی معتبر نیست (۰۹xxxxxxxxx)');
  const now = db.now();
  let parent = null;
  if (nationalId) parent = await db.table('parents').where('national_id', nationalId).first();
  if (!parent) parent = await db.table('parents').where('phone', phone).first();
  let created = false, password = null, user = null;
  if (parent) {
    user = parent.user_id ? await db.findById('users', parent.user_id) : null;
  }
  if (!user) {
    const username = await uniqueUsername(phone);
    password = input.password && String(input.password).length >= 6 ? String(input.password) : (settings.get('parent_default_password', '') || '123456');
    const userId = await db.insert('users', { username, password: await auth.hashPassword(password), role: 'parent', name, phone, status: 'active', must_change_password: settings.getBool('parent_force_change_password', false) ? 1 : 0, created_at: now, updated_at: now });
    user = await db.findById('users', userId); created = true;
  }
  if (!parent) {
    const pid = await db.insert('parents', { user_id: user.id, name, national_id: nationalId, phone, relation, job: input.job || null, education: input.education || null, address: input.address || null, created_at: now, updated_at: now });
    parent = await db.findById('parents', pid);
  } else if (!parent.user_id) {
    await db.update('parents', { user_id: user.id, updated_at: now }, { id: parent.id });
  }
  let linked = false;
  if (!(await db.table('student_parents').where({ student_id: studentId, parent_id: parent.id }).exists())) {
    const hasPrimary = await db.table('student_parents').where({ student_id: studentId, is_primary: 1 }).exists();
    await db.insert('student_parents', { student_id: studentId, parent_id: parent.id, relation, is_primary: hasPrimary ? 0 : 1, created_at: now });
    linked = true;
  }
  if (opts.sendSms && created) {
    const schoolName = settings.get('school_name', 'مدرسه');
    await notify.sms(phone, `${schoolName}\nحساب کاربری اولیا برای شما ساخته شد.\nنام کاربری: ${user.username}\nرمز عبور: ${password}\nنشانی: ${settings.get('site_url', '') || ''}`.trim(), 'parent_credentials');
  }
  return { parentId: parent.id, userId: user.id, username: user.username, password, created, linked };
}
/** ساخت گروهی حساب برای همهٔ دانش‌آموزان فعال بدون ولی (بر اساس شمارهٔ پدر، سپس مادر). */
async function bulkCreate(opts = {}) {
  const students = await db.table('students').where('status', 'active').all();
  const have = new Set(await db.table('student_parents').pluck('student_id'));
  const report = { created: 0, linked: 0, skipped: 0, errors: [] };
  for (const s of students) {
    if (have.has(s.id)) { report.skipped++; continue; }
    const cand = [['father', s.father_name, s.father_phone, s.father_national_id], ['mother', s.mother_name, s.mother_phone, s.mother_national_id], ['guardian', s.guardian_name, s.guardian_phone, null]].find((c) => c[1] && /^09\d{9}$/.test(normPhone(c[2])));
    if (!cand) { report.skipped++; report.errors.push(`${s.first_name} ${s.last_name}: شمارهٔ موبایل معتبر برای ولی ثبت نشده`); continue; }
    try { const r = await linkParent(s.id, { relation: cand[0], name: cand[1], phone: cand[2], national_id: cand[3] }, opts); if (r.created) report.created++; else report.linked++; } catch (e) { report.errors.push(`${s.first_name} ${s.last_name}: ${e.message}`); }
  }
  return report;
}
async function parentPhonesOfStudent(studentId) {
  const rows = await db.table('student_parents as sp').join('parents as p', 'p.id', 'sp.parent_id').select('p.phone', 'p.user_id', 'sp.is_primary').where('sp.student_id', studentId).orderBy('sp.is_primary', 'desc').all();
  if (rows.length) return rows;
  const s = await db.findById('students', studentId);
  return s ? [{ phone: s.father_phone || s.mother_phone || s.guardian_phone || null, user_id: null, is_primary: 1 }].filter((r) => r.phone) : [];
}
module.exports = { childrenOf, parentsOfStudent, linkParent, bulkCreate, normPhone, parentPhonesOfStudent };
