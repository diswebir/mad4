'use strict';
/** سرویس پرونده‌های استخدام: ایجاد، تغییر وضعیت، اعلان‌ها، آمار */
const db = require('../../core/db');
const settings = require('../../core/settings');
const utils = require('../../core/utils');
const notify = require('../../core/notify');
const J = require('../../core/jalali');
const forms = require('./forms');

const STATUS = utils.APP_STATUS;
/** انتقال‌های مجاز وضعیت (برای HR) */
const TRANSITIONS = {
  draft: ['archived'],
  submitted: ['screening', 'test', 'interview', 'rejected', 'archived'],
  screening: ['test', 'interview', 'offer', 'rejected', 'archived'],
  test: ['screening', 'interview', 'offer', 'rejected', 'archived'],
  interview: ['screening', 'test', 'offer', 'hired', 'rejected', 'archived'],
  offer: ['hired', 'rejected', 'interview', 'archived'],
  hired: ['archived'],
  rejected: ['screening', 'archived'],
  withdrawn: ['screening', 'archived'],
  archived: ['screening']
};

async function trackingCode() {
  const prefix = settings.get('recruitment_tracking_prefix') || 'EM';
  for (let i = 0; i < 20; i++) {
    const code = prefix + '-' + J.toEnglishDigits(String(J.currentJalali().jy)).slice(2) + utils.randomDigits(5);
    if (!(await db.table('applications').where('tracking_code', code).exists())) return code;
  }
  return prefix + '-' + Date.now().toString(36).toUpperCase();
}

/** پروندهٔ جاری (پیش‌نویس یا فعال) متقاضی */
async function currentApplication(userId) {
  return db.table('applications').where('user_id', userId).whereNotIn('status', ['archived', 'withdrawn']).orderBy('id', 'desc').first();
}

async function createApplication(user, opts) {
  opts = opts || {};
  const now = db.now();
  const id = await db.insert('applications', {
    user_id: user.id, position_id: opts.positionId || null, invite_id: opts.inviteId || null, tracking_code: await trackingCode(), status: 'draft',
    mobile: user.mobile || null, data: JSON.stringify({ personal: { mobile: user.mobile || null } }), progress: '[]', current_step: 0, completion: 0, source: opts.source || 'web',
    last_activity_at: now, created_at: now, updated_at: now
  });
  return db.findById('applications', id);
}

function data(app) { return utils.parseJSON(app.data, {}) || {}; }

async function saveData(app, d, extra) {
  const prog = await forms.progress(d);
  const upd = Object.assign({ data: JSON.stringify(d), progress: JSON.stringify(prog.done), completion: prog.percent, last_activity_at: db.now(), updated_at: db.now() }, forms.denormalize(d), extra || {});
  await db.update('applications', upd, { id: app.id });
  return prog;
}

/** بررسی تکراری‌بودن (کد ملی / موبایل) در پرونده‌های دیگر */
async function duplicates(app, d) {
  const keys = settings.getList('recruitment_duplicate_check');
  const p = (d && d.personal) || {};
  const found = [];
  if (keys.includes('national_id') && p.national_id) {
    const rows = await db.table('applications').where('national_id', p.national_id).where('id', '!=', app.id).whereNotIn('status', ['draft']).all();
    rows.forEach((r) => found.push({ by: 'کد ملی', app: r }));
  }
  if (keys.includes('mobile') && (p.mobile || app.mobile)) {
    const rows = await db.table('applications').where('mobile', p.mobile || app.mobile).where('user_id', '!=', app.user_id).whereNotIn('status', ['draft']).all();
    rows.forEach((r) => found.push({ by: 'موبایل', app: r }));
  }
  return found;
}

async function addHistory(appId, from, to, userId, note) {
  await db.insert('application_history', { application_id: appId, from_status: from, to_status: to, user_id: userId || null, note: note ? String(note).slice(0, 250) : null, created_at: db.now() });
}

/** تغییر وضعیت پرونده + تاریخچه + اعلان/پیامک به متقاضی */
async function setStatus(app, to, actor, opts) {
  opts = opts || {};
  const from = app.status;
  if (from === to) return app;
  const upd = { status: to, updated_at: db.now(), last_activity_at: db.now() };
  if (to === 'hired') upd.hired_at = db.now();
  if (to === 'archived') upd.archived_at = db.now();
  if (['hired', 'rejected'].includes(to)) { upd.final_decision = to === 'hired' ? 'suitable' : 'rejected'; upd.decided_by = actor ? actor.id : null; upd.decided_at = db.now(); }
  await db.update('applications', upd, { id: app.id });
  await addHistory(app.id, from, to, actor ? actor.id : null, opts.note);
  const label = STATUS[to] ? STATUS[to][1] : to;
  if (opts.notifyApplicant !== false && !['draft', 'archived'].includes(to)) {
    const name = [app.first_name, app.last_name].filter(Boolean).join(' ') || 'متقاضی';
    if (app.user_id) await notify.push(app.user_id, { title: 'به‌روزرسانی وضعیت درخواست شما', body: `وضعیت درخواست شما به «${label}» تغییر کرد.${opts.message ? ' ' + opts.message : ''}`, link: '/portal', type: to === 'rejected' ? 'danger' : 'info' });
    if (opts.sms && app.mobile && settings.getBool('sms_notify_status')) await notify.smsTemplate(app.mobile, 'sms_template_status', { name, code: app.tracking_code, status: label }, { userId: app.user_id });
  }
  return Object.assign({}, app, upd);
}

/** ارسال نهایی توسط متقاضی */
async function submit(app, user) {
  const now = db.now();
  await db.update('applications', { status: 'submitted', submitted_at: now, updated_at: now, last_activity_at: now, completion: 100 }, { id: app.id });
  await addHistory(app.id, 'draft', 'submitted', user.id, 'ارسال توسط متقاضی');
  // تخصیص خودکار آزمون‌ها
  try { await require('../assessments/service').autoAssign(Object.assign({}, app, { status: 'submitted' }), user); } catch (e) { /* ماژول آزمون غیرفعال */ }
  const name = [app.first_name, app.last_name].filter(Boolean).join(' ') || 'متقاضی';
  if (settings.getBool('sms_notify_submitted') && app.mobile) await notify.smsTemplate(app.mobile, 'sms_template_submitted', { name, code: app.tracking_code }, { userId: user.id });
  if (settings.getBool('recruitment_notify_hr_inapp')) {
    const pos = app.position_id ? await db.findById('job_positions', app.position_id) : null;
    await notify.pushPermission('applicants.view', { title: 'درخواست استخدام جدید', body: `${name}${pos ? ' — ' + pos.title : ''} (${app.tracking_code})`, link: '/recruitment/applications/' + app.id, type: 'info' });
  }
  if (settings.getBool('sms_notify_hr_new')) { const mobiles = settings.getList('sms_hr_mobiles'); if (mobiles.length) await notify.sms(mobiles, `درخواست استخدام جدید: ${name} (${app.tracking_code})`, { kind: 'hr_new' }); }
}

/** آمار خلاصه برای داشبورد */
async function stats(days) {
  days = days || 30;
  const since = J.addDays(J.todayISO(), -days);
  const all = await db.table('applications').whereNotIn('status', ['draft']).all();
  const byStatus = {}; Object.keys(STATUS).forEach((k) => (byStatus[k] = 0));
  for (const a of all) byStatus[a.status] = (byStatus[a.status] || 0) + 1;
  const recent = all.filter((a) => a.submitted_at && a.submitted_at.slice(0, 10) >= since);
  const prevSince = J.addDays(since, -days);
  const prev = all.filter((a) => a.submitted_at && a.submitted_at.slice(0, 10) >= prevSince && a.submitted_at.slice(0, 10) < since);
  const perDay = {};
  for (const a of recent) { const d = a.submitted_at.slice(0, 10); perDay[d] = (perDay[d] || 0) + 1; }
  const positions = await db.table('job_positions').all();
  const perPosition = positions.map((p) => ({ id: p.id, title: p.title, status: p.status, count: all.filter((a) => a.position_id === p.id).length, recent: recent.filter((a) => a.position_id === p.id).length })).sort((a, b) => b.count - a.count);
  const drafts = await db.count('applications', { status: 'draft' });
  return { total: all.length, byStatus, recent: recent.length, prev: prev.length, perDay, perPosition, drafts, openPositions: positions.filter((p) => p.status === 'open').length, pending: byStatus.submitted + byStatus.screening, active: all.filter((a) => !['hired', 'rejected', 'withdrawn', 'archived'].includes(a.status)).length };
}

module.exports = { STATUS, TRANSITIONS, trackingCode, currentApplication, createApplication, data, saveData, duplicates, addHistory, setStatus, submit, stats };
