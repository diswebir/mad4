'use strict';
/** سرویس آزمون‌ها: ساخت آزمون پیش‌فرض MBTI، تخصیص، ثبت پاسخ و تولید گزارش */
const db = require('../../core/db');
const settings = require('../../core/settings');
const utils = require('../../core/utils');
const notify = require('../../core/notify');
const mbti = require('./mbti');

async function ensureDefaults(log) {
  let test = await db.table('assessments').where('key', 'mbti').first();
  const now = db.now();
  if (!test) {
    const id = await db.insert('assessments', { key: 'mbti', title: 'آزمون شخصیت‌شناسی MBTI', description: 'شناخت ترجیح‌های شخصیتی در چهار بُعد (۲۸ سؤال، حدود ۱۰ دقیقه)', instructions: mbti.INSTRUCTIONS, type: 'mbti', time_limit_min: 0, shuffle: 0, auto_assign: 1, show_to_applicant: 0, enabled: 1, is_system: 1, version: 1, sort_order: 10, created_at: now, updated_at: now });
    test = await db.findById('assessments', id);
    if (log) log('آزمون MBTI ساخته شد');
  }
  const n = await db.table('assessment_questions').where('assessment_id', test.id).count();
  if (!n) {
    await db.insertMany('assessment_questions', mbti.QUESTIONS.map((q) => ({ assessment_id: test.id, number: q.number, text: q.text, dimension: q.dimension, options: JSON.stringify(q.options), enabled: 1, sort_order: q.number * 10, created_at: now, updated_at: now })));
    if (log) log(`${mbti.QUESTIONS.length} سؤال MBTI ثبت شد`);
  }
}

/** سؤال‌های یک آزمون از DB در قالب موتور امتیازدهی */
async function questionsOf(assessmentId, includeDisabled) {
  const q = db.table('assessment_questions').where('assessment_id', assessmentId);
  if (!includeDisabled) q.where('enabled', 1);
  const rows = await q.orderBy('sort_order').orderBy('number').all();
  return rows.map((r) => ({ id: r.id, number: r.number, text: r.text, dimension: r.dimension, enabled: Number(r.enabled), options: utils.parseJSON(r.options, []) }));
}

async function attemptsOf(applicationId) {
  const rows = await db.table('assessment_attempts as a').select('a.*', 't.title', 't.type', 't.key as test_key', 't.time_limit_min').join('assessments as t', 'a.assessment_id', 't.id').where('a.application_id', applicationId).orderBy('a.id', 'desc').all();
  return rows;
}

async function assign(app, assessmentId, byUserId, opts) {
  opts = opts || {};
  const test = await db.findById('assessments', assessmentId);
  if (!test || !test.enabled) return null;
  const existing = await db.table('assessment_attempts').where('application_id', app.id).where('assessment_id', test.id).whereIn('status', ['assigned', 'in_progress', 'completed']).first();
  if (existing) return existing;
  const now = db.now();
  const id = await db.insert('assessment_attempts', { assessment_id: test.id, application_id: app.id, user_id: app.user_id, status: 'assigned', answers: null, result: null, result_type: null, assigned_by: byUserId || null, created_at: now, updated_at: now });
  if (app.user_id && !opts.silent) await notify.push(app.user_id, { title: 'آزمون جدید برای شما', body: `لطفاً «${test.title}» را در پنل خود تکمیل کنید.`, link: '/assessments/take/' + id, type: 'info' });
  if (opts.sms && app.mobile) await notify.smsTemplate(app.mobile, 'sms_template_test', { name: [app.first_name, app.last_name].filter(Boolean).join(' ') || 'متقاضی', test: test.title }, { userId: app.user_id });
  return db.findById('assessment_attempts', id);
}

/** تخصیص خودکار پس از ارسال فرم */
async function autoAssign(app, user) {
  if (!settings.getBool('assessment_auto_assign', true)) return [];
  const pos = app.position_id ? await db.findById('job_positions', app.position_id) : null;
  if (pos && !Number(pos.require_test)) return [];
  const tests = await db.table('assessments').where('enabled', 1).where('auto_assign', 1).orderBy('sort_order').all();
  const out = [];
  for (const t of tests) { const a = await assign(app, t.id, null, { silent: true }); if (a) out.push(a); }
  if (out.length && app.user_id) await notify.push(app.user_id, { title: 'آزمون‌های شما آماده است', body: 'برای تکمیل فرایند استخدام، آزمون(های) تعیین‌شده را انجام دهید.', link: '/portal', type: 'info' });
  return out;
}

/** ثبت پاسخ‌ها (کامل یا ناقص) */
async function saveAnswers(attempt, answers, finalize) {
  const test = await db.findById('assessments', attempt.assessment_id);
  const qs = await questionsOf(test.id);
  const clean = {};
  for (const q of qs) { const k = answers[q.number]; if (q.options.some((o) => o.key === k)) clean[q.number] = k; }
  const upd = { answers: JSON.stringify(clean), updated_at: db.now() };
  if (!attempt.started_at) upd.started_at = db.now();
  if (attempt.status === 'assigned') upd.status = 'in_progress';
  const missing = qs.filter((q) => !clean[q.number]).map((q) => q.number);
  if (finalize) {
    if (missing.length) return { ok: false, missing };
    const result = test.type === 'mbti' ? mbti.score(clean, qs) : { type: null, answered: Object.keys(clean).length };
    upd.result = JSON.stringify(result); upd.result_type = result.type || null; upd.status = 'completed'; upd.completed_at = db.now();
    const started = attempt.started_at || upd.started_at;
    upd.duration_sec = Math.max(0, Math.round((new Date(upd.completed_at.replace(' ', 'T') + 'Z') - new Date(String(started).replace(' ', 'T') + 'Z')) / 1000));
  }
  await db.update('assessment_attempts', upd, { id: attempt.id });
  if (finalize) {
    const app = await db.findById('applications', attempt.application_id);
    if (app) {
      await db.update('applications', { last_activity_at: db.now(), updated_at: db.now() }, { id: app.id });
      if (settings.getBool('recruitment_notify_hr_inapp')) await notify.pushPermission('assessments.view', { title: 'آزمون تکمیل شد', body: `${[app.first_name, app.last_name].filter(Boolean).join(' ') || app.tracking_code} — ${test.title}${upd.result_type ? ' (' + upd.result_type + ')' : ''}`, link: '/recruitment/applications/' + app.id + '?tab=tests', type: 'success' });
      // اگر همهٔ آزمون‌ها تکمیل شد و پرونده در مرحلهٔ آزمون است، به بررسی برمی‌گردد
      const pending = await db.table('assessment_attempts').where('application_id', app.id).whereIn('status', ['assigned', 'in_progress']).count();
      if (!pending && app.status === 'test') { try { await require('../recruitment/service').setStatus(app, 'screening', null, { note: 'تکمیل آزمون‌ها', notifyApplicant: false }); } catch (e) { /* ignore */ } }
    }
  }
  return { ok: true, missing };
}

/** گزارش کامل یک تلاش تکمیل‌شده */
function report(attempt, app) {
  const result = utils.parseJSON(attempt.result, null);
  if (!result || !result.type) return null;
  return mbti.report(result, { preferredTypes: app ? app.preferred_types : null });
}

async function stats() {
  const total = await db.count('assessment_attempts');
  const completed = await db.count('assessment_attempts', { status: 'completed' });
  const pending = total - completed;
  const types = {}; (await db.table('assessment_attempts').select('result_type', 'COUNT(*) AS c').where('status', 'completed').whereNotNull('result_type').groupBy('result_type').all()).forEach((r) => (types[r.result_type] = r.c));
  return { total, completed, pending, types };
}

module.exports = { ensureDefaults, questionsOf, attemptsOf, assign, autoAssign, saveAnswers, report, stats };
