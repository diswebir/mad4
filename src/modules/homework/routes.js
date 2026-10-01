'use strict';
const path = require('path');
const express = require('express');
const db = require('../../core/db');
const people = require('../../core/people');
const auth = require('../../core/auth');
const modules = require('../../core/modules');
const activity = require('../../core/activity');
const utils = require('../../core/utils');
const J = require('../../core/jalali');
const upload = require('../../core/upload');
const settings = require('../../core/settings');
const notify = require('../../core/notify');

const router = express.Router();
const v = (n) => path.join(__dirname, 'views', n + '.ejs');
router.use(auth.requireAuth);
const E = modules.isEnabled;
const isStaff = (req) => ['admin', 'staff'].includes(req.user.role);

async function teacherCtx(req) {
  if (req.user.role !== 'teacher') return null;
  const t = await db.table('teachers').where('user_id', req.user.id).first();
  if (!t) return { id: -1, csIds: [], classIds: [] };
  const cs = await db.table('class_subjects').select('id', 'class_id').where('teacher_id', t.id).all();
  const homeroom = await db.table('classes').where('teacher_id', t.id).pluck('id');
  return { id: t.id, csIds: cs.map((x) => x.id), classIds: [...new Set(cs.map((x) => x.class_id).concat(homeroom))] };
}
async function studentCtx(req) { return (req.user.role === 'student' || req.user.role === 'parent') ? people.studentOf(req) : null; }
async function csFor(req, classId) {
  const q = db.table('class_subjects as cs').join('subjects as s', 's.id', 'cs.subject_id').join('classes as c', 'c.id', 'cs.class_id').select('cs.*', 's.title as subject_title', 'c.title as class_title').orderBy('c.title').orderBy('s.title');
  if (classId) q.where('cs.class_id', classId);
  const tc = await teacherCtx(req); if (tc) q.whereIn('cs.id', tc.csIds);
  return q.all();
}
function baseQuery() {
  return db.table('homework as h').join('classes as c', 'c.id', 'h.class_id').join('subjects as s', 's.id', 'h.subject_id').leftJoin('users as u', 'u.id', 'h.created_by')
    .select('h.*', 'c.title as class_title', 's.title as subject_title', 'u.name as creator_name', '(SELECT COUNT(*) FROM homework_submissions x WHERE x.homework_id = h.id) as submissions', '(SELECT COUNT(*) FROM homework_submissions x WHERE x.homework_id = h.id AND x.score IS NOT NULL) as graded', '(SELECT COUNT(*) FROM students st WHERE st.class_id = h.class_id AND st.status = \'active\') as students_count');
}
async function canManage(req, hw) { if (isStaff(req)) return true; const tc = await teacherCtx(req); return !!tc && (tc.csIds.includes(hw.class_subject_id) || hw.created_by === req.user.id); }
async function canView(req, hw) { if (await canManage(req, hw)) return true; const tc = await teacherCtx(req); if (tc) return tc.classIds.includes(hw.class_id); const s = await studentCtx(req); return !!s && s.class_id === hw.class_id; }

// ---------- فهرست ----------
router.get('/', async (req, res) => {
  if (req.user.role === 'student' || req.user.role === 'parent') return res.redirect('/homework/my');
  const tc = await teacherCtx(req);
  const f = { class_id: req.query.class_id || '', status: req.query.status || '', q: utils.normalizePersian(req.query.q || '') };
  const q = baseQuery();
  if (tc) q.whereIn('h.class_id', tc.classIds);
  if (f.class_id) q.where('h.class_id', f.class_id);
  if (f.status === 'open') q.where('h.due_date', '>=', J.todayISO());
  if (f.status === 'past') q.where('h.due_date', '<', J.todayISO());
  if (f.q) q.search(f.q, ['h.title', 's.title', 'c.title']);
  const result = await q.orderBy('h.due_date', 'desc').orderBy('h.id', 'desc').paginate(req.query.page, settings.getInt('items_per_page', 20));
  const classes = await db.table('classes').where('is_active', 1).where((b) => (tc ? b.whereIn('id', tc.classIds) : b)).orderBy('title').all();
  res.render(v('index'), { title: 'تکالیف', result, classes, f, query: req.query });
});

// ---------- دانش‌آموز ----------
router.get('/my', auth.requireRole('student', 'parent'), async (req, res) => {
  const s = await studentCtx(req);
  if (!s || !s.class_id) return res.render(v('my'), { title: 'تکالیف من', rows: [], tab: 'pending', s });
  const rows = await db.table('homework as h').join('subjects as sb', 'sb.id', 'h.subject_id').joinRaw('LEFT JOIN homework_submissions x ON x.homework_id = h.id AND x.student_id = ?', [s.id]).select('h.*', 'sb.title as subject_title', 'x.id as sub_id', 'x.status as sub_status', 'x.score', 'x.feedback', 'x.submitted_at').where('h.class_id', s.class_id).orderBy('h.due_date', 'desc').limit(200).all();
  const today = J.todayISO();
  rows.forEach((r) => { r.state = r.sub_id ? (r.score != null ? 'graded' : 'submitted') : (r.due_date < today ? 'missing' : 'pending'); });
  const tab = ['pending', 'submitted', 'graded', 'missing', 'all'].includes(req.query.tab) ? req.query.tab : 'pending';
  const counts = { pending: 0, submitted: 0, graded: 0, missing: 0, all: rows.length };
  rows.forEach((r) => counts[r.state]++);
  res.render(v('my'), { title: 'تکالیف من', rows: tab === 'all' ? rows : rows.filter((r) => r.state === tab), tab, counts, s, today });
});

// ---------- محتوای آموزشی ----------
router.get('/materials', modules.requireEnabled('homework.materials'), async (req, res) => {
  const q = db.table('materials as m').join('classes as c', 'c.id', 'm.class_id').leftJoin('subjects as s', 's.id', 'm.subject_id').leftJoin('users as u', 'u.id', 'm.created_by').select('m.*', 'c.title as class_title', 's.title as subject_title', 'u.name as creator_name').orderBy('m.id', 'desc');
  const tc = await teacherCtx(req); const st = await studentCtx(req);
  if (tc) q.whereIn('m.class_id', tc.classIds);
  if (st) q.where('m.class_id', st.class_id || 0);
  if (req.query.class_id) q.where('m.class_id', req.query.class_id);
  if (req.query.q) q.search(utils.normalizePersian(req.query.q), ['m.title', 'm.description', 's.title']);
  const result = await q.paginate(req.query.page, 24);
  const canAdd = req.user.role !== 'student';
  res.render(v('materials'), { title: 'محتوای آموزشی', result, cs: canAdd ? await csFor(req) : [], classes: st ? [] : await db.table('classes').where('is_active', 1).where((b) => (tc ? b.whereIn('id', tc.classIds) : b)).orderBy('title').all(), canAdd, query: req.query, f: { class_id: req.query.class_id || '', q: req.query.q || '' } });
});
router.post('/materials', auth.requireRole('admin', 'staff', 'teacher'), modules.requireEnabled('homework.materials'), ...upload.form('materials', 'single', 'file', { maxMb: 20 }), async (req, res) => {
  if (req.uploadError) { req.flash('danger', req.uploadError); return res.redirect('/homework/materials'); }
  const b = utils.cleanBody(req.body, { fields: ['class_subject_id', 'title', 'description', 'link'] });
  const cs = await db.table('class_subjects').where('id', b.class_subject_id).first();
  if (!cs || !b.title || (!req.file && !b.link)) { req.flash('danger', 'درس، عنوان و فایل یا لینک الزامی است'); return res.redirect('/homework/materials'); }
  const tc = await teacherCtx(req); if (tc && !tc.csIds.includes(cs.id)) return res.status(403).render('errors/403', { title: 'غیرمجاز' });
  const id = await db.insert('materials', { class_id: cs.class_id, class_subject_id: cs.id, subject_id: cs.subject_id, title: b.title, description: b.description || null, file_path: req.file ? upload.relPath(req.file) : null, file_name: req.file ? req.file.originalname : null, link: b.link || null, created_by: req.user.id, created_at: db.now() });
  if (E('homework.notify') && E('notifications.inapp')) { const uids = await db.table('students').where('class_id', cs.class_id).where('status', 'active').whereNotNull('user_id').pluck('user_id'); await notify.push(uids, { title: 'محتوای آموزشی جدید', body: b.title, link: '/homework/materials', type: 'info' }); }
  await activity.log(req, 'create', 'materials', id, 'محتوای آموزشی: ' + b.title);
  req.flash('success', 'محتوا به اشتراک گذاشته شد.'); res.redirect('/homework/materials');
});
router.post('/materials/:id/delete', auth.requireRole('admin', 'staff', 'teacher'), modules.requireEnabled('homework.materials'), async (req, res) => {
  const m = await db.findById('materials', req.params.id);
  if (m && (isStaff(req) || m.created_by === req.user.id)) { upload.removeFile(m.file_path); await db.remove('materials', { id: m.id }); req.flash('success', 'حذف شد.'); }
  res.redirect('/homework/materials');
});

// ---------- ایجاد / ویرایش ----------
async function form(req, res, hw) {
  const cs = await csFor(req);
  res.render(v('form'), { title: hw ? 'ویرایش تکلیف' : 'تکلیف جدید', hw: hw || {}, cs, prefill: { class_subject_id: req.query.class_subject_id || '' } });
}
router.get('/new', auth.requireRole('admin', 'staff', 'teacher'), modules.requireEnabled('homework.manage'), (req, res) => form(req, res, null));
async function save(req, res, hw) {
  const back = hw ? `/homework/${hw.id}/edit` : '/homework/new';
  if (req.uploadError) { req.flash('danger', req.uploadError); return res.redirect(back); }
  const b = utils.cleanBody(req.body, { fields: ['class_subject_id', 'title', 'description', 'due_date', 'max_score', 'allow_submission'], dates: ['due_date'], numbers: ['max_score'], booleans: ['allow_submission'] });
  const cs = await db.table('class_subjects').where('id', b.class_subject_id).first();
  if (!cs || !b.title || !b.due_date) { req.flash('danger', 'درس، عنوان و مهلت الزامی است'); req.keepInput(); return res.redirect(back); }
  const tc = await teacherCtx(req); if (tc && !tc.csIds.includes(cs.id)) return res.status(403).render('errors/403', { title: 'غیرمجاز' });
  const data = { class_id: cs.class_id, class_subject_id: cs.id, subject_id: cs.subject_id, title: b.title, description: b.description || null, due_date: b.due_date, max_score: b.max_score || 20, allow_submission: E('homework.submit') ? (b.allow_submission ? 1 : 0) : 0 };
  if (req.file) { if (hw) upload.removeFile(hw.file_path); data.file_path = upload.relPath(req.file); data.file_name = req.file.originalname; }
  else if (req.body.remove_file === '1' && hw) { upload.removeFile(hw.file_path); data.file_path = null; data.file_name = null; }
  if (hw) { await db.update('homework', data, { id: hw.id }); await activity.log(req, 'update', 'homework', hw.id, 'ویرایش تکلیف ' + data.title); req.flash('success', 'تکلیف ویرایش شد.'); return res.redirect('/homework/' + hw.id); }
  data.created_by = req.user.id; data.created_at = db.now();
  const id = await db.insert('homework', data);
  if (E('homework.notify') && E('notifications.inapp')) { const uids = await db.table('students').where('class_id', cs.class_id).where('status', 'active').whereNotNull('user_id').pluck('user_id'); const subj = await db.findById('subjects', cs.subject_id); await notify.push(uids, { title: 'تکلیف جدید', body: `${subj ? subj.title : ''}: ${data.title} — مهلت ${J.formatDate(data.due_date)}`, link: '/homework/' + id, type: 'info' }); }
  await activity.log(req, 'create', 'homework', id, 'تعریف تکلیف ' + data.title);
  req.flash('success', 'تکلیف تعریف شد.'); res.redirect('/homework/' + id);
}
router.post('/', auth.requireRole('admin', 'staff', 'teacher'), modules.requireEnabled('homework.manage'), ...upload.form('homework', 'single', 'file', { maxMb: 20 }), (req, res) => save(req, res, null));
router.get('/:id/edit', auth.requireRole('admin', 'staff', 'teacher'), modules.requireEnabled('homework.manage'), async (req, res) => { const hw = await db.findById('homework', req.params.id); if (!hw) return res.status(404).render('errors/404', { title: 'یافت نشد' }); if (!(await canManage(req, hw))) return res.status(403).render('errors/403', { title: 'غیرمجاز' }); form(req, res, hw); });
router.post('/:id', auth.requireRole('admin', 'staff', 'teacher'), modules.requireEnabled('homework.manage'), ...upload.form('homework', 'single', 'file', { maxMb: 20 }), async (req, res) => { const hw = await db.findById('homework', req.params.id); if (!hw) return res.status(404).render('errors/404', { title: 'یافت نشد' }); if (!(await canManage(req, hw))) return res.status(403).render('errors/403', { title: 'غیرمجاز' }); save(req, res, hw); });
router.post('/:id/delete', auth.requireRole('admin', 'staff', 'teacher'), modules.requireEnabled('homework.manage'), async (req, res) => {
  const hw = await db.findById('homework', req.params.id); if (!hw) return res.status(404).render('errors/404', { title: 'یافت نشد' }); if (!(await canManage(req, hw))) return res.status(403).render('errors/403', { title: 'غیرمجاز' });
  const files = await db.table('homework_submissions').where('homework_id', hw.id).whereNotNull('file_path').pluck('file_path'); files.forEach((f) => upload.removeFile(f)); upload.removeFile(hw.file_path);
  await db.remove('homework_submissions', { homework_id: hw.id }); await db.remove('homework', { id: hw.id });
  await activity.log(req, 'delete', 'homework', hw.id, 'حذف تکلیف ' + hw.title);
  req.flash('success', 'تکلیف حذف شد.'); res.redirect('/homework');
});

// ---------- نمایش ----------
router.get('/:id', async (req, res) => {
  const hw = await baseQuery().where('h.id', req.params.id).first();
  if (!hw) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  if (!(await canView(req, hw))) return res.status(403).render('errors/403', { title: 'دسترسی غیرمجاز' });
  const manage = await canManage(req, hw);
  const s = await studentCtx(req);
  const today = J.todayISO();
  const lateAllowed = E('homework.late') && settings.getBool('homework_late_allowed');
  if (s) {
    const sub = await db.table('homework_submissions').where({ homework_id: hw.id, student_id: s.id }).first();
    const canSubmit = E('homework.submit') && hw.allow_submission && (hw.due_date >= today || lateAllowed) && !(sub && sub.score != null);
    return res.render(v('show'), { title: hw.title, hw, s, sub, canSubmit, isLate: hw.due_date < today, manage: false, students: [], subs: {}, today });
  }
  const students = await db.table('students').select('id', 'first_name', 'last_name', 'student_number', 'photo').where('class_id', hw.class_id).where('status', 'active').orderBy('last_name').all();
  const subs = utils.indexBy(await db.table('homework_submissions').where('homework_id', hw.id).all(), 'student_id');
  res.render(v('show'), { title: hw.title, hw, s: null, sub: null, canSubmit: false, isLate: false, manage, students, subs, today, query: req.query });
});
router.post('/:id/submit', auth.requireRole('student'), modules.requireEnabled('homework.submit'), ...upload.form('homework/submissions', 'single', 'file', { maxMb: 20 }), async (req, res) => {
  const hw = await db.findById('homework', req.params.id); const s = await studentCtx(req);
  if (!hw || !s || s.class_id !== hw.class_id) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const back = '/homework/' + hw.id;
  if (req.uploadError) { req.flash('danger', req.uploadError); return res.redirect(back); }
  const today = J.todayISO(); const late = hw.due_date < today;
  if (!hw.allow_submission || (late && !(E('homework.late') && settings.getBool('homework_late_allowed')))) { req.flash('danger', 'مهلت ارسال این تکلیف به پایان رسیده است.'); return res.redirect(back); }
  const content = utils.normalizePersian(req.body.content || '').trim();
  if (!content && !req.file) { req.flash('danger', 'متن پاسخ یا فایل الزامی است'); return res.redirect(back); }
  const ex = await db.table('homework_submissions').where({ homework_id: hw.id, student_id: s.id }).first();
  if (ex && ex.score != null) { req.flash('warning', 'این تکلیف نمره‌دهی شده و قابل ویرایش نیست.'); return res.redirect(back); }
  const data = { content: content || null, status: late ? 'late' : 'submitted', submitted_at: db.now() };
  if (req.file) { if (ex) upload.removeFile(ex.file_path); data.file_path = upload.relPath(req.file); data.file_name = req.file.originalname; }
  if (ex) await db.update('homework_submissions', data, { id: ex.id }); else await db.insert('homework_submissions', Object.assign({ homework_id: hw.id, student_id: s.id }, data));
  if (E('homework.notify') && E('notifications.inapp') && hw.created_by) await notify.push([hw.created_by], { title: 'پاسخ تکلیف', body: `${s.first_name} ${s.last_name} پاسخ «${hw.title}» را ارسال کرد.`, link: back, type: 'info' });
  req.flash('success', late ? 'پاسخ شما با برچسب «با تأخیر» ثبت شد.' : 'پاسخ شما ارسال شد.'); res.redirect(back);
});
router.post('/:id/grade', auth.requireRole('admin', 'staff', 'teacher'), modules.requireEnabled('homework.grade'), async (req, res) => {
  const hw = await db.findById('homework', req.params.id);
  if (!hw) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  if (!(await canManage(req, hw))) return res.status(403).render('errors/403', { title: 'غیرمجاز' });
  const students = await db.table('students').where('class_id', hw.class_id).pluck('id');
  const subs = utils.indexBy(await db.table('homework_submissions').where('homework_id', hw.id).all(), 'student_id');
  let n = 0; const now = db.now(); const notifyIds = [];
  for (const sid of students) {
    const raw = J.toEnglishDigits(req.body['score_' + sid] || '').trim().replace('/', '.');
    const feedback = utils.normalizePersian(req.body['feedback_' + sid] || '').trim() || null;
    if (raw === '' && !feedback) continue;
    const score = raw === '' ? null : Number(raw);
    if (score != null && (Number.isNaN(score) || score < 0 || score > Number(hw.max_score))) continue;
    const row = { score, feedback, status: score != null ? 'graded' : (subs[sid] ? subs[sid].status : 'missing'), graded_at: now, graded_by: req.user.id };
    if (subs[sid]) await db.update('homework_submissions', row, { id: subs[sid].id }); else await db.insert('homework_submissions', Object.assign({ homework_id: hw.id, student_id: sid, submitted_at: null }, row));
    n++; notifyIds.push(sid);
  }
  if (n && E('homework.notify') && E('notifications.inapp')) { const uids = await db.table('students').whereIn('id', notifyIds).whereNotNull('user_id').pluck('user_id'); await notify.push(uids, { title: 'نمرهٔ تکلیف', body: `نمرهٔ تکلیف «${hw.title}» ثبت شد.`, link: '/homework/' + hw.id, type: 'success' }); }
  await activity.log(req, 'grade', 'homework', hw.id, `نمره‌دهی ${n} پاسخ تکلیف ${hw.title}`);
  req.flash('success', `${J.toPersianDigits(n)} مورد ذخیره شد.`); res.redirect('/homework/' + hw.id);
});

module.exports = router;
