'use strict';
const path = require('path');
const express = require('express');
const db = require('../../core/db');
const auth = require('../../core/auth');
const modules = require('../../core/modules');
const notify = require('../../core/notify');
const activity = require('../../core/activity');
const utils = require('../../core/utils');
const J = require('../../core/jalali');
const settings = require('../../core/settings');

const router = express.Router();
const v = (n) => path.join(__dirname, 'views', n + '.ejs');
router.use(auth.requireAuth);
const ICONS = { info: 'bi-info-circle', success: 'bi-check-circle', warning: 'bi-exclamation-triangle', danger: 'bi-x-octagon' };
let lastCleanup = 0;
async function cleanup() {
  if (!modules.isEnabled('notifications.cleanup') || Date.now() - lastCleanup < 6 * 3600 * 1000) return;
  lastCleanup = Date.now();
  await db.table('notifications').where('is_read', 1).where('created_at', '<', J.addDays(J.todayISO(), -60)).delete();
}

router.get('/', async (req, res) => {
  await cleanup();
  const q = db.table('notifications').where('user_id', req.user.id).orderBy('id', 'desc');
  if (req.query.filter === 'unread') q.where('is_read', 0);
  const result = await q.paginate(req.query.page, 25);
  const unread = await notify.unreadCount(req.user.id);
  res.render(v('index'), { title: 'اعلان‌ها', result, unread, filter: req.query.filter || '', query: req.query, ICONS });
});
router.get('/latest', async (req, res) => {
  const rows = await db.table('notifications').where('user_id', req.user.id).orderBy('id', 'desc').limit(8).all();
  res.json({ unread: await notify.unreadCount(req.user.id), items: rows.map((n) => ({ id: n.id, title: n.title, body: n.body, link: '/notifications/' + n.id + '/open', is_read: n.is_read, icon: ICONS[n.type] || ICONS.info, time: J.timeAgo(n.created_at) })) });
});
router.get('/:id/open', async (req, res) => {
  const n = await db.findOne('notifications', { id: Number(req.params.id) || 0, user_id: req.user.id });
  if (!n) return res.redirect('/notifications');
  if (!n.is_read) await db.update('notifications', { is_read: 1 }, { id: n.id });
  res.redirect(n.link && n.link.startsWith('/') ? n.link : '/notifications');
});
router.post('/read-all', async (req, res) => { await db.table('notifications').where({ user_id: req.user.id, is_read: 0 }).update({ is_read: 1 }); req.flash('success', 'همهٔ اعلان‌ها خوانده شدند.'); res.redirect('/notifications'); });
router.post('/clear', async (req, res) => { await db.table('notifications').where({ user_id: req.user.id, is_read: 1 }).delete(); req.flash('success', 'اعلان‌های خوانده‌شده پاک شدند.'); res.redirect('/notifications'); });
router.post('/:id/read', async (req, res) => { await db.table('notifications').where({ id: Number(req.params.id) || 0, user_id: req.user.id }).update({ is_read: 1 }); if (auth.wantsJson(req)) return res.json({ ok: true }); res.redirect('/notifications'); });
router.post('/:id/delete', async (req, res) => { await db.table('notifications').where({ id: Number(req.params.id) || 0, user_id: req.user.id }).delete(); res.redirect('/notifications'); });

// ---------- ارسال دستی ----------
const sendGuards = [auth.requireRoleOrPermission(['admin'], 'notifications.send'), modules.requireEnabled('notifications.broadcast')];
async function sendForm(req, res, extra) {
  const classes = await db.table('classes').where('is_active', 1).orderBy('title').all();
  const users = await db.table('users').select('id', 'name', 'role', 'username').where('status', 'active').where('is_super', 0).orderBy('role').orderBy('name').all();
  res.render(v('send'), Object.assign({ title: 'ارسال اعلان', classes, users, ROLES: utils.ROLES, smsOn: modules.isEnabled('notifications.sms') && settings.getBool('sms_enabled'), emailOn: modules.isEnabled('notifications.email') && settings.getBool('email_enabled'), form: {} }, extra || {}));
}
router.get('/send', ...sendGuards, (req, res) => sendForm(req, res));
router.post('/send', ...sendGuards, async (req, res) => {
  const b = utils.cleanBody(req.body, { fields: ['audience', 'role', 'class_id', 'user_id', 'title', 'body', 'link', 'type', 'sms', 'email'] });
  if (!b.title) { req.flash('danger', 'عنوان الزامی است'); return res.redirect('/notifications/send'); }
  let uids = [];
  let phones = []; let emails = [];
  if (b.audience === 'role') uids = await db.table('users').where({ role: b.role || 'student', status: 'active', is_super: 0 }).pluck('id');
  else if (b.audience === 'class') { const studs = await db.table('students').where('class_id', Number(b.class_id) || 0).where('status', 'active').all(); uids = studs.map((s) => s.user_id).filter(Boolean); phones = studs.map((s) => s.father_phone || s.mobile || s.guardian_phone).filter(Boolean); }
  else if (b.audience === 'user') uids = [Number(b.user_id) || 0];
  else uids = await db.table('users').where('status', 'active').where('is_super', 0).pluck('id');
  if (b.audience !== 'class') { const us = await db.table('users').whereIn('id', uids).all(); phones = us.map((u) => u.phone).filter(Boolean); emails = us.map((u) => u.email).filter(Boolean); }
  const n = await notify.push(uids, { title: b.title, body: b.body, link: b.link && b.link.startsWith('/') ? b.link : null, type: ['info', 'success', 'warning', 'danger'].includes(b.type) ? b.type : 'info' });
  let extra = '';
  if (b.sms === '1' && phones.length) { const r = await notify.sms(phones, `${settings.get('school_name', '')}\n${b.title}\n${b.body || ''}`.trim(), 'broadcast'); extra += r.ok ? ` پیامک به ${J.toPersianDigits(phones.length)} شماره ارسال شد.` : ` (پیامک ارسال نشد: ${r.error || r.status || 'غیرفعال'})`; }
  if (b.email === '1' && emails.length) { const r = await notify.email(emails.join(','), b.title, `<p>${utils.escapeHtml(b.body || '')}</p>`); extra += r.ok ? ' ایمیل ارسال شد.' : ` (ایمیل ارسال نشد: ${r.error || 'غیرفعال'})`; }
  await activity.log(req, 'notify', 'notifications', null, `ارسال اعلان «${b.title}» به ${n} کاربر`);
  req.flash('success', `اعلان برای ${J.toPersianDigits(n)} کاربر ثبت شد.` + extra);
  res.redirect('/notifications/send');
});

module.exports = router;
