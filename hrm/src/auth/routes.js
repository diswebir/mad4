'use strict';
/**
 * احراز هویت کارکنان: ورود با نام کاربری/رمز، خروج، پروفایل، تغییر رمز، پوسته، ورود به جای کاربر
 * (ورود متقاضیان با موبایل + کد پیامکی در ماژول recruitment → /apply/login)
 */
const path = require('path');
const express = require('express');
const db = require('../core/db');
const auth = require('../core/auth');
const settings = require('../core/settings');
const modules = require('../core/modules');
const activity = require('../core/activity');
const utils = require('../core/utils');
const J = require('../core/jalali');
const upload = require('../core/upload');
const { relPath, removeFile } = upload;

const router = express.Router();
const v = (n) => path.join(__dirname, 'views', n + '.ejs');

function makeCaptcha(req) {
  if (!modules.isEnabled('system.login_captcha')) { req.session.captcha = null; return null; }
  const a = Math.floor(Math.random() * 9) + 1, b = Math.floor(Math.random() * 9) + 1;
  req.session.captcha = a + b;
  return { a, b };
}
function demoInfo() { return settings.getBool('demo_mode') ? { users: ['hrmanager', 'hrstaff', 'employee1'], pass: '123456' } : null; }
const minPwLen = () => Math.min(32, Math.max(6, settings.getInt('password_min_length', 8)));

router.get('/login', auth.requireGuest, (req, res) => {
  res.render(v('login'), { layout: 'layouts/auth', title: 'ورود کارکنان', captcha: makeCaptcha(req), demo: demoInfo() });
});

router.post('/login', auth.requireGuest, async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const fail = (msg) => { req.flash('danger', msg); req.keepInput(); return res.redirect('/auth/login'); };
  const locked = auth.isLocked(req, username);
  if (locked) return fail(`به دلیل تلاش‌های ناموفق متعدد، ورود برای ${J.toPersianDigits(locked)} دقیقه مسدود شده است.`);
  if (req.session.captcha != null) {
    const ans = parseInt(J.toEnglishDigits(req.body.captcha || ''), 10);
    if (ans !== req.session.captcha) { req.session.captcha = null; return fail('پاسخ سؤال امنیتی نادرست است.'); }
  }
  const result = await auth.authenticate(username, password);
  if (result.ok && result.user.role === 'applicant') { result.ok = false; result.reason = 'applicant'; }
  if (!result.ok) {
    await auth.logLogin(req, result.user, username, false);
    if (result.reason === 'inactive') return fail('حساب کاربری شما غیرفعال است. با مدیر سامانه تماس بگیرید.');
    if (result.reason === 'applicant') return fail('متقاضیان از صفحهٔ «ورود متقاضیان» با شمارهٔ موبایل وارد می‌شوند.');
    let msg = 'نام کاربری یا رمز عبور نادرست است.';
    const left = auth.recordFailure(req, username); if (left > 0 && left <= 2) msg += ` (${J.toPersianDigits(left)} تلاش باقی‌مانده)`;
    return fail(msg);
  }
  auth.clearFailures(req, username);
  const returnTo = req.session.returnTo;
  await auth.login(req, result.user, req.body.remember === '1');
  await auth.logLogin(req, result.user, username, true);
  await activity.log(req, 'login', 'user', result.user.id, 'ورود به سامانه');
  if (result.user.must_change_password) return res.redirect('/auth/password?force=1');
  res.redirect(returnTo && returnTo.startsWith('/') && !returnTo.startsWith('/auth') ? returnTo : '/dashboard');
});

router.post('/logout', async (req, res) => {
  const wasApplicant = req.user && req.user.role === 'applicant';
  if (req.user) await activity.log(req, 'logout', 'user', req.user.id, 'خروج از سامانه');
  await auth.logout(req);
  res.redirect(wasApplicant ? '/apply' : '/auth/login');
});
router.get('/logout', (req, res) => res.redirect('/'));

router.post('/theme', (req, res) => {
  const theme = req.body.theme === 'dark' ? 'dark' : 'light';
  if (req.session) req.session.theme = theme;
  if (req.user) db.update('users', { theme }, { id: req.user.id }).catch(() => {});
  res.json({ ok: true });
});

router.get('/password', auth.requireAuth, (req, res) => {
  if (req.user.role === 'applicant') return res.redirect('/portal');
  res.render(v('password'), { title: 'تغییر رمز عبور', force: !!req.user.must_change_password, minLen: minPwLen() });
});
router.post('/password', auth.requireAuth, async (req, res) => {
  const user = await db.findById('users', req.user.id);
  const force = !!user.must_change_password;
  if (!force && !(await auth.verifyPassword(req.body.current, user.password))) { req.flash('danger', 'رمز عبور فعلی نادرست است.'); return res.redirect('/auth/password'); }
  const pw = String(req.body.password || '');
  if (pw.length < minPwLen()) { req.flash('danger', `رمز عبور باید حداقل ${J.toPersianDigits(minPwLen())} کاراکتر باشد.`); return res.redirect('/auth/password' + (force ? '?force=1' : '')); }
  if (pw !== req.body.password2) { req.flash('danger', 'تکرار رمز عبور مطابقت ندارد.'); return res.redirect('/auth/password' + (force ? '?force=1' : '')); }
  await db.update('users', { password: await auth.hashPassword(pw, user.is_super ? 12 : 10), must_change_password: 0, updated_at: db.now() }, { id: user.id });
  await activity.log(req, 'password', 'user', user.id, 'تغییر رمز عبور');
  req.flash('success', 'رمز عبور با موفقیت تغییر کرد.');
  res.redirect('/dashboard');
});

router.get('/profile', auth.requireAuth, async (req, res) => {
  const logins = await db.table('login_logs').where('user_id', req.user.id).orderBy('id', 'desc').limit(8).all();
  const roleRow = req.user.role_id ? await db.findById('roles', req.user.role_id) : await db.table('roles').where('key', req.user.role).first();
  res.render(v('profile'), { title: 'پروفایل من', logins, roleRow });
});
router.post('/profile', auth.requireAuth, ...upload.form('avatars', 'single', 'avatar', { images: true, maxMb: 3, maxFiles: 1 }), async (req, res) => {
  if (req.uploadError) { req.flash('danger', req.uploadError); return res.redirect('/auth/profile'); }
  const data = utils.cleanBody(req.body, { fields: ['email', 'theme'] });
  if (req.body.name) data.name = utils.normalizePersian(req.body.name);
  if (req.user.role !== 'applicant' && req.body.mobile !== undefined) data.mobile = req.body.mobile ? utils.normalizePhone(req.body.mobile) : null;
  if (data.email && !utils.isValidEmail(data.email)) { req.flash('danger', 'ایمیل معتبر نیست.'); return res.redirect('/auth/profile'); }
  if (data.mobile && !utils.isValidMobile(data.mobile)) { req.flash('danger', 'شمارهٔ موبایل معتبر نیست.'); return res.redirect('/auth/profile'); }
  if (req.file) { removeFile(req.user.avatar); data.avatar = relPath(req.file); }
  if (data.theme && !['light', 'dark'].includes(data.theme)) data.theme = null;
  data.updated_at = db.now();
  await db.update('users', data, { id: req.user.id });
  req.flash('success', 'پروفایل به‌روزرسانی شد.');
  res.redirect('/auth/profile');
});

/** ورود به جای کاربر (مدیر ارشد یا دارندهٔ users.manage؛ فقط به جای کاربران غیرِ مدیر ارشد) */
router.post('/impersonate/stop', async (req, res) => {
  if (!req.session.impersonatorId) return res.redirect('/dashboard');
  const admin = await db.findById('users', req.session.impersonatorId);
  if (!admin || admin.status !== 'active') { await auth.logout(req); return res.redirect('/auth/login'); }
  if (req.user) await activity.log(req, 'impersonate', 'user', req.user.id, `پایان ورود به جای ${req.user.name}`);
  await auth.login(req, admin, false);
  delete req.session.impersonatorId;
  req.session.save(() => res.redirect('/users'));
});
router.post('/impersonate/:id', auth.requirePermission('users.manage'), modules.requireEnabled('users.impersonate'), async (req, res) => {
  if (req.session.impersonatorId) { req.flash('danger', 'ابتدا به حساب خودتان بازگردید.'); return res.redirect(req.get('referer') || '/'); }
  const target = await db.findById('users', req.params.id);
  const blocked = !target || target.id === req.user.id || Number(target.is_super) || target.status !== 'active' || (!req.user.is_super && target.role === 'hr_manager');
  if (blocked) { req.flash('danger', 'امکان ورود به جای این کاربر وجود ندارد.'); return res.redirect(req.get('referer') || '/'); }
  const adminId = req.user.id;
  await activity.log(req, 'impersonate', 'user', target.id, `ورود به جای ${target.name}`);
  await auth.login(req, target, false);
  req.session.impersonatorId = adminId;
  req.session.save(() => res.redirect(auth.homeFor(target)));
});

module.exports = router;
