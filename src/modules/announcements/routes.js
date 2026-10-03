'use strict';
const path = require('path');
const express = require('express');
const db = require('../../core/db');
const people = require('../../core/people');
const auth = require('../../core/auth');
const modules = require('../../core/modules');
const notify = require('../../core/notify');
const activity = require('../../core/activity');
const utils = require('../../core/utils');
const J = require('../../core/jalali');

const router = express.Router();
const v = (n) => path.join(__dirname, 'views', n + '.ejs');
router.use(auth.requireAuth);
const E = modules.isEnabled;
const AUDIENCES = { all: 'همه', students: 'دانش‌آموزان', parents: 'اولیا', teachers: 'معلمان', staff: 'کارکنان', class: 'یک کلاس' };
const isStaff = (req) => req.user.role === 'admin' || req.can('announcements.manage');

async function ctx(req) {
  const c = { classIds: [], classId: null };
  if (req.user.role === 'teacher') { const t = await db.table('teachers').where('user_id', req.user.id).first(); if (t) { const a = await db.table('class_subjects').where('teacher_id', t.id).pluck('class_id'); const b = await db.table('classes').where('teacher_id', t.id).pluck('id'); c.classIds = [...new Set(a.concat(b))]; } }
  if (req.user.role === 'student' || req.user.role === 'parent') { const s = await people.studentOf(req); c.classId = s ? s.class_id : null; }
  return c;
}
function base() { return db.table('announcements as a').leftJoin('users as u', 'u.id', 'a.author_id').leftJoin('classes as c', 'c.id', 'a.class_id').select('a.*', 'u.name as author_name', 'c.title as class_title'); }
/** محدودکردن به اطلاعیه‌های قابل مشاهده برای کاربر */
async function visibleQuery(req, q) {
  if (isStaff(req)) return q;
  const c = await ctx(req);
  const now = J.nowISO(); const today = J.todayISO();
  q.where('a.is_active', 1);
  if (E('announcements.schedule')) q.where((b) => b.whereNull('a.publish_at').orWhere('a.publish_at', '<=', now)).where((b) => b.whereNull('a.expires_at').orWhere('a.expires_at', '>=', today));
  const role = req.user.role;
  q.where((b) => {
    b.where('a.audience', 'all');
    if (role === 'student' || role === 'parent') { b.orWhere('a.audience', 'students'); if (role === 'parent') b.orWhere('a.audience', 'parents'); if (c.classId) b.orWhere((x) => x.where('a.audience', 'class').where('a.class_id', c.classId)); }
    if (role === 'teacher') { b.orWhere('a.audience', 'teachers').orWhere('a.author_id', req.user.id); if (c.classIds.length) b.orWhere((x) => x.where('a.audience', 'class').whereIn('a.class_id', c.classIds)); }
  });
  return q;
}
async function canEdit(req, a) { return isStaff(req) || (req.user.role === 'teacher' && E('announcements.teacher_post') && a.author_id === req.user.id); }
const canCreate = (req) => isStaff(req) || (req.user.role === 'teacher' && E('announcements.teacher_post'));

router.get('/', async (req, res) => {
  const q = await visibleQuery(req, base());
  if (req.query.q) q.search(utils.normalizePersian(req.query.q), ['a.title', 'a.body']);
  if (isStaff(req) && req.query.audience) q.where('a.audience', req.query.audience);
  if (isStaff(req) && req.query.status === 'inactive') q.where('a.is_active', 0);
  if (E('announcements.pin')) q.orderBy('a.is_pinned', 'desc');
  const result = await q.orderBy('a.id', 'desc').paginate(req.query.page, 12);
  res.render(v('index'), { title: 'اطلاعیه‌ها', result, AUDIENCES, query: req.query, f: { q: req.query.q || '', audience: req.query.audience || '', status: req.query.status || '' }, canCreate: canCreate(req), isStaff: isStaff(req), now: J.nowISO(), today: J.todayISO() });
});
async function form(req, res, a) {
  const c = await ctx(req);
  const classes = await db.table('classes').where('is_active', 1).where((b) => (req.user.role === 'teacher' ? b.whereIn('id', c.classIds) : b)).orderBy('title').all();
  res.render(v('form'), { title: a ? 'ویرایش اطلاعیه' : 'اطلاعیهٔ جدید', a: a || {}, classes, AUDIENCES, isStaff: isStaff(req) });
}
router.get('/new', modules.requireEnabled('announcements.manage'), async (req, res) => { if (!canCreate(req)) return res.status(403).render('errors/403', { title: 'غیرمجاز' }); form(req, res, null); });
async function save(req, res, a) {
  const b = utils.cleanBody(req.body, { fields: ['title', 'body', 'audience', 'class_id', 'is_pinned', 'publish_at', 'expires_at', 'is_active'], dates: ['publish_at', 'expires_at'], booleans: ['is_pinned', 'is_active'] });
  const back = a ? `/announcements/${a.id}/edit` : '/announcements/new';
  if (!b.title || !b.body) { req.flash('danger', 'عنوان و متن الزامی است'); req.keepInput(); return res.redirect(back); }
  let audience = E('announcements.audience') && AUDIENCES[b.audience] ? b.audience : 'all';
  if (req.user.role === 'teacher') { audience = 'class'; const c = await ctx(req); if (!c.classIds.includes(Number(b.class_id))) { req.flash('danger', 'فقط برای کلاس‌های خودتان می‌توانید اطلاعیه بگذارید'); return res.redirect(back); } }
  const data = { title: b.title, body: b.body, audience, class_id: audience === 'class' ? Number(b.class_id) || null : null, is_pinned: E('announcements.pin') && isStaff(req) ? b.is_pinned : (a ? a.is_pinned : 0), publish_at: E('announcements.schedule') && b.publish_at ? b.publish_at + ' 00:00:00' : null, expires_at: E('announcements.schedule') ? b.expires_at : null, is_active: a ? b.is_active : 1 };
  if (a) { await db.update('announcements', data, { id: a.id }); await activity.log(req, 'update', 'announcements', a.id, 'ویرایش اطلاعیه ' + data.title); req.flash('success', 'اطلاعیه ویرایش شد.'); return res.redirect('/announcements/' + a.id); }
  data.author_id = req.user.id; data.created_at = db.now(); data.views = 0;
  const id = await db.insert('announcements', data);
  if (E('announcements.notify') && E('notifications.inapp') && (!data.publish_at || data.publish_at <= J.nowISO())) {
    let uids = [];
    if (audience === 'all') uids = await db.table('users').where('status', 'active').where('id', '!=', req.user.id).pluck('id');
    else if (audience === 'students') uids = await db.table('users').where({ role: 'student', status: 'active' }).pluck('id');
    else if (audience === 'teachers') uids = await db.table('users').where({ role: 'teacher', status: 'active' }).pluck('id');
    else if (audience === 'staff') uids = await db.table('users').whereIn('role', ['admin', 'staff']).where('status', 'active').pluck('id');
    else if (audience === 'class') uids = await db.table('students').where('class_id', data.class_id).where('status', 'active').whereNotNull('user_id').pluck('user_id');
    await notify.push(uids, { title: 'اطلاعیهٔ جدید', body: data.title, link: '/announcements/' + id, type: 'info' });
  }
  await activity.log(req, 'create', 'announcements', id, 'ثبت اطلاعیه ' + data.title);
  req.flash('success', 'اطلاعیه منتشر شد.'); res.redirect('/announcements/' + id);
}
router.post('/', modules.requireEnabled('announcements.manage'), async (req, res) => { if (!canCreate(req)) return res.status(403).render('errors/403', { title: 'غیرمجاز' }); return save(req, res, null); });
router.get('/:id/edit', modules.requireEnabled('announcements.manage'), async (req, res) => { const a = await db.findById('announcements', req.params.id); if (!a) return res.status(404).render('errors/404', { title: 'یافت نشد' }); if (!(await canEdit(req, a))) return res.status(403).render('errors/403', { title: 'غیرمجاز' }); form(req, res, a); });
router.post('/:id', modules.requireEnabled('announcements.manage'), async (req, res) => { const a = await db.findById('announcements', req.params.id); if (!a) return res.status(404).render('errors/404', { title: 'یافت نشد' }); if (!(await canEdit(req, a))) return res.status(403).render('errors/403', { title: 'غیرمجاز' }); return save(req, res, a); });
router.post('/:id/delete', modules.requireEnabled('announcements.manage'), async (req, res) => { const a = await db.findById('announcements', req.params.id); if (a && (await canEdit(req, a))) { await db.remove('announcements', { id: a.id }); await activity.log(req, 'delete', 'announcements', a.id, 'حذف اطلاعیه ' + a.title); req.flash('success', 'اطلاعیه حذف شد.'); } res.redirect('/announcements'); });
router.post('/:id/pin', auth.requireRoleOrPermission(['admin'], 'announcements.manage'), modules.requireEnabled('announcements.pin'), async (req, res) => { const a = await db.findById('announcements', req.params.id); if (a) await db.update('announcements', { is_pinned: a.is_pinned ? 0 : 1 }, { id: a.id }); res.redirect(req.get('referer') || '/announcements'); });
router.post('/:id/toggle', auth.requireRoleOrPermission(['admin'], 'announcements.manage'), async (req, res) => { const a = await db.findById('announcements', req.params.id); if (a) await db.update('announcements', { is_active: a.is_active ? 0 : 1 }, { id: a.id }); res.redirect(req.get('referer') || '/announcements'); });
router.get('/:id', async (req, res) => {
  const a = await (await visibleQuery(req, base())).where('a.id', req.params.id).first();
  if (!a) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  if (E('announcements.views') && !(await canEdit(req, a))) await db.table('announcements').where('id', a.id).update({ views: Number(a.views || 0) + 1 });
  const others = await (await visibleQuery(req, base())).where('a.id', '!=', a.id).orderBy('a.id', 'desc').limit(5).all();
  res.render(v('show'), { title: a.title, a, others, AUDIENCES, canEdit: await canEdit(req, a), isStaff: isStaff(req) });
});
module.exports = router;
