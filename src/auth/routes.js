'use strict';
/**
 * احراز هویت: ورود، خروج، پروفایل، تغییر رمز، پوسته، ورود به جای کاربر
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
  if (!modules.isEnabled('auth.captcha') || !settings.getBool('login_captcha')) { req.session.captcha = null; return null; }
  const a = Math.floor(Math.random() * 9) + 1, b = Math.floor(Math.random() * 9) + 1;
  req.session.captcha = a + b;
  return { a, b };
}
function demoInfo() {
  if (!settings.getBool('demo_mode')) return null;
  return { admin: settings.get('demo_admin_username', 'admin'), adminPass: settings.get('demo_admin_password', 'admin123'), teacher: settings.get('demo_teacher_username', 'teacher1'), student: settings.get('demo_student_username', '40001'), pass: settings.get('demo_user_password', '123456') };
}

router.get('/login', auth.requireGuest, (req, res) => {
  res.render(v('login'), { layout: 'layouts/auth', title: 'ورود', captcha: makeCaptcha(req), demo: demoInfo() });
});

router.post('/login', auth.requireGuest, async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const fail = (msg) => { req.flash('danger', msg); req.keepInput(); return res.redirect('/auth/login'); };
  if (modules.isEnabled('auth.login_throttle')) {
    const locked = auth.isLocked(req, username);
    if (locked) return fail(`به دلیل تلاش‌های ناموفق متعدد، ورود برای ${J.toPersianDigits(locked)} دقیقه مسدود شده است.`);
  }
  if (req.session.captcha != null) {
    const ans = parseInt(J.toEnglishDigits(req.body.captcha || ''), 10);
    if (ans !== req.session.captcha) { req.session.captcha = null; return fail('پاسخ سؤال امنیتی نادرست است.'); }
  }
  const result = await auth.authenticate(username, password);
  if (!result.ok) {
    await auth.logLogin(req, result.user, username, false);
    if (result.reason === 'inactive') return fail('حساب کاربری شما غیرفعال است. با مدیر تماس بگیرید.');
    let msg = 'نام کاربری یا رمز عبور نادرست است.';
    if (modules.isEnabled('auth.login_throttle')) { const left = auth.recordFailure(req, username); if (left > 0 && left <= 2) msg += ` (${J.toPersianDigits(left)} تلاش باقی‌مانده)`; }
    return fail(msg);
  }
  auth.clearFailures(req, username);
  const returnTo = req.session.returnTo;
  await auth.login(req, result.user, modules.isEnabled('auth.remember_me') && req.body.remember === '1');
  await auth.logLogin(req, result.user, username, true);
  await activity.log(req, 'login', 'user', result.user.id, 'ورود به سامانه');
  if (result.user.must_change_password && modules.isEnabled('auth.force_password_change')) return res.redirect('/auth/password?force=1');
  res.redirect(returnTo && returnTo.startsWith('/') && !returnTo.startsWith('/auth') ? returnTo : '/dashboard');
});

router.post('/logout', async (req, res) => {
  if (req.user) await activity.log(req, 'logout', 'user', req.user.id, 'خروج از سامانه');
  await auth.logout(req);
  res.redirect('/auth/login');
});
router.get('/logout', (req, res) => res.redirect('/dashboard'));

router.post('/theme', (req, res) => {
  const theme = req.body.theme === 'dark' ? 'dark' : 'light';
  if (req.session) req.session.theme = theme;
  if (req.user) db.update('users', { theme }, { id: req.user.id }).catch(() => {});
  res.json({ ok: true });
});

router.get('/password', auth.requireAuth, (req, res) => {
  res.render(v('password'), { title: 'تغییر رمز عبور', force: !!req.user.must_change_password });
});
router.post('/password', auth.requireAuth, async (req, res) => {
  const user = await db.findById('users', req.user.id);
  const force = !!user.must_change_password;
  if (!force) {
    if (!(await auth.verifyPassword(req.body.current, user.password))) { req.flash('danger', 'رمز عبور فعلی نادرست است.'); return res.redirect('/auth/password'); }
  }
  const pw = String(req.body.password || '');
  if (pw.length < 6) { req.flash('danger', 'رمز عبور باید حداقل ۶ کاراکتر باشد.'); return res.redirect('/auth/password' + (force ? '?force=1' : '')); }
  if (pw !== req.body.password2) { req.flash('danger', 'تکرار رمز عبور مطابقت ندارد.'); return res.redirect('/auth/password' + (force ? '?force=1' : '')); }
  await db.update('users', { password: await auth.hashPassword(pw), must_change_password: 0, updated_at: db.now() }, { id: user.id });
  await activity.log(req, 'password', 'user', user.id, 'تغییر رمز عبور');
  req.flash('success', 'رمز عبور با موفقیت تغییر کرد.');
  res.redirect('/dashboard');
});

router.get('/profile', auth.requireAuth, async (req, res) => {
  let profile = null;
  if (req.user.role === 'student') profile = await db.table('students as s').select('s.*', 'c.title as class_title').leftJoin('classes as c', 's.class_id', 'c.id').where('s.user_id', req.user.id).first();
  if (req.user.role === 'teacher') profile = await db.table('teachers').where('user_id', req.user.id).first();
  const logins = modules.isEnabled('auth.login_history') ? await db.table('login_logs').where('user_id', req.user.id).orderBy('id', 'desc').limit(8).all() : [];
  res.render(v('profile'), { title: 'پروفایل من', profile, logins });
});
router.post('/profile', auth.requireAuth, ...upload.form('avatars', 'single', 'avatar', { images: true, maxMb: 3, maxFiles: 1 }), async (req, res) => {
  if (!modules.isEnabled('users.profile')) return res.redirect('/auth/profile');
  if (req.uploadError) { req.flash('danger', req.uploadError); return res.redirect('/auth/profile'); }
  const data = utils.cleanBody(req.body, { fields: ['email', 'phone', 'theme'] });
  if (req.user.role !== 'student' && req.body.name) data.name = utils.normalizePersian(req.body.name);
  if (data.email && !utils.isValidEmail(data.email)) { req.flash('danger', 'ایمیل معتبر نیست.'); return res.redirect('/auth/profile'); }
  if (data.phone) data.phone = utils.normalizePhone(data.phone);
  if (req.file) { removeFile(req.user.avatar); data.avatar = relPath(req.file); }
  if (data.theme && !['light', 'dark'].includes(data.theme)) data.theme = null;
  data.updated_at = db.now();
  await db.update('users', data, { id: req.user.id });
  if (req.user.role === 'teacher' && data.phone) await db.update('teachers', { updated_at: db.now() }, { user_id: req.user.id });
  req.flash('success', 'پروفایل به‌روزرسانی شد.');
  res.redirect('/auth/profile');
});

/** ورود به جای کاربر (فقط مدیر) */
router.post('/impersonate/stop', async (req, res) => {
  if (!req.session.impersonatorId) return res.redirect('/dashboard');
  const admin = await db.findById('users', req.session.impersonatorId);
  if (!admin) return res.redirect('/auth/login');
  await auth.login(req, admin, false);
  delete req.session.impersonatorId;
  req.session.save(() => res.redirect('/dashboard'));
});
router.post('/impersonate/:id', auth.requireAdmin, modules.requireEnabled('auth.impersonate'), async (req, res) => {
  const target = await db.findById('users', req.params.id);
  if (!target || target.role === 'admin') { req.flash('danger', 'امکان ورود به جای این کاربر وجود ندارد.'); return res.redirect(req.get('referer') || '/'); }
  const adminId = req.user.id;
  await activity.log(req, 'impersonate', 'user', target.id, `ورود به جای ${target.name}`);
  await auth.login(req, target, false);
  req.session.impersonatorId = adminId;
  req.session.save(() => res.redirect('/dashboard'));
});

module.exports = router;
