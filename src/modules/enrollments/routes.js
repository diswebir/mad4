'use strict';
const express = require('express');
const db = require('../../core/db');
const auth = require('../../core/auth');
const modules = require('../../core/modules');
const utils = require('../../core/utils');
const J = require('../../core/jalali');
const activity = require('../../core/activity');
const notify = require('../../core/notify');
const svc = require('./service');

const router = express.Router();
const v = (n) => `../modules/enrollments/views/${n}`;
const E = (k) => modules.isEnabled(k);
router.use(auth.requireAuth, auth.requireRoleOrPermission(['admin'], 'academic.manage'));

router.get('/', async (req, res) => {
  const years = await db.table('academic_years').orderBy('start_date', 'desc').all();
  const current = years.find((y) => y.is_current) || years[0];
  const yearId = Number(req.query.year) || (current ? current.id : 0);
  const page = Math.max(1, Number(req.query.page) || 1), per = 30;
  const q = db.table('enrollments as e').join('students as s', 's.id', 'e.student_id').leftJoin('academic_years as y', 'y.id', 'e.academic_year_id').where('e.academic_year_id', yearId);
  if (req.query.status) q.where('e.status', req.query.status);
  if (req.query.class_id) q.where('e.class_id', Number(req.query.class_id));
  if (req.query.student_id) q.where('e.student_id', Number(req.query.student_id));
  if (req.query.q) { const t = utils.normalizePersian(String(req.query.q)); q.where((b) => b.where('s.first_name', 'like', `%${t}%`).orWhere('s.last_name', 'like', `%${t}%`).orWhere('s.student_number', 'like', `%${J.toEnglishDigits(t)}%`)); }
  if (req.query.export === '1' && E('enrollments.export')) {
    const rows = await q.clone().select('e.*', 's.first_name', 's.last_name', 's.student_number', 'y.title as year_title').orderBy('e.class_title').orderBy('s.last_name').limit(20000).all();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="enrollments-${yearId}.csv"`);
    return res.send(utils.toCSV(rows, [{ label: 'سال', key: 'year_title' }, { label: 'شماره', key: 'student_number' }, { label: 'نام', key: 'first_name' }, { label: 'نام خانوادگی', key: 'last_name' }, { label: 'پایه', key: 'grade_title' }, { label: 'کلاس', key: 'class_title' }, { label: 'وضعیت', value: (r) => svc.STATUS[r.status] || r.status }, { label: 'از', value: (r) => J.formatDate(r.enrolled_at) }, { label: 'تا', value: (r) => r.left_at ? J.formatDate(r.left_at) : '' }, { label: 'توضیح', value: (r) => r.note || '' }]));
  }
  const total = await q.clone().count();
  const rows = await q.clone().select('e.*', 's.first_name', 's.last_name', 's.student_number', 's.photo', 'y.title as year_title').orderBy('e.class_title').orderBy('s.last_name').limit(per).offset((page - 1) * per).all();
  const statsRows = await db.table('enrollments').select('status', 'COUNT(*) as c').where('academic_year_id', yearId).groupBy('status').all();
  const stats = Object.fromEntries(statsRows.map((r) => [r.status, Number(r.c)]));
  const classes = await db.table('classes').orderBy('title').all();
  const missing = current && yearId === current.id ? (await db.table('students').where('status', 'active').count()) - (await db.table('enrollments').where('academic_year_id', yearId).count()) : 0;
  res.render(v('index'), { title: 'سوابق تحصیلی', years, yearId, current, rows, total, page, pages: Math.ceil(total / per), stats, classes, missing: Math.max(0, missing), STATUS: svc.STATUS, COLORS: svc.COLORS, filters: { status: req.query.status || '', class_id: req.query.class_id || '', q: req.query.q || '', student_id: req.query.student_id || '' } });
});
router.post('/backfill', modules.requireEnabled('enrollments.backfill'), async (req, res) => {
  const n = await svc.backfill(req.user.id);
  await activity.log(req, 'create', 'enrollments', null, `پر کردن سوابق تحصیلی: ${n} ردیف`);
  req.flash('success', `${J.toPersianDigits(n)} ردیف سابقهٔ تحصیلی ساخته شد.`); res.redirect('/enrollments');
});
router.post('/:id', async (req, res) => {
  const row = await db.findById('enrollments', req.params.id);
  if (!row) return res.redirect('/enrollments');
  const status = svc.STATUS[req.body.status] ? req.body.status : row.status;
  await db.update('enrollments', { status, note: utils.normalizePersian(req.body.note || '') || null, left_at: status === 'active' ? null : (J.toGregorian(req.body.left_at) || row.left_at || J.todayISO()), updated_at: db.now() }, { id: row.id });
  await activity.log(req, 'update', 'enrollments', row.id, `ویرایش سابقهٔ تحصیلی #${row.id} → ${svc.STATUS[status]}`);
  req.flash('success', 'ذخیره شد'); res.redirect(req.query.back ? String(req.query.back) : '/enrollments?year=' + row.academic_year_id);
});

// ---------- ارتقای پایان سال ----------
router.get('/promote', modules.requireEnabled('enrollments.promote'), async (req, res) => {
  const years = await db.table('academic_years').orderBy('start_date', 'desc').all();
  const current = years.find((y) => y.is_current);
  const classes = await db.table('classes as c').leftJoin('grade_levels as g', 'g.id', 'c.grade_level_id').select('c.*', 'g.title as grade_title', 'g.sort_order').orderBy('g.sort_order').orderBy('c.title').all();
  const counts = Object.fromEntries((await db.table('students').select('class_id', 'COUNT(*) as c').where('status', 'active').groupBy('class_id').all()).map((r) => [r.class_id, Number(r.c)]));
  const fromId = Number(req.query.class_id) || 0;
  const students = fromId ? await db.table('students as s').select('s.id', 's.first_name', 's.last_name', 's.student_number', 's.photo').where({ 's.class_id': fromId, 's.status': 'active' }).orderBy('s.last_name').all() : [];
  let avgs = {};
  if (fromId && students.length && E('exams')) {
    const rows = await db.table('grades as g').join('exams as e', 'e.id', 'g.exam_id').select('g.student_id', 'AVG(g.score * 20.0 / e.max_score) as avg').where('e.class_id', fromId).whereNotNull('g.score').groupBy('g.student_id').all();
    avgs = Object.fromEntries(rows.map((r) => [r.student_id, Math.round(r.avg * 100) / 100]));
  }
  res.render(v('promote'), { title: 'ارتقای پایان سال', years, current, classes, counts, fromId, students, avgs, passScore: Number(require('../../core/settings').get('grading_pass_score', 10)) || 10 });
});
router.post('/promote', modules.requireEnabled('enrollments.promote'), async (req, res) => {
  const fromId = Number(req.body.from_class_id) || 0;
  const toYear = await db.findById('academic_years', req.body.academic_year_id);
  const action = ['promote', 'retain', 'graduate'].includes(req.body.action) ? req.body.action : 'promote';
  const toClass = action === 'graduate' ? null : await db.findById('classes', req.body.to_class_id);
  const ids = [].concat(req.body.student_ids || []).map(Number).filter(Boolean);
  if (!fromId || !toYear || !ids.length || (action !== 'graduate' && !toClass)) { req.flash('danger', 'کلاس مبدأ، سال مقصد و دانش‌آموزان را انتخاب کنید.'); return res.redirect('/enrollments/promote?class_id=' + fromId); }
  const fromYear = await db.table('classes').where('id', fromId).first();
  const srcYearId = fromYear && fromYear.academic_year_id ? fromYear.academic_year_id : (await svc.currentYear() || {}).id;
  const now = db.now(); const today = J.todayISO();
  let n = 0;
  for (const sid of ids) {
    const s = await db.findById('students', sid);
    if (!s || Number(s.class_id) !== fromId) continue;
    // بستن سال مبدأ
    const closeStatus = action === 'promote' ? 'promoted' : action === 'retain' ? 'retained' : 'graduated';
    const prev = await db.table('enrollments').where({ student_id: sid, academic_year_id: srcYearId }).first();
    if (prev) await db.update('enrollments', { status: closeStatus, left_at: today, updated_at: now }, { id: prev.id });
    else { const ci = await svc.classInfo(fromId); await db.insert('enrollments', { student_id: sid, academic_year_id: srcYearId, class_id: fromId, class_title: ci && ci.title, grade_level_id: ci && ci.grade_level_id, grade_title: ci && ci.grade_title, status: closeStatus, enrolled_at: today, left_at: today, created_at: now, updated_at: now }); }
    if (action === 'graduate') {
      await db.update('students', { status: 'graduated', updated_at: now }, { id: sid });
      if (s.user_id) await db.update('users', { status: 'inactive', updated_at: now }, { id: s.user_id });
    } else {
      await db.update('students', { class_id: toClass.id, grade_level_id: toClass.grade_level_id, updated_at: now }, { id: sid });
      await svc.ensureActive(sid, toClass.id, { year: toYear, userId: req.user.id, startDate: toYear.start_date || today, note: action === 'retain' ? 'تکرار پایه' : null });
      if (E('students.transfer')) await db.insert('student_transfers', { student_id: sid, from_class_id: fromId, to_class_id: toClass.id, reason: action === 'retain' ? 'تکرار پایه' : 'ارتقای پایان سال', transferred_by: req.user.id, created_at: now });
      if (s.user_id && E('notifications.inapp')) await notify.push([s.user_id], { title: 'کلاس جدید', body: `برای سال تحصیلی ${toYear.title} در کلاس «${toClass.title}» ثبت‌نام شدید.`, link: '/students/me', type: 'info' });
    }
    n++;
  }
  await activity.log(req, 'update', 'enrollments', null, `${action === 'graduate' ? 'فارغ‌التحصیلی' : action === 'retain' ? 'تکرار پایه' : 'ارتقا'} ${n} دانش‌آموز از کلاس #${fromId}`);
  req.flash('success', `${J.toPersianDigits(n)} دانش‌آموز ${action === 'graduate' ? 'فارغ‌التحصیل شدند' : 'به کلاس «' + toClass.title + '» منتقل شدند'}.`);
  res.redirect('/enrollments/promote?class_id=' + fromId);
});
module.exports = router;
