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
const crypto = require('crypto');
const notify = require('../core/notify');

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
  return { admin: settings.get('demo_admin_username', 'admin'), adminPass: settings.get('demo_admin_password', 'admin123'), teacher: settings.get('demo_teacher_username', 'teacher1'), student: settings.get('demo_student_username', '40001'), staff: settings.get('demo_staff_username', ''), parent: settings.get('demo_parent_username', ''), pass: settings.get('demo_user_password', '123456') };
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

// ---------- بازیابی رمز عبور (فراموشی رمز) ----------
const RESET_TTL_MIN = 10, RESET_MAX_PER_HOUR = 3, RESET_MAX_ATTEMPTS = 5;
const resetEnabled = () => modules.isEnabled('auth.password_reset') && settings.getBool('password_reset_enabled');
const hashCode = (code, salt) => crypto.createHash('sha256').update(String(code) + '|' + salt).digest('hex');
const maskPhone = (p) => p ? p.slice(0, 4) + '***' + p.slice(-3) : '';
const maskEmail = (e) => { const [u, d] = String(e).split('@'); return u.slice(0, 2) + '***@' + (d || ''); };
const minPwLen = () => Math.min(32, Math.max(4, settings.getInt('password_min_length', 6)));
/** شماره‌ها/ایمیل‌های معتبر برای تحویل کد به یک کاربر (بر اساس نقش) */
async function resetTargets(user) {
  const phones = new Set(), emails = new Set();
  const addP = (p) => { p = utils.normalizePhone(p); if (/^09\d{9}$/.test(p)) phones.add(p); };
  const addE = (e) => { e = String(e || '').trim().toLowerCase(); if (utils.isValidEmail(e)) emails.add(e); };
  addP(user.phone); addE(user.email);
  if (user.role === 'student') { const st = await db.table('students').where('user_id', user.id).first(); if (st) { [st.mobile, st.father_phone, st.mother_phone, st.guardian_phone].forEach(addP); addE(st.email); } }
  else if (user.role === 'parent') { const pr = await db.table('parents').where('user_id', user.id).first(); if (pr) addP(pr.phone); }
  else if (user.role === 'teacher') { const t = await db.table('teachers').where('user_id', user.id).first(); if (t) addP(t.phone2); }
  return { phones: [...phones], emails: [...emails] };
}
function guardReset(req, res, next) {
  if (!resetEnabled()) return res.status(404).render('errors/404', { title: 'یافت نشد', layout: 'layouts/auth' });
  next();
}
router.get('/forgot', auth.requireGuest, guardReset, (req, res) => {
  const smsOn = modules.isEnabled('notifications.sms') && settings.getBool('sms_enabled');
  const emailOn = modules.isEnabled('notifications.email') && settings.getBool('email_enabled');
  res.render(v('forgot'), { layout: 'layouts/auth', title: 'بازیابی رمز عبور', smsOn, emailOn, captcha: makeCaptcha(req) });
});
router.post('/forgot', auth.requireGuest, guardReset, async (req, res) => {
  const fail = (msg) => { req.flash('danger', msg); req.keepInput(); return res.redirect('/auth/forgot'); };
  if (req.session.captcha != null) {
    const ans = parseInt(J.toEnglishDigits(req.body.captcha || ''), 10);
    if (ans !== req.session.captcha) { req.session.captcha = null; return fail('پاسخ سؤال امنیتی نادرست است.'); }
  }
  const username = utils.normalizePersian(J.toEnglishDigits(String(req.body.username || ''))).trim();
  const contact = String(req.body.contact || '').trim();
  if (!username || !contact) return fail('نام کاربری و شمارهٔ موبایل (یا ایمیل) ثبت‌شده را وارد کنید.');
  const ip = auth.clientIp(req);
  const since = new Date(Date.now() - 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const ipCount = await db.table('password_resets').where('ip', ip).where('created_at', '>=', since).count();
  if (ipCount >= RESET_MAX_PER_HOUR * 3) return fail('تعداد درخواست‌های بازیابی از این دستگاه بیش از حد مجاز است. یک ساعت بعد دوباره تلاش کنید.');
  const smsOn = modules.isEnabled('notifications.sms') && settings.getBool('sms_enabled');
  const emailOn = modules.isEnabled('notifications.email') && settings.getBool('email_enabled');
  const user = await db.table('users').where('username', username).first();
  let channel = null, target = null;
  if (user && user.status === 'active') {
    const t = await resetTargets(user);
    const asPhone = utils.normalizePhone(contact), asEmail = contact.toLowerCase();
    if (smsOn && t.phones.includes(asPhone)) { channel = 'sms'; target = asPhone; }
    else if (emailOn && t.emails.includes(asEmail)) { channel = 'email'; target = asEmail; }
  }
  // پاسخ یکسان برای جلوگیری از شناسایی حساب‌ها؛ در صورت عدم تطابق، نشست «ساختگی» ایجاد می‌شود
  if (!channel) {
    await db.insert('password_resets', { user_id: user ? user.id : null, code_hash: 'x', channel: 'none', target: contact.slice(0, 150), expires_at: db.now(), attempts: 0, ip, created_at: db.now() });
    req.session.pwreset = { fake: true, hint: smsOn ? maskPhone(utils.normalizePhone(contact)) : maskEmail(contact), channel: smsOn ? 'sms' : 'email' };
    return res.redirect('/auth/forgot/verify');
  }
  const userCount = await db.table('password_resets').where('user_id', user.id).where('created_at', '>=', since).count();
  if (userCount >= RESET_MAX_PER_HOUR) return fail(`برای این حساب در یک ساعت گذشته ${J.toPersianDigits(RESET_MAX_PER_HOUR)} بار کد ارسال شده است. کمی بعد دوباره تلاش کنید یا با مدیر مدرسه تماس بگیرید.`);
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const salt = crypto.randomBytes(8).toString('hex');
  const expires = new Date(Date.now() + RESET_TTL_MIN * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const id = await db.insert('password_resets', { user_id: user.id, code_hash: salt + ':' + hashCode(code, salt), channel, target, expires_at: expires, attempts: 0, ip, created_at: db.now() });
  const school = settings.get('school_name', 'مدرسه');
  const text = `${school}\nکد بازیابی رمز عبور: ${code}\nاعتبار: ${J.toPersianDigits(RESET_TTL_MIN)} دقیقه. اگر شما درخواست نداده‌اید، این پیام را نادیده بگیرید.`;
  let sent;
  if (channel === 'sms') sent = await notify.sms(target, text, 'password_reset', { logText: `${school}\nکد بازیابی رمز عبور: ******` });
  else sent = await notify.email(target, 'کد بازیابی رمز عبور — ' + school, `<p>کد بازیابی رمز عبور شما: <strong style="font-size:1.4em;letter-spacing:3px">${code}</strong></p><p>اعتبار این کد ${J.toPersianDigits(RESET_TTL_MIN)} دقیقه است.</p>`);
  if (!sent || sent.ok === false) { await db.remove('password_resets', { id }); return fail('ارسال کد با خطا مواجه شد. لطفاً با مدیر مدرسه تماس بگیرید.'); }
  await activity.log(Object.assign(req, { user: { id: user.id, name: user.name, role: user.role } }), 'password_reset_request', 'user', user.id, `درخواست بازیابی رمز (${channel === 'sms' ? maskPhone(target) : maskEmail(target)})`);
  req.user = null;
  req.session.pwreset = { id, user_id: user.id, channel, hint: channel === 'sms' ? maskPhone(target) : maskEmail(target) };
  res.redirect('/auth/forgot/verify');
});
router.get('/forgot/verify', auth.requireGuest, guardReset, (req, res) => {
  const st = req.session.pwreset;
  if (!st) return res.redirect('/auth/forgot');
  res.render(v('forgot-verify'), { layout: 'layouts/auth', title: 'تأیید کد و رمز جدید', hint: st.hint, channel: st.channel, ttl: RESET_TTL_MIN, minLen: minPwLen() });
});
router.post('/forgot/verify', auth.requireGuest, guardReset, async (req, res) => {
  const st = req.session.pwreset;
  if (!st) return res.redirect('/auth/forgot');
  const fail = (msg) => { req.flash('danger', msg); return res.redirect('/auth/forgot/verify'); };
  const code = J.toEnglishDigits(String(req.body.code || '')).replace(/\D/g, '');
  const pw = String(req.body.password || ''), pw2 = String(req.body.password2 || '');
  if (!/^\d{6}$/.test(code)) return fail('کد تأیید باید ۶ رقم باشد.');
  if (pw.length < minPwLen()) return fail(`رمز عبور باید حداقل ${J.toPersianDigits(minPwLen())} کاراکتر باشد.`);
  if (pw !== pw2) return fail('تکرار رمز عبور مطابقت ندارد.');
  const row = st.fake ? null : await db.findById('password_resets', st.id);
  const expired = !row || row.used_at || new Date(String(row.expires_at).replace(' ', 'T') + (String(row.expires_at).endsWith('Z') ? '' : 'Z')).getTime() < Date.now();
  if (st.fake || expired) return fail('کد نادرست یا منقضی است. دوباره درخواست کد بدهید.');
  if (row.attempts >= RESET_MAX_ATTEMPTS) { req.session.pwreset = null; return fail('تعداد تلاش‌های مجاز تمام شد. دوباره درخواست کد بدهید.'); }
  const [salt, h] = String(row.code_hash).split(':');
  if (hashCode(code, salt) !== h) {
    await db.update('password_resets', { attempts: row.attempts + 1 }, { id: row.id });
    const left = RESET_MAX_ATTEMPTS - row.attempts - 1;
    if (left <= 0) { req.session.pwreset = null; return fail('کد نادرست بود و تعداد تلاش‌های مجاز تمام شد. دوباره درخواست کد بدهید.'); }
    return fail(`کد تأیید نادرست است. (${J.toPersianDigits(left)} تلاش باقی‌مانده)`);
  }
  const user = await db.findById('users', row.user_id);
  if (!user || user.status !== 'active') { req.session.pwreset = null; return fail('حساب کاربری در دسترس نیست.'); }
  await db.update('users', { password: await auth.hashPassword(pw), must_change_password: 0, updated_at: db.now() }, { id: user.id });
  await db.update('password_resets', { used_at: db.now() }, { id: row.id });
  try { await db.table('sessions').where((b) => b.where('data', 'like', `%"userId":${user.id},%`).orWhere('data', 'like', `%"userId":${user.id}}%`)).delete(); } catch (e) { /* خاتمهٔ نشست‌های قبلی اختیاری است */ }
  await activity.log(Object.assign(req, { user: { id: user.id, name: user.name, role: user.role } }), 'password_reset', 'user', user.id, 'بازنشانی رمز عبور با کد یک‌بارمصرف');
  req.user = null; req.session.pwreset = null; auth.clearFailures(req, user.username);
  req.flash('success', 'رمز عبور با موفقیت تغییر کرد. اکنون با رمز جدید وارد شوید.');
  res.redirect('/auth/login');
});
router.post('/forgot/cancel', auth.requireGuest, (req, res) => { req.session.pwreset = null; res.redirect('/auth/forgot'); });

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
  if (pw.length < minPwLen()) { req.flash('danger', `رمز عبور باید حداقل ${J.toPersianDigits(minPwLen())} کاراکتر باشد.`); return res.redirect('/auth/password' + (force ? '?force=1' : '')); }
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
