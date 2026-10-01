'use strict';
/** جریان بازیابی رمز عبور: درخواست کد، محدودیت تلاش، رمز کوتاه، موفقیت، محدودیت تعداد درخواست، پاسخ یکسان برای اطلاعات نادرست، غیرفعال‌سازی */
const { Client } = require('./client');
const J = require('../src/core/jalali');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 2; } else console.log('ok:', m); };
(async () => {
  const a = new Client(); let r = await a.login('admin', 'admin123'); assert(r.status === 302, 'admin login');
  r = await a.post('/system/modules/toggle', { key: 'auth.password_reset', enabled: '1' }); assert(r.status === 200, 'enable auth.password_reset');
  r = await a.post('/system/modules/toggle', { key: 'notifications.sms', enabled: '1' }); assert(r.status === 200, 'enable notifications.sms');
  r = await a.post('/system/settings/security', { password_reset_enabled: '1', password_min_length: '۶', login_captcha: '0' }); assert(r.status === 302, 'settings: reset enabled, min length 6 (persian digits)');
  r = await a.post('/system/settings/sms', { sms_enabled: '1', sms_provider: 'log' }); assert(r.status === 302, 'settings: sms log provider');
  // کاربر آزمایشی با شمارهٔ موبایل
  const un = 'rc' + String(Date.now()).slice(-6), phone = '0912' + String(Date.now()).slice(-7);
  r = await a.post('/users', { name: 'کاربر بازیابی', username: un, role: 'staff', password: 'oldpass1', status: 'active', phone }); assert(r.status === 302, 'create test user with phone');
  r = await a.get('/users?q=' + un); const uid = (r.text.match(/\/users\/(\d+)\/edit/) || [])[1]; assert(uid, 'test user id ' + uid);

  const g = new Client();
  r = await g.get('/auth/login'); assert(r.status === 200 && /فراموش کرده‌اید/.test(r.text) && /\/auth\/forgot/.test(r.text), 'login page has forgot link');
  r = await g.get('/auth/forgot'); assert(r.status === 200 && /name="contact"/.test(r.text), 'forgot form');
  r = await g.get('/auth/forgot/verify'); assert(r.status === 302 && /\/auth\/forgot$/.test(r.location), 'verify without request redirects to forgot');
  const latestCode = async () => { const l = await a.get('/system/sms-log?context=password_reset'); const m = l.text.match(/کد بازیابی رمز عبور: ([0-9۰-۹]{6})/); return m ? J.toEnglishDigits(m[1]) : null; };

  // درخواست ۱: پنج تلاش نادرست → قفل
  r = await g.post('/auth/forgot', { username: un, contact: '0912-' + phone.slice(4, 7) + ' ' + phone.slice(7) }); assert(r.status === 302 && /\/auth\/forgot\/verify/.test(r.location), 'request #1 accepted (phone with dashes/spaces)');
  const code1 = await latestCode(); assert(code1 && /^\d{6}$/.test(code1), 'code visible in sms log (log provider): ' + code1);
  r = await g.get('/auth/forgot/verify'); assert(r.status === 200 && /name="code"/.test(r.text) && new RegExp(J.toPersianDigits(phone.slice(0, 4))).test(r.text), 'verify page shows masked phone');
  const wrong = code1 === '000000' ? '111111' : '000000';
  for (let i = 1; i <= 4; i++) { r = await g.post('/auth/forgot/verify', { code: wrong, password: 'newpass1', password2: 'newpass1' }); }
  assert(r.status === 302 && /verify/.test(r.location), '4 wrong attempts stay on verify');
  r = await g.get('/auth/forgot/verify'); assert(/تلاش باقی‌مانده/.test(r.text) && /۱ تلاش/.test(r.text), 'remaining attempts shown (1)');
  r = await g.post('/auth/forgot/verify', { code: wrong, password: 'newpass1', password2: 'newpass1' }); r = await g.get(r.location.replace(/^https?:\/\/[^/]+/, ''));
  assert(/تمام شد/.test(r.text) || /\/auth\/forgot/.test(r.location || ''), '5th wrong attempt locks the code');
  r = await g.get('/auth/forgot/verify'); assert(r.status === 302, 'session cleared after lockout');
  r = await g.post('/auth/forgot/verify', { code: code1, password: 'newpass1', password2: 'newpass1' }); assert(r.status === 302 && /\/auth\/forgot$/.test(r.location), 'locked code cannot be used anymore');
  const l1 = new Client(); r = await l1.login(un, 'newpass1'); assert(r.status !== 302 || !/dashboard/.test(r.location || ''), 'password not changed by failed attempts');

  // درخواست ۲: موفق
  r = await g.post('/auth/forgot', { username: un, contact: phone }); assert(r.status === 302 && /verify/.test(r.location), 'request #2 accepted');
  const code2 = await latestCode(); assert(code2 && code2 !== code1, 'new code generated');
  r = await g.post('/auth/forgot/verify', { code: code2, password: 'abc', password2: 'abc' }); r = await g.get('/auth/forgot/verify'); assert(/حداقل ۶/.test(r.text), 'short password rejected (min length)');
  r = await g.post('/auth/forgot/verify', { code: code2, password: 'newpass1', password2: 'different' }); r = await g.get('/auth/forgot/verify'); assert(/مطابقت ندارد/.test(r.text), 'mismatch rejected');
  r = await g.post('/auth/forgot/verify', { code: J.toPersianDigits(code2), password: 'newpass1', password2: 'newpass1' }); assert(r.status === 302 && /\/auth\/login/.test(r.location), 'correct code (persian digits) → password changed');
  r = await g.get('/auth/login'); assert(/با موفقیت تغییر کرد/.test(r.text), 'success flash on login');
  const l2 = new Client(); r = await l2.login(un, 'newpass1'); assert(r.status === 302 && /dashboard|password/.test(r.location || ''), 'login with new password');
  const l3 = new Client(); r = await l3.login(un, 'oldpass1'); assert(!(r.status === 302 && /dashboard/.test(r.location || '')), 'old password no longer works');
  r = await g.post('/auth/forgot/verify', { code: code2, password: 'x1234567', password2: 'x1234567' }); assert(r.status === 302 && /\/auth\/forgot$/.test(r.location), 'used code cannot be reused (session cleared)');
  r = await a.get('/system/activity?q=' + encodeURIComponent('بازنشانی رمز')); assert(r.status === 200, 'activity page ok');

  // درخواست ۳ و ۴: محدودیت ۳ درخواست در ساعت
  r = await g.post('/auth/forgot', { username: un, contact: phone }); assert(r.status === 302 && /verify/.test(r.location), 'request #3 accepted');
  r = await g.post('/auth/forgot/cancel', {}); assert(r.status === 302, 'cancel request');
  r = await g.post('/auth/forgot', { username: un, contact: phone }); assert(r.status === 302 && /\/auth\/forgot$/.test(r.location), 'request #4 rejected (rate limit)');
  r = await g.get('/auth/forgot'); assert(/بار کد ارسال شده/.test(r.text), 'rate-limit message shown');

  // اطلاعات نادرست: پاسخ یکسان (بدون افشای وجود حساب)
  r = await g.post('/auth/forgot', { username: 'no_such_user_x', contact: '09120000000' }); assert(r.status === 302 && /verify/.test(r.location), 'unknown user → generic verify page');
  r = await g.post('/auth/forgot/verify', { code: '123456', password: 'newpass1', password2: 'newpass1' }); r = await g.get('/auth/forgot/verify'); assert(/نادرست یا منقضی/.test(r.text), 'any code fails for fake session');
  r = await g.post('/auth/forgot/cancel', {});
  r = await g.post('/auth/forgot', { username: un, contact: '09999999999' }); assert(r.status === 302 && /verify/.test(r.location), 'wrong phone → generic verify page (no sms sent)');
  r = await g.post('/auth/forgot/cancel', {});

  // غیرفعال‌سازی از تنظیمات
  r = await a.post('/system/settings/security', { password_reset_enabled: '0' }); assert(r.status === 302, 'disable via settings');
  r = await g.get('/auth/forgot'); assert(r.status === 404, 'forgot page 404 when disabled');
  r = await g.get('/auth/login'); assert(!/\/auth\/forgot/.test(r.text), 'login page hides forgot link when disabled');
  r = await a.post('/system/settings/security', { password_reset_enabled: '1' }); assert(r.status === 302, 're-enable');
  r = await a.post('/system/modules/toggle', { key: 'auth.password_reset', enabled: '0' }); r = await g.get('/auth/forgot'); assert(r.status === 404, 'forgot page 404 when feature disabled');
  r = await a.post('/system/modules/toggle', { key: 'auth.password_reset', enabled: '1' }); assert(r.status === 200, 'feature re-enabled');
  // پاک‌سازی
  r = await a.post('/users/' + uid + '/delete', {}); assert(r.status === 302, 'cleanup user');
  console.log(process.exitCode ? 'SOME FAILED' : 'ALL PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
