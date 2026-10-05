'use strict';
const db = require('../../core/db');
const auth = require('../../core/auth');
const utils = require('../../core/utils');
const J = require('../../core/jalali');

/** ساخت پروندهٔ کارمند (و حساب کاربری کارمند) از پروندهٔ استخدام */
async function fromApplication(app, actor, opts) {
  opts = opts || {};
  const existing = await db.table('employees').where('application_id', app.id).first();
  if (existing) return existing;
  const d = utils.parseJSON(app.data, {}) || {};
  const p = d.personal || {};
  const now = db.now();
  // حساب کاربری کارمند: کاربر متقاضی به کارمند ارتقا می‌یابد (ورود با رمز)
  let userId = app.user_id;
  const user = userId ? await db.findById('users', userId) : null;
  let tempPassword = null;
  if (user && user.role === 'applicant') {
    tempPassword = utils.randomDigits(8);
    let username = (app.national_id || ('emp' + app.mobile)).toLowerCase();
    if (await db.table('users').where('username', username).where('id', '!=', user.id).exists()) username = username + '-' + utils.randomString(3).toLowerCase();
    await db.update('users', { role: 'employee', role_id: null, username, name: [app.first_name, app.last_name].filter(Boolean).join(' '), email: app.email || user.email, password: await auth.hashPassword(tempPassword), must_change_password: 1, updated_at: now }, { id: user.id });
  }
  const code = await nextCode();
  const id = await db.insert('employees', {
    user_id: userId || null, application_id: app.id, employee_code: code, first_name: app.first_name, last_name: app.last_name, national_id: app.national_id, mobile: app.mobile, email: app.email,
    department_id: opts.department_id || null, position_title: opts.position_title || null, hire_date: opts.hire_date || J.todayISO(), status: 'active', manager_id: null, birth_date: app.birth_date || null, photo: app.photo || null,
    data: JSON.stringify({ personal: p, education: d.education || [], work: d.work || [], tempPassword }), notes: null, created_at: now, updated_at: now
  });
  await db.update('applications', { employee_id: id, updated_at: now }, { id: app.id });
  return db.findById('employees', id);
}

async function nextCode() {
  const last = await db.table('employees').orderBy('id', 'desc').first();
  const n = last && /^\d+$/.test(last.employee_code || '') ? parseInt(last.employee_code, 10) + 1 : 1001;
  return String(n);
}

module.exports = { fromApplication, nextCode };
