'use strict';
/** ماژول اعلان‌ها: اعلان درون‌برنامه‌ای، پیامک (IPPanel)، ارسال گروهی، لاگ پیامک */
const path = require('path');
const express = require('express');
const db = require('../../core/db');
const auth = require('../../core/auth');
const settings = require('../../core/settings');
const utils = require('../../core/utils');
const J = require('../../core/jalali');
const modules = require('../../core/modules');
const notify = require('../../core/notify');
const sms = require('../../core/sms');
const activity = require('../../core/activity');

const router = express.Router();
const v = (n) => path.join(__dirname, 'views', n + '.ejs');
router.use(auth.requireAuth);

router.get('/latest', async (req, res) => {
  const rows = modules.isEnabled('notifications.inapp') ? await db.table('notifications').where('user_id', req.user.id).orderBy('id', 'desc').limit(8).all() : [];
  res.json({ ok: true, unread: rows.filter((r) => !r.is_read).length, items: rows.map((r) => ({ id: r.id, title: r.title, body: r.body, link: r.link ? '/notifications/go/' + r.id : null, type: r.type, is_read: !!r.is_read, ago: J.timeAgo ? J.timeAgo(r.created_at) : J.formatDateTime(r.created_at) })) });
});
router.get('/go/:id', async (req, res) => {
  const n = await db.table('notifications').where('id', req.params.id).where('user_id', req.user.id).first();
  if (n) await db.update('notifications', { is_read: 1 }, { id: n.id });
  res.redirect(n && n.link ? n.link : '/notifications');
});
router.post('/read-all', async (req, res) => {
  await db.table('notifications').where('user_id', req.user.id).where('is_read', 0).update({ is_read: 1 });
  if (req.xhr || (req.get('accept') || '').includes('json')) return res.json({ ok: true });
  res.redirect('/notifications');
});
router.post('/:id/read', async (req, res) => { await db.table('notifications').where('id', req.params.id).where('user_id', req.user.id).update({ is_read: 1 }); res.json({ ok: true }); });

router.get('/', async (req, res) => {
  if (req.user.role === 'applicant') res.locals.layout = 'layouts/public';
  const result = await db.table('notifications').where('user_id', req.user.id).orderBy('id', 'desc').paginate(req.query.page, 25);
  res.render(v('index'), { title: 'اعلان‌ها', result });
});
router.post('/clear', async (req, res) => { await db.table('notifications').where('user_id', req.user.id).where('is_read', 1).delete(); req.flash('success', 'اعلان‌های خوانده‌شده پاک شد.'); res.redirect('/notifications'); });

// ---------- ارسال اعلان/پیامک (HR) ----------
router.get('/send', auth.requirePermission('notifications.send'), async (req, res) => {
  const roles = await require('../../core/permissions').roles();
  res.render(v('send'), { title: 'ارسال اعلان و پیامک', roles, smsOn: modules.isEnabled('notifications.sms') && settings.getBool('sms_enabled'), balance: null, statuses: utils.APP_STATUS });
});
router.post('/send', auth.requirePermission('notifications.send'), async (req, res) => {
  const b = req.body;
  const title = utils.normalizePersian(b.title), body = utils.normalizePersian(b.body);
  if (!body) { req.flash('danger', 'متن پیام الزامی است.'); req.keepInput(); return res.redirect('/notifications/send'); }
  let users = [];
  if (b.target === 'role') users = await db.table('users').where('status', 'active').where('role', b.role).all();
  else if (b.target === 'all_staff') users = await db.table('users').where('status', 'active').whereNotIn('role', ['applicant']).all();
  else if (b.target === 'applicants') {
    const q = db.table('applications').whereNotIn('status', ['draft', 'archived']);
    if (b.app_status) q.where('status', b.app_status);
    if (b.position_id) q.where('position_id', parseInt(b.position_id, 10) || 0);
    const apps = await q.all();
    users = apps.map((a) => ({ id: a.user_id, mobile: a.mobile, name: [a.first_name, a.last_name].filter(Boolean).join(' ') }));
  } else if (b.target === 'mobiles') users = String(b.mobiles || '').split(/[\s,،]+/).map((m) => utils.normalizePhone(m)).filter((m) => utils.isValidMobile(m)).map((m) => ({ id: null, mobile: m }));
  users = users.filter((u, i, arr) => arr.findIndex((x) => (x.id && x.id === u.id) || (!x.id && x.mobile === u.mobile)) === i);
  if (!users.length) { req.flash('warning', 'گیرنده‌ای یافت نشد.'); return res.redirect('/notifications/send'); }
  let inapp = 0, smsN = 0, fail = 0;
  if (b.channel_inapp === '1' && title) inapp = await notify.push(users.map((u) => u.id).filter(Boolean), { title, body, link: b.link || null, type: 'info' });
  if (b.channel_sms === '1' && modules.isEnabled('notifications.sms')) {
    const mobiles = users.map((u) => u.mobile).filter((m) => utils.isValidMobile(m));
    const chunks = []; for (let i = 0; i < mobiles.length; i += 90) chunks.push(mobiles.slice(i, i + 90));
    for (const chunk of chunks) { const r = await sms.send(chunk, body, { kind: 'broadcast', userId: req.user.id }); if (r.ok) smsN += chunk.length; else fail += chunk.length; }
  }
  await activity.log(req, 'create', 'notification', null, `ارسال گروهی: ${inapp} اعلان، ${smsN} پیامک`);
  req.flash(fail ? 'warning' : 'success', `ارسال شد: ${J.toPersianDigits(inapp)} اعلان درون‌برنامه‌ای، ${J.toPersianDigits(smsN)} پیامک${fail ? `، ${J.toPersianDigits(fail)} ناموفق` : ''}.`);
  res.redirect('/notifications/send');
});

// ---------- لاگ پیامک ----------
router.get('/sms-log', auth.requirePermission('logs.view'), async (req, res) => {
  const q = db.table('sms_logs');
  if (req.query.q) q.search(J.toEnglishDigits(req.query.q), ['mobile', 'message']);
  if (req.query.status) q.where('status', req.query.status);
  const result = await q.orderBy('id', 'desc').paginate(req.query.page, 30);
  const totals = {}; (await db.table('sms_logs').select('status', 'COUNT(*) AS c').groupBy('status').all()).forEach((r) => (totals[r.status] = r.c));
  res.render(v('sms-log'), { title: 'گزارش پیامک‌ها', result, totals, query: req.query });
});
router.post('/sms-log/test', auth.requirePermission('settings.manage'), async (req, res) => {
  const mobile = utils.normalizePhone(req.body.mobile || req.user.mobile);
  if (!utils.isValidMobile(mobile)) { req.flash('danger', 'شمارهٔ موبایل معتبر وارد کنید.'); return res.redirect('/notifications/sms-log'); }
  const r = await sms.send(mobile, `پیامک آزمایشی ${settings.get('company_short_name') || settings.get('company_name')} — ${J.formatDateTime(J.nowISO())}`, { kind: 'test', userId: req.user.id });
  req.flash(r.ok ? 'success' : 'danger', r.ok ? 'پیامک آزمایشی ارسال شد.' : 'ارسال ناموفق: ' + (r.error || 'نامشخص'));
  res.redirect('/notifications/sms-log');
});
router.post('/sms-log/:id/retry', auth.requirePermission('notifications.send'), async (req, res) => {
  const row = await db.findById('sms_logs', req.params.id);
  if (row) { const r = await sms.send(row.mobile, row.message, { kind: row.kind, userId: row.user_id }); req.flash(r.ok ? 'success' : 'danger', r.ok ? 'دوباره ارسال شد.' : 'ناموفق: ' + (r.error || '')); }
  res.redirect('/notifications/sms-log');
});

module.exports = {
  key: 'notifications', name: 'اعلان و پیامک', icon: 'bi-bell', category: 'communication', order: 60,
  description: 'اعلان‌های درون‌برنامه‌ای، پیامک از طریق IPPanel، ارسال گروهی و گزارش پیامک',
  mount: ['/notifications'], routes: [router],
  features: [
    { key: 'inapp', name: 'اعلان درون‌برنامه‌ای', description: 'زنگولهٔ اعلان‌ها در نوار بالا' },
    { key: 'sms', name: 'پیامک (IPPanel)', description: 'ارسال کد تأیید، وضعیت پرونده و پیام‌های گروهی' },
    { key: 'broadcast', name: 'ارسال گروهی', description: 'ارسال اعلان/پیامک به گروه‌های کاربران' }
  ],
  menu: [
    { href: '/notifications', title: 'اعلان‌های من', icon: 'bi-bell', match: '/notifications', feature: 'inapp' },
    { href: '/notifications/send', title: 'ارسال اعلان و پیامک', icon: 'bi-send', match: '/notifications/send', permission: 'notifications.send', feature: 'broadcast' },
    { href: '/notifications/sms-log', title: 'گزارش پیامک‌ها', icon: 'bi-chat-left-text', match: '/notifications/sms-log', permission: 'logs.view', feature: 'sms' }
  ],
  jobs: [
    { key: 'notifications.cleanup', name: 'پاک‌سازی اعلان‌های قدیمی', description: 'حذف اعلان‌های خوانده‌شدهٔ قدیمی‌تر از ۹۰ روز و کدهای OTP منقضی', schedule: 'daily', defaultTime: '04:00',
      run: async () => { const before = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 19).replace('T', ' '); const n = await db.table('notifications').where('is_read', 1).where('created_at', '<', before).delete(); await require('../../core/otp').cleanup(); return `${n} اعلان حذف شد`; } }
  ]
};
