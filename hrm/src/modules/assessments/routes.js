'use strict';
/** آزمون‌ها: پنل HR (/assessments) + انجام آزمون توسط متقاضی (/assessments/take/:id) */
const path = require('path');
const express = require('express');
const db = require('../../core/db');
const auth = require('../../core/auth');
const settings = require('../../core/settings');
const utils = require('../../core/utils');
const J = require('../../core/jalali');
const activity = require('../../core/activity');
const service = require('./service');
const mbti = require('./mbti');

const router = express.Router();
const v = (n) => path.join(__dirname, 'views', n + '.ejs');

// ====================== انجام آزمون (متقاضی) ======================
async function loadAttempt(req, res) {
  const a = await db.table('assessment_attempts as a').select('a.*', 't.title', 't.description', 't.instructions', 't.type', 't.time_limit_min', 't.shuffle', 't.show_to_applicant').join('assessments as t', 'a.assessment_id', 't.id').where('a.id', parseInt(req.params.id, 10) || 0).first();
  if (!a) { res.status(404).render('errors/404', { title: 'آزمون یافت نشد' }); return null; }
  if (a.user_id !== req.user.id && req.user.role === 'applicant') { res.status(403).render('errors/403', { title: 'دسترسی غیرمجاز' }); return null; }
  return a;
}
router.get('/take/:id', auth.requireAuth, async (req, res) => {
  const a = await loadAttempt(req, res); if (!a) return;
  res.locals.layout = 'layouts/public';
  if (a.status === 'completed') return res.render(v('take-done'), { title: a.title, attempt: a, showResult: Number(a.show_to_applicant), result: Number(a.show_to_applicant) ? utils.parseJSON(a.result, null) : null, types: mbti.TYPES });
  let qs = await service.questionsOf(a.assessment_id);
  if (Number(a.shuffle)) { const seed = a.id; qs = qs.map((q, i) => ({ q, k: ((i + 1) * 9301 + seed * 49297) % 233280 })).sort((x, y) => x.k - y.k).map((x) => x.q); }
  const answers = utils.parseJSON(a.answers, {}) || {};
  const started = req.query.start === '1' || a.status === 'in_progress';
  if (started && a.status === 'assigned') await db.update('assessment_attempts', { status: 'in_progress', started_at: db.now(), updated_at: db.now() }, { id: a.id });
  const remaining = a.time_limit_min && a.started_at ? Math.max(0, a.time_limit_min * 60 - Math.round((Date.now() - new Date(String(a.started_at).replace(' ', 'T') + 'Z')) / 1000)) : null;
  res.render(v('take'), { title: a.title, attempt: a, qs, answers, started, remaining, narrow: false });
});
router.post('/take/:id', auth.requireAuth, async (req, res) => {
  const a = await loadAttempt(req, res); if (!a) return;
  if (a.status === 'completed') return res.redirect('/assessments/take/' + a.id);
  const answers = {};
  for (const k of Object.keys(req.body)) { const m = /^q(\d+)$/.exec(k); if (m) answers[m[1]] = String(req.body[k]); }
  const finalize = req.body._action !== 'draft';
  const r = await service.saveAnswers(a, answers, finalize);
  if (!r.ok) { req.flash('warning', `لطفاً به همهٔ سؤال‌ها پاسخ دهید (${J.toPersianDigits(r.missing.length)} سؤال بی‌پاسخ: ${r.missing.slice(0, 8).map((n) => J.toPersianDigits(n)).join('، ')}${r.missing.length > 8 ? '…' : ''}).`); return res.redirect('/assessments/take/' + a.id + '#q' + r.missing[0]); }
  if (!finalize) { req.flash('success', 'پاسخ‌ها ذخیره شد؛ هر زمان می‌توانید ادامه دهید.'); return res.redirect('/assessments/take/' + a.id); }
  await activity.log(req, 'create', 'assessment_attempt', a.id, 'تکمیل آزمون ' + a.title);
  req.flash('success', 'آزمون با موفقیت ثبت شد. سپاس از وقتی که گذاشتید.');
  res.redirect('/assessments/take/' + a.id);
});

// ====================== پنل HR ======================
router.use(auth.requireAuth, (req, res, next) => (req.user.role === 'applicant' ? res.redirect('/portal') : next()));

router.get('/', auth.requirePermission('assessments.view'), async (req, res) => {
  const tests = await db.table('assessments').orderBy('sort_order').all();
  for (const t of tests) { t.questions = await db.table('assessment_questions').where('assessment_id', t.id).where('enabled', 1).count(); t.attempts = await db.count('assessment_attempts', { assessment_id: t.id }); t.completed = await db.count('assessment_attempts', { assessment_id: t.id, status: 'completed' }); }
  const st = await service.stats();
  const recent = await db.table('assessment_attempts as a').select('a.*', 'p.first_name', 'p.last_name', 'p.tracking_code', 't.title').join('applications as p', 'a.application_id', 'p.id').join('assessments as t', 'a.assessment_id', 't.id').where('a.status', 'completed').orderBy('a.completed_at', 'desc').limit(8).all();
  res.render(v('index'), { title: 'آزمون‌ها و تحلیل', tests, st, recent, mbti });
});

router.get('/attempts', auth.requirePermission('assessments.view'), async (req, res) => {
  const q = db.table('assessment_attempts as a').select('a.*', 'p.first_name', 'p.last_name', 'p.tracking_code', 'p.status as app_status', 'pos.title as position_title', 't.title').join('applications as p', 'a.application_id', 'p.id').join('assessments as t', 'a.assessment_id', 't.id').leftJoin('job_positions as pos', 'p.position_id', 'pos.id');
  if (req.query.q) q.search(utils.normalizePersian(req.query.q), ['p.first_name', 'p.last_name', 'p.tracking_code', 'a.result_type']);
  if (req.query.status) q.where('a.status', req.query.status);
  if (req.query.type) q.where('a.result_type', String(req.query.type).toUpperCase());
  if (req.query.test) q.where('a.assessment_id', parseInt(req.query.test, 10) || 0);
  q.orderBy('a.id', 'desc');
  const result = await q.paginate(req.query.page, settings.getInt('items_per_page', 20));
  res.render(v('attempts'), { title: 'نتایج آزمون‌ها', result, query: req.query, tests: await db.table('assessments').orderBy('sort_order').all(), mbti });
});

router.get('/attempts/:id', auth.requirePermission('assessments.view'), async (req, res) => {
  const a = await db.table('assessment_attempts as a').select('a.*', 't.title', 't.type').join('assessments as t', 'a.assessment_id', 't.id').where('a.id', parseInt(req.params.id, 10) || 0).first();
  if (!a) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const app = await db.table('applications as p').select('p.*', 'pos.title as position_title', 'pos.preferred_types').leftJoin('job_positions as pos', 'p.position_id', 'pos.id').where('p.id', a.application_id).first();
  const rep = service.report(a, app);
  const qs = await service.questionsOf(a.assessment_id, true);
  const answers = utils.parseJSON(a.answers, {}) || {};
  const print = req.query.print === '1';
  res.render(v('result'), { layout: print ? 'layouts/print' : 'layouts/main', title: 'نتیجهٔ آزمون ' + (app ? [app.first_name, app.last_name].filter(Boolean).join(' ') : ''), attempt: a, app, rep, qs, answers, mbti, print });
});

router.post('/attempts/:id/reset', auth.requirePermission('assessments.assign'), async (req, res) => {
  const a = await db.findById('assessment_attempts', req.params.id);
  if (a) { await db.update('assessment_attempts', { status: 'assigned', answers: null, result: null, result_type: null, started_at: null, completed_at: null, duration_sec: null, updated_at: db.now() }, { id: a.id }); await activity.log(req, 'update', 'assessment_attempt', a.id, 'بازنشانی آزمون برای انجام مجدد'); req.flash('success', 'آزمون بازنشانی شد؛ متقاضی می‌تواند دوباره انجام دهد.'); }
  res.redirect(req.get('referer') || '/assessments/attempts');
});
router.post('/attempts/:id/delete', auth.requirePermission('assessments.assign'), async (req, res) => {
  const a = await db.findById('assessment_attempts', req.params.id);
  if (a) { await db.remove('assessment_attempts', { id: a.id }); req.flash('success', 'حذف شد.'); }
  res.redirect(req.get('referer') || '/assessments/attempts');
});
router.post('/assign', auth.requirePermission('assessments.assign'), async (req, res) => {
  const app = await db.findById('applications', req.body.application_id);
  if (!app) return res.redirect('/recruitment/applications');
  const a = await service.assign(app, parseInt(req.body.assessment_id, 10), req.user.id, { sms: req.body.sms === '1' });
  if (a) { if (['submitted', 'screening'].includes(app.status) && req.body.move === '1') await require('../recruitment/service').setStatus(app, 'test', req.user, { note: 'تخصیص آزمون', notifyApplicant: false }); await activity.log(req, 'create', 'assessment_attempt', a.id, 'تخصیص آزمون به ' + app.tracking_code); req.flash('success', 'آزمون به متقاضی تخصیص یافت.'); }
  else req.flash('danger', 'آزمون یافت نشد یا غیرفعال است.');
  res.redirect('/recruitment/applications/' + app.id + '?tab=tests');
});

router.get('/types', auth.requirePermission('assessments.view'), (req, res) => {
  res.render(v('types'), { title: 'راهنمای ۱۶ تیپ شخصیتی', mbti, focus: String(req.query.t || '').toUpperCase() });
});

// ---------- مدیریت آزمون و سؤال‌ها ----------
router.get('/:id', auth.requirePermission('assessments.manage'), async (req, res) => {
  const t = await db.findById('assessments', req.params.id); if (!t) return res.redirect('/assessments');
  const qs = await service.questionsOf(t.id, true);
  res.render(v('edit'), { title: 'ویرایش آزمون', test: t, qs, mbti });
});
router.post('/:id', auth.requirePermission('assessments.manage'), async (req, res) => {
  const t = await db.findById('assessments', req.params.id); if (!t) return res.redirect('/assessments');
  await db.update('assessments', { title: utils.normalizePersian(req.body.title) || t.title, description: utils.normalizePersian(req.body.description) || null, instructions: utils.normalizePersian(req.body.instructions) || null, time_limit_min: Math.max(0, parseInt(req.body.time_limit_min, 10) || 0), shuffle: req.body.shuffle === '1' ? 1 : 0, auto_assign: req.body.auto_assign === '1' ? 1 : 0, show_to_applicant: req.body.show_to_applicant === '1' ? 1 : 0, enabled: req.body.enabled === '1' ? 1 : 0, updated_at: db.now() }, { id: t.id });
  await activity.log(req, 'update', 'assessment', t.id, 'ویرایش تنظیمات آزمون ' + t.title);
  req.flash('success', 'تنظیمات آزمون ذخیره شد.');
  res.redirect('/assessments/' + t.id);
});
router.post('/:id/questions/:qid', auth.requirePermission('assessments.manage'), async (req, res) => {
  const q = await db.findById('assessment_questions', req.params.qid); if (!q || q.assessment_id !== parseInt(req.params.id, 10)) return res.redirect('/assessments/' + req.params.id);
  if (req.body._action === 'toggle') { await db.update('assessment_questions', { enabled: q.enabled ? 0 : 1, updated_at: db.now() }, { id: q.id }); }
  else {
    const opts = utils.parseJSON(q.options, []);
    const na = utils.normalizePersian(req.body.option_a), nb = utils.normalizePersian(req.body.option_b);
    if (opts[0] && na) opts[0].text = na; if (opts[1] && nb) opts[1].text = nb;
    // امکان جابه‌جایی قطب‌ها توسط HR (اختیاری)
    if (opts[0] && /^[EISNTFJP]$/.test(req.body.pole_a || '')) opts[0].pole = req.body.pole_a;
    if (opts[1] && /^[EISNTFJP]$/.test(req.body.pole_b || '')) opts[1].pole = req.body.pole_b;
    await db.update('assessment_questions', { text: utils.normalizePersian(req.body.text) || q.text, options: JSON.stringify(opts), dimension: mbti.POLE_DIM[opts[0] && opts[0].pole] || q.dimension, updated_at: db.now() }, { id: q.id });
  }
  req.flash('success', 'سؤال ذخیره شد.');
  res.redirect('/assessments/' + req.params.id + '#q' + q.id);
});
router.post('/:id/questions-reset', auth.requirePermission('assessments.manage'), async (req, res) => {
  const t = await db.findById('assessments', req.params.id); if (!t || t.key !== 'mbti') return res.redirect('/assessments');
  await db.table('assessment_questions').where('assessment_id', t.id).delete();
  await service.ensureDefaults();
  await activity.log(req, 'update', 'assessment', t.id, 'بازنشانی سؤال‌های MBTI به نسخهٔ رسمی');
  req.flash('success', 'سؤال‌ها به نسخهٔ رسمی شرکت بازگشت.');
  res.redirect('/assessments/' + t.id);
});

module.exports = router;
