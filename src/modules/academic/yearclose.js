'use strict';
/** مسیرهای «پایان سال تحصیلی و ارتقای پایه» — فقط مدیر */
const path = require('path');
const express = require('express');
const db = require('../../core/db');
const auth = require('../../core/auth');
const modules = require('../../core/modules');
const activity = require('../../core/activity');
const J = require('../../core/jalali');
const svc = require('./yearclose-service');

const router = express.Router();
const v = (n) => path.join(__dirname, 'views', n + '.ejs');
router.use(auth.requireAuth, auth.requireRole('admin'), modules.requireEnabled('academic.year_close'));

async function runsList() {
  return db.table('year_close_runs as r').leftJoin('academic_years as s', 's.id', 'r.source_year_id').leftJoin('academic_years as t', 't.id', 'r.target_year_id').leftJoin('users as u', 'u.id', 'r.created_by')
    .select('r.*', 's.title as source_title', 't.title as target_title', 'u.name as user_name').orderBy('r.id', 'desc').limit(10).all();
}
router.get('/', async (req, res) => {
  const ctx = await svc.context();
  if (!ctx) { req.flash('danger', 'ابتدا سال تحصیلی جاری را تعریف کنید.'); return res.redirect('/academic/years'); }
  const runs = await runsList();
  for (const r of runs) { try { r.summaryObj = JSON.parse(r.summary || '{}'); } catch (e) { r.summaryObj = {}; } }
  res.render(v('year-close'), { title: 'پایان سال تحصیلی و ارتقای پایه', ctx, runs, backupOn: modules.isEnabled('system.backup'), plan: null, form: {}, planErrors: [] });
});
router.post('/preview', async (req, res) => {
  const ctx = await svc.context();
  if (!ctx) return res.redirect('/academic/years');
  const plan = await svc.plan(req.body);
  if (plan.errors.length) {
    const runs = await runsList();
    for (const r of runs) { try { r.summaryObj = JSON.parse(r.summary || '{}'); } catch (e) { r.summaryObj = {}; } }
    return res.status(422).render(v('year-close'), { title: 'پایان سال تحصیلی و ارتقای پایه', ctx, runs, backupOn: modules.isEnabled('system.backup'), plan: null, form: req.body, planErrors: plan.errors });
  }
  req.session.yearClosePlan = plan;
  res.render(v('year-close-preview'), { title: 'پیش‌نمایش پایان سال', plan, ctx });
});
router.post('/execute', async (req, res) => {
  const plan = req.session.yearClosePlan;
  if (!plan) { req.flash('danger', 'نقشهٔ اجرا یافت نشد؛ دوباره پیش‌نمایش بگیرید.'); return res.redirect('/academic/year-close'); }
  if (String(req.body.confirm || '').trim() !== 'تایید' && String(req.body.confirm || '').trim() !== 'تأیید') { req.flash('danger', 'برای اجرا باید عبارت «تایید» را وارد کنید.'); return res.redirect('/academic/year-close'); }
  let backupName = null;
  try {
    if (plan.backup && modules.isEnabled('system.backup')) { const backup = require('../../core/backup'); backupName = await backup.create('file', 'before-year-close'); }
    const r = await svc.execute(plan, req.user.id);
    req.session.yearClosePlan = null;
    await activity.log(req, 'year_close', 'academic_years', r.targetId, `پایان سال ${plan.source.title} → ${plan.target.title}: ${r.summary.promoted} ارتقا، ${r.summary.graduated} فارغ‌التحصیل، ${r.summary.retained} تکرار پایه، ${r.summary.classes} کلاس جدید`);
    req.flash('success', `پایان سال با موفقیت اجرا شد: ${J.toPersianDigits(r.summary.promoted)} ارتقا، ${J.toPersianDigits(r.summary.graduated)} فارغ‌التحصیل، ${J.toPersianDigits(r.summary.retained)} تکرار پایه، ${J.toPersianDigits(r.summary.classes)} کلاس و ${J.toPersianDigits(r.summary.subjects)} درس‌کلاس جدید${backupName ? ` — پشتیبان: <code class="ltr">${backupName}</code>` : ''}.`);
    res.redirect('/academic/year-close');
  } catch (e) { req.flash('danger', 'خطا در اجرا: ' + e.message); res.redirect('/academic/year-close'); }
});
router.post('/cancel', (req, res) => { req.session.yearClosePlan = null; res.redirect('/academic/year-close'); });
router.post('/:id/revert', async (req, res) => {
  const run = await db.findById('year_close_runs', req.params.id);
  if (!run) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  try {
    await svc.revert(run, req.user.id);
    await activity.log(req, 'year_close_revert', 'academic_years', run.source_year_id, `بازگردانی پایان سال (اجرای #${run.id})`);
    req.flash('success', 'اجرای پایان سال بازگردانی شد؛ کلاس‌ها، سوابق و وضعیت دانش‌آموزان به حالت قبل برگشت.');
  } catch (e) { req.flash('danger', 'بازگردانی ممکن نیست: ' + e.message); }
  res.redirect('/academic/year-close');
});
module.exports = router;
