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
const isStaff = (req) => ['admin', 'staff'].includes(req.user.role);

/** گیرندگان مجاز برای کاربر جاری: [{group, users:[{id,name,role}]}] */
async function recipientsFor(req) {
  const groups = [];
  const admins = await db.table('users').select('id', 'name', 'role').whereIn('role', ['admin', 'staff']).where('status', 'active').where('id', '!=', req.user.id).orderBy('name').all();
  if (admins.length) groups.push({ group: 'مدیریت و کارکنان', users: admins });
  if (isStaff(req)) {
    const teachers = await db.table('users').select('id', 'name', 'role').where({ role: 'teacher', status: 'active' }).orderBy('name').all();
    if (teachers.length) groups.push({ group: 'معلمان', users: teachers });
    const studs = await db.table('students as s').join('users as u', 'u.id', 's.user_id').leftJoin('classes as c', 'c.id', 's.class_id').select('u.id', 'u.name', 'u.role', 'c.title as class_title').where('s.status', 'active').orderBy('c.title').orderBy('u.name').all();
    if (studs.length) groups.push({ group: 'دانش‌آموزان', users: studs.map((s) => ({ id: s.id, name: s.name + (s.class_title ? ' — ' + s.class_title : ''), role: 'student' })) });
    const pars = await parentsOfClasses(null);
    if (pars.length) groups.push({ group: 'اولیا', users: pars });
  } else if (req.user.role === 'teacher') {
    const t = await db.table('teachers').where('user_id', req.user.id).first();
    const teachers = await db.table('users').select('id', 'name', 'role').where({ role: 'teacher', status: 'active' }).where('id', '!=', req.user.id).orderBy('name').all();
    if (teachers.length) groups.push({ group: 'همکاران', users: teachers });
    if (t) {
      const classIds = [...new Set((await db.table('class_subjects').where('teacher_id', t.id).pluck('class_id')).concat(await db.table('classes').where('teacher_id', t.id).pluck('id')))];
      const studs = await db.table('students as s').join('users as u', 'u.id', 's.user_id').leftJoin('classes as c', 'c.id', 's.class_id').select('u.id', 'u.name', 'c.title as class_title').whereIn('s.class_id', classIds).where('s.status', 'active').orderBy('c.title').orderBy('u.name').all();
      if (studs.length) groups.push({ group: 'دانش‌آموزان کلاس‌های من', users: studs.map((s) => ({ id: s.id, name: s.name + (s.class_title ? ' — ' + s.class_title : ''), role: 'student' })) });
      const pars = classIds.length ? await parentsOfClasses(classIds) : [];
      if (pars.length) groups.push({ group: 'اولیای کلاس‌های من', users: pars });
    }
  } else if (req.user.role === 'parent' || (req.user.role === 'student' && E('messages.student_send'))) {
    const s = await people.studentOf(req);
    if (s && s.class_id) {
      const tids = [...new Set((await db.table('class_subjects').where('class_id', s.class_id).whereNotNull('teacher_id').pluck('teacher_id')).concat((await db.table('classes').where('id', s.class_id).whereNotNull('teacher_id').pluck('teacher_id'))))];
      const teachers = tids.length ? await db.table('teachers as t').join('users as u', 'u.id', 't.user_id').select('u.id', 'u.name', 'u.role').whereIn('t.id', tids).where('u.status', 'active').orderBy('u.name').all() : [];
      if (teachers.length) groups.push({ group: 'معلمان من', users: teachers });
    }
  }
  return groups;
}
async function parentsOfClasses(classIds) {
  const q = db.table('student_parents as sp').join('parents as p', 'p.id', 'sp.parent_id').join('users as u', 'u.id', 'p.user_id').join('students as s', 's.id', 'sp.student_id')
    .select('u.id', 'u.name', 'u.role', 's.first_name', 's.last_name', 'sp.relation').where('u.status', 'active').where('s.status', 'active').orderBy('s.last_name');
  if (classIds) q.whereIn('s.class_id', classIds);
  const seen = new Map();
  for (const r of await q.all()) { if (!seen.has(r.id)) seen.set(r.id, { id: r.id, role: 'parent', name: `${r.name} (${utils.RELATIONS[r.relation] || 'ولی'} ${r.first_name} ${r.last_name})` }); }
  return [...seen.values()];
}
async function canSendTo(req, receiverId) {
  const groups = await recipientsFor(req);
  return groups.some((g) => g.users.some((u) => Number(u.id) === Number(receiverId)));
}
function listQuery(req, box) {
  const q = db.table('messages as m').join('users as s', 's.id', 'm.sender_id').join('users as r', 'r.id', 'm.receiver_id').select('m.*', 's.name as sender_name', 's.role as sender_role', 's.avatar as sender_avatar', 'r.name as receiver_name', 'r.role as receiver_role');
  if (box === 'sent') q.where('m.sender_id', req.user.id).where('m.deleted_by_sender', 0);
  else q.where('m.receiver_id', req.user.id).where('m.deleted_by_receiver', 0);
  return q;
}

router.get('/', async (req, res) => {
  const box = req.query.box === 'sent' ? 'sent' : 'inbox';
  const q = listQuery(req, box);
  if (req.query.q) q.search(utils.normalizePersian(req.query.q), ['m.subject', 'm.body', 's.name', 'r.name']);
  if (req.query.unread === '1' && box === 'inbox') q.where('m.is_read', 0);
  const result = await q.orderBy('m.id', 'desc').paginate(req.query.page, 20);
  const unread = await db.count('messages', { receiver_id: req.user.id, is_read: 0, deleted_by_receiver: 0 });
  res.render(v('index'), { title: 'پیام‌ها', result, box, unread, query: req.query, f: { q: req.query.q || '', unread: req.query.unread || '' }, canSend: req.user.role !== 'student' || E('messages.student_send') });
});
router.get('/compose', async (req, res) => {
  if (req.user.role === 'student' && !E('messages.student_send')) return res.status(403).render('errors/403', { title: 'غیرمجاز' });
  const groups = await recipientsFor(req);
  let reply = null;
  if (req.query.reply) { reply = await db.table('messages as m').join('users as s', 's.id', 'm.sender_id').select('m.*', 's.name as sender_name').where('m.id', req.query.reply).where((b) => b.where('m.receiver_id', req.user.id).orWhere('m.sender_id', req.user.id)).first(); }
  const classes = isStaff(req) || req.user.role === 'teacher' ? await db.table('classes').where('is_active', 1).orderBy('title').all() : [];
  res.render(v('compose'), { title: reply ? 'پاسخ به پیام' : 'پیام جدید', groups, reply, to: Number(req.query.to) || (reply ? (reply.sender_id === req.user.id ? reply.receiver_id : reply.sender_id) : null), classes, canBroadcast: E('messages.broadcast') && req.user.role !== 'student', ROLES: utils.ROLES, isStaff: isStaff(req) });
});
router.post('/compose', async (req, res) => {
  if (req.user.role === 'student' && !E('messages.student_send')) return res.status(403).render('errors/403', { title: 'غیرمجاز' });
  const b = utils.cleanBody(req.body, { fields: ['receiver_id', 'subject', 'body', 'parent_id', 'mode', 'class_id', 'role', 'target'] });
  if (!b.body) { req.flash('danger', 'متن پیام الزامی است'); req.keepInput(); return res.redirect('/messages/compose' + (b.receiver_id ? '?to=' + b.receiver_id : '')); }
  const subject = b.subject || 'بدون موضوع';
  let receivers = [];
  if (b.mode === 'class' && E('messages.broadcast') && req.user.role !== 'student') {
    if (req.user.role === 'teacher') { const t = await db.table('teachers').where('user_id', req.user.id).first(); const ok = t && ((await db.table('class_subjects').where({ teacher_id: t.id, class_id: Number(b.class_id) || 0 }).exists()) || (await db.table('classes').where({ teacher_id: t.id, id: Number(b.class_id) || 0 }).exists())); if (!ok) return res.status(403).render('errors/403', { title: 'غیرمجاز' }); }
    receivers = await db.table('students').where('class_id', Number(b.class_id) || 0).where('status', 'active').whereNotNull('user_id').pluck('user_id');
    if (b.target === 'parents' || b.target === 'both') {
      const pids = (await parentsOfClasses([Number(b.class_id) || 0])).map((u) => u.id);
      receivers = b.target === 'parents' ? pids : [...new Set(receivers.concat(pids))];
    }
  } else if (b.mode === 'role' && E('messages.broadcast') && isStaff(req)) {
    receivers = await db.table('users').where({ role: b.role || 'teacher', status: 'active' }).where('id', '!=', req.user.id).pluck('id');
  } else {
    if (!b.receiver_id || !(await canSendTo(req, b.receiver_id))) { req.flash('danger', 'گیرندهٔ نامعتبر'); return res.redirect('/messages/compose'); }
    receivers = [Number(b.receiver_id)];
  }
  if (!receivers.length) { req.flash('danger', 'گیرنده‌ای یافت نشد'); return res.redirect('/messages/compose'); }
  const now = db.now();
  const parentId = E('messages.threads') && b.parent_id ? Number(b.parent_id) : null;
  let firstId = null;
  for (const rid of receivers) { const id = await db.insert('messages', { sender_id: req.user.id, receiver_id: rid, subject, body: b.body, is_read: 0, parent_id: receivers.length === 1 ? parentId : null, deleted_by_sender: 0, deleted_by_receiver: 0, created_at: now }); if (!firstId) firstId = id; }
  if (E('messages.notify')) await notify.push(receivers, { title: 'پیام جدید از ' + req.user.name, body: subject, link: '/messages', type: 'info' });
  await activity.log(req, 'create', 'messages', firstId, `ارسال پیام «${subject}» به ${receivers.length} نفر`);
  req.flash('success', receivers.length > 1 ? `پیام برای ${J.toPersianDigits(receivers.length)} نفر ارسال شد.` : 'پیام ارسال شد.');
  res.redirect(receivers.length > 1 ? '/messages?box=sent' : '/messages/' + firstId);
});
router.get('/:id', async (req, res) => {
  const m = await db.table('messages as m').join('users as s', 's.id', 'm.sender_id').join('users as r', 'r.id', 'm.receiver_id').select('m.*', 's.name as sender_name', 's.role as sender_role', 's.avatar as sender_avatar', 'r.name as receiver_name', 'r.role as receiver_role').where('m.id', req.params.id).where((b) => b.where('m.receiver_id', req.user.id).orWhere('m.sender_id', req.user.id)).first();
  if (!m) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  if (m.receiver_id === req.user.id && !m.is_read) { await db.update('messages', { is_read: 1, read_at: db.now() }, { id: m.id }); m.is_read = 1; }
  let thread = [];
  if (E('messages.threads')) {
    const rootId = m.parent_id || m.id;
    thread = await db.table('messages as m').join('users as s', 's.id', 'm.sender_id').select('m.*', 's.name as sender_name', 's.role as sender_role', 's.avatar as sender_avatar').where((b) => b.where('m.id', rootId).orWhere('m.parent_id', rootId)).where((b) => b.where('m.receiver_id', req.user.id).orWhere('m.sender_id', req.user.id)).orderBy('m.id').all();
  }
  const other = m.sender_id === req.user.id ? { id: m.receiver_id, name: m.receiver_name, role: m.receiver_role } : { id: m.sender_id, name: m.sender_name, role: m.sender_role };
  res.render(v('show'), { title: m.subject, m, thread, other, canReply: (req.user.role !== 'student' || E('messages.student_send')) && (await canSendTo(req, other.id)), rootId: m.parent_id || m.id, ROLES: utils.ROLES });
});
router.post('/:id/delete', async (req, res) => {
  const m = await db.findById('messages', req.params.id);
  if (m) { if (m.receiver_id === req.user.id) await db.update('messages', { deleted_by_receiver: 1 }, { id: m.id }); if (m.sender_id === req.user.id) await db.update('messages', { deleted_by_sender: 1 }, { id: m.id }); const row = await db.findById('messages', m.id); if (row && row.deleted_by_receiver && row.deleted_by_sender) await db.remove('messages', { id: m.id }); req.flash('success', 'پیام حذف شد.'); }
  res.redirect('/messages');
});
router.post('/read-all', async (req, res) => { await db.table('messages').where({ receiver_id: req.user.id, is_read: 0 }).update({ is_read: 1, read_at: db.now() }); res.redirect('/messages'); });
module.exports = router;
