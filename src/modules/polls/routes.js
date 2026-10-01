'use strict';
const path = require('path');
const express = require('express');
const db = require('../../core/db');
const auth = require('../../core/auth');
const modules = require('../../core/modules');
const people = require('../../core/people');
const activity = require('../../core/activity');
const notify = require('../../core/notify');
const utils = require('../../core/utils');
const J = require('../../core/jalali');

const router = express.Router();
const v = (n) => path.join(__dirname, 'views', n + '.ejs');
router.use(auth.requireAuth);
const E = modules.isEnabled;
const AUD = { all: 'همه', students: 'دانش‌آموزان', parents: 'اولیا', teachers: 'معلمان', class: 'یک کلاس' };
const isStaff = (req) => req.user.role === 'admin' || req.can('polls.manage');
const canCreate = (req) => isStaff(req) || (req.user.role === 'teacher' && E('polls.teacher_create'));
const parseOptions = (p) => { try { const o = JSON.parse(p.options || '[]'); return Array.isArray(o) ? o : []; } catch (e) { return []; } };

async function visible(req) {
  const q = db.table('polls as p').leftJoin('classes as c', 'c.id', 'p.class_id').leftJoin('users as u', 'u.id', 'p.created_by').select('p.*', 'c.title as class_title', 'u.name as creator', '(SELECT COUNT(DISTINCT user_id) FROM poll_votes pv WHERE pv.poll_id = p.id) as voters').orderBy('p.is_active', 'desc').orderBy('p.id', 'desc');
  if (isStaff(req)) return q;
  q.where('p.is_active', 1);
  if (req.user.role === 'student' || req.user.role === 'parent') { const s = await people.studentOf(req); q.where((b) => { b.whereIn('p.audience', req.user.role === 'parent' ? ['all', 'students', 'parents'] : ['all', 'students']); if (s && s.class_id) b.orWhere((x) => x.where('p.audience', 'class').where('p.class_id', s.class_id)); }); }
  else { const ids = await people.teacherClassIds(req.user.id); q.where((b) => { b.whereIn('p.audience', ['all', 'teachers']).orWhere('p.created_by', req.user.id); if (ids.length) b.orWhere((x) => x.where('p.audience', 'class').whereIn('p.class_id', ids)); }); }
  return q;
}
router.get('/', async (req, res) => {
  const polls = await (await visible(req)).all();
  const myVotes = await db.table('poll_votes').where('user_id', req.user.id).pluck('poll_id');
  res.render(v('index'), { title: 'نظرسنجی‌ها', polls: polls.map((p) => Object.assign(p, { opts: parseOptions(p), voted: myVotes.includes(p.id), expired: p.ends_at && p.ends_at < J.todayISO() })), AUD, canCreate: canCreate(req), isStaff: isStaff(req) });
});
router.get('/new', modules.requireEnabled('polls.manage'), async (req, res) => {
  if (!canCreate(req)) return res.status(403).render('errors/403', { title: 'غیرمجاز' });
  res.render(v('form'), { title: 'نظرسنجی جدید', classes: await people.classOptions(req), AUD, isStaff: isStaff(req) });
});
router.post('/', modules.requireEnabled('polls.manage'), async (req, res) => {
  if (!canCreate(req)) return res.status(403).render('errors/403', { title: 'غیرمجاز' });
  const b = utils.cleanBody(req.body, { fields: ['question', 'description', 'audience', 'class_id', 'multiple', 'ends_at'], dates: ['ends_at'], booleans: ['multiple'] });
  let opts = req.body.options; opts = (Array.isArray(opts) ? opts : [opts]).map((o) => utils.normalizePersian(String(o || '')).trim()).filter(Boolean);
  if (!b.question || opts.length < 2) { req.flash('danger', 'سؤال و حداقل دو گزینه الزامی است'); req.keepInput(); return res.redirect('/polls/new'); }
  let audience = AUD[b.audience] ? b.audience : 'all';
  if (req.user.role === 'teacher') { audience = 'class'; if (!(await people.teacherClassIds(req.user.id)).includes(Number(b.class_id))) return res.status(403).render('errors/403', { title: 'غیرمجاز' }); }
  const id = await db.insert('polls', { question: b.question, description: b.description, options: JSON.stringify(opts), audience, class_id: audience === 'class' ? Number(b.class_id) || null : null, is_active: 1, multiple: E('polls.multiple') ? b.multiple : 0, ends_at: b.ends_at, created_by: req.user.id, created_at: db.now() });
  if (E('notifications.inapp')) {
    let uids = [];
    if (audience === 'class') uids = await db.table('students').where('class_id', Number(b.class_id)).where('status', 'active').whereNotNull('user_id').pluck('user_id');
    else if (audience === 'students') uids = await db.table('users').where({ role: 'student', status: 'active' }).pluck('id');
    else if (audience === 'teachers') uids = await db.table('users').where({ role: 'teacher', status: 'active' }).pluck('id');
    else uids = await db.table('users').where('status', 'active').where('id', '!=', req.user.id).pluck('id');
    await notify.push(uids, { title: 'نظرسنجی جدید', body: b.question, link: '/polls/' + id, type: 'info' });
  }
  await activity.log(req, 'create', 'polls', id, 'ایجاد نظرسنجی ' + b.question);
  req.flash('success', 'نظرسنجی ایجاد شد.'); res.redirect('/polls/' + id);
});
router.get('/:id', async (req, res) => {
  const p = await (await visible(req)).where('p.id', req.params.id).first();
  if (!p) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const opts = parseOptions(p);
  const mine = await db.table('poll_votes').where({ poll_id: p.id, user_id: req.user.id }).pluck('option_index');
  const counts = await db.table('poll_votes').select('option_index', 'COUNT(*) as c').where('poll_id', p.id).groupBy('option_index').all();
  const results = opts.map((o, i) => ({ label: o, count: Number((counts.find((c) => Number(c.option_index) === i) || {}).c || 0) }));
  const totalVotes = results.reduce((a, r) => a + r.count, 0);
  const owner = isStaff(req) || p.created_by === req.user.id;
  const expired = p.ends_at && p.ends_at < J.todayISO();
  const canVote = E('polls.vote') && p.is_active && !expired && !mine.length && !(owner && isStaff(req) && req.user.role === 'admin' && false);
  res.render(v('show'), { title: p.question, p, opts, mine, results, totalVotes, voters: Number(p.voters || 0), owner, expired, canVote, showResults: owner || (mine.length && E('polls.results_public')) || expired || !p.is_active, AUD });
});
router.post('/:id/vote', modules.requireEnabled('polls.vote'), async (req, res) => {
  const p = await (await visible(req)).where('p.id', req.params.id).first();
  if (!p || !p.is_active || (p.ends_at && p.ends_at < J.todayISO())) { req.flash('danger', 'این نظرسنجی فعال نیست'); return res.redirect('/polls'); }
  if (await db.exists('poll_votes', { poll_id: p.id, user_id: req.user.id })) { req.flash('warning', 'قبلاً رأی داده‌اید'); return res.redirect('/polls/' + p.id); }
  const opts = parseOptions(p);
  let sel = req.body.option; sel = (Array.isArray(sel) ? sel : [sel]).map((x) => Number(x)).filter((x) => Number.isInteger(x) && x >= 0 && x < opts.length);
  if (!p.multiple || !E('polls.multiple')) sel = sel.slice(0, 1);
  if (!sel.length) { req.flash('danger', 'گزینه‌ای انتخاب نشده'); return res.redirect('/polls/' + p.id); }
  await db.insert('poll_votes', [...new Set(sel)].map((i) => ({ poll_id: p.id, user_id: req.user.id, option_index: i, created_at: db.now() })));
  req.flash('success', 'رأی شما ثبت شد. متشکریم!'); res.redirect('/polls/' + p.id);
});
router.post('/:id/toggle', modules.requireEnabled('polls.manage'), async (req, res) => { const p = await db.findById('polls', req.params.id); if (p && (isStaff(req) || p.created_by === req.user.id)) await db.update('polls', { is_active: p.is_active ? 0 : 1 }, { id: p.id }); res.redirect('/polls/' + req.params.id); });
router.post('/:id/delete', modules.requireEnabled('polls.manage'), async (req, res) => { const p = await db.findById('polls', req.params.id); if (p && (isStaff(req) || p.created_by === req.user.id)) { await db.remove('poll_votes', { poll_id: p.id }); await db.remove('polls', { id: p.id }); await activity.log(req, 'delete', 'polls', p.id, 'حذف نظرسنجی'); req.flash('success', 'نظرسنجی حذف شد.'); } res.redirect('/polls'); });
module.exports = router;
