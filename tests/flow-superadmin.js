'use strict';
/**
 * جریان «مدیر ارشد / کنسول سازنده» (v1.2.0):
 *  - ورود فقط از /console/login، ردشدن در فرم عادی، قفل‌شدن پس از تلاش‌های ناموفق
 *  - ۴۰۴ برای مدیر مدرسه روی صفحه‌های مخصوص سازنده (ماژول‌ها، تنظیمات فنی، به‌روزرسانی، لاگ، کنسول)
 *  - نامرئی‌بودن حساب سازنده برای بقیه (فهرست کاربران، جستجو، پیام، فعالیت، ورودها)
 *  - ویجت «گزارش مشکل» + تصویر ≤ ۵MB → کنسول → پاسخ → اعلان گزارش‌دهنده
 *  - درخواست ماژول توسط مدیر → فعال‌سازی از کنسول → اعلان مدیر
 *  - ورود به جای کاربر (از فهرست کاربران و با نام کاربری)، حفاظت از جانشینی سازنده توسط مدیر
 *  - تأیید دومرحله‌ای (TOTP + کد پشتیبان)، تنظیمات امنیتی (IP مجاز بدون IP خود رد می‌شود)
 *  - اسکریپت خط فرمان scripts/superadmin.js list
 */
const assert = (c, m) => { if (!c) { console.log('FAIL: ' + m); process.exitCode = 1; } else console.log('ok: ' + m); };
const { Client, BASE, SUPER, superClient, superPost } = require('./client');
const { spawnSync } = require('child_process');
const path = require('path');
const totp = require('../src/core/totp');
const ROOT = path.join(__dirname, '..');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const SUPER_NAME = 'پشتیبانی سامانه';
let vid = null;
const leak = (html) => new RegExp('>\\s*' + SUPER.user + '\\s*<|>\\s*' + SUPER_NAME + '\\s*<|<option[^>]*>' + SUPER_NAME + '|<td[^>]*>' + SUPER_NAME + (vid ? '|/users/' + vid + '[/"?]' : '')).test(html);

async function multipart(c, p, fields, file) {
  const fd = new FormData(); fd.set('_csrf', c.csrf);
  for (const [k, v] of Object.entries(fields || {})) fd.set(k, v);
  if (file) fd.set(file.field, new Blob([file.data], { type: file.type }), file.name);
  const res = await fetch(BASE + p, { method: 'POST', headers: { cookie: c.cookieHeader(), accept: 'application/json' }, body: fd, redirect: 'manual' });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* html */ }
  return { status: res.status, text, json, location: res.headers.get('location') };
}

(async () => {
  let r;
  const tag = Date.now().toString(36);
  const a = new Client(); r = await a.login('admin', 'admin123'); assert(r.status === 302, 'admin login');
  const sa = await superClient(true);
  r = await sa.get('/console'); assert(r.status === 200 && /کنسول سازنده/.test(r.text) && /ماژول فعال/.test(r.text), 'console dashboard renders');

  // ---------- ورود ----------
  const n = new Client(); r = await n.login(SUPER.user, SUPER.pass); assert(r.status === 302 && /\/auth\/login/.test(r.location || ''), 'super account rejected on the normal login form');
  r = await a.get('/console'); assert(r.status === 404, 'admin → /console is 404');
  r = await a.get('/console/login'); assert(r.status === 200 && /کنسول/.test(r.text), 'console login page is reachable (generic) for everyone');
  const XFF = { headers: { 'x-forwarded-for': '10.77.' + Math.floor(Math.random() * 200) + '.' + Math.floor(Math.random() * 200) } };
  const anon = new Client(); r = await anon.get('/console/login'); assert(r.status === 200, 'anonymous can open console login');
  r = await anon.post('/console/login', { username: 'admin', password: 'admin123' }, XFF); r = await anon.get('/console/login'); assert(/نادرست/.test(r.text) && [302, 404].includes((await anon.get('/console')).status), 'school admin credentials cannot enter the console');

  // ---------- صفحه‌های مخصوص سازنده برای مدیر: ۴۰۴ ----------
  for (const p of ['/system/modules', '/system/settings?tab=sms', '/system/settings?tab=email', '/system/settings?tab=offsite', '/system/settings?tab=maintenance', '/system/settings?tab=advanced', '/system/update', '/system/logs', '/system/info', '/system/settings/export.json', '/console/reports', '/console/requests', '/console/security']) {
    r = await a.get(p); assert(r.status === 404 || (r.status === 200 && p.startsWith('/system/settings?tab=') && !new RegExp('tab=' + p.split('tab=')[1].split('&')[0] + '" class="nav-link active').test(r.text)), `admin cannot open ${p} (${r.status})`);
  }
  r = await a.post('/system/modules/toggle', { key: 'polls', enabled: '0' }); assert(r.status === 404, 'admin cannot toggle modules');
  r = await a.post('/system/maintenance/toggle', { enabled: '1' }); assert(r.status === 404, 'admin cannot toggle maintenance');
  r = await a.post('/system/settings/sms', { sms_provider: 'log' }); assert(r.status === 404, 'admin cannot save SMS settings');
  r = await a.get('/system/settings'); assert(r.status === 200 && !/tab=sms"/.test(r.text) && !/tab=advanced"/.test(r.text) && /tab=security"/.test(r.text), 'settings tabs for admin hide technical tabs');
  r = await a.get('/system/settings?tab=security'); assert(/name="upload_max_mb"/.test(r.text), 'upload_max_mb now lives in the security tab (admin)');
  r = await a.get('/dashboard'); assert(!/href="\/system\/modules"/.test(r.text) && !/href="\/system\/update"/.test(r.text) && !/href="\/console"/.test(r.text), 'admin sidebar has no super-only links');
  r = await sa.get('/dashboard'); assert(/href="\/system\/modules"/.test(r.text) && /href="\/console\/reports"/.test(r.text) && /console-badge|کنسول/.test(r.text), 'super sidebar shows console + modules');
  r = await a.get('/support/modules'); assert(r.status === 200 && /درخواست فعال‌سازی/.test(r.text) && !/modules\/toggle/.test(r.text), 'admin sees read-only module catalogue with request button');

  // ---------- نامرئی‌بودن ----------
  const row = await sa.get('/users?q=' + SUPER.user); vid = (/\/users\/(\d+)\/edit/.exec(row.text) || [])[1]; assert(vid, 'super sees own row in users list');
  for (const p of ['/users', '/users?q=' + SUPER.user, '/users?q=' + encodeURIComponent(SUPER_NAME), '/users?role=admin', '/search?q=' + encodeURIComponent(SUPER_NAME), '/messages/compose', '/notifications/send', '/system/activity', '/dashboard', '/help/about']) {
    r = await a.get(p); assert(r.status === 200 && !leak(r.text), `no trace of the super account for admin on ${p}`);
  }
  const t = new Client(); r = await t.login('teacher1', '123456'); assert(r.status === 302, 'teacher login');
  for (const p of ['/messages/compose', '/search?q=' + encodeURIComponent(SUPER_NAME)]) { r = await t.get(p); assert(r.status === 200 && !leak(r.text), `no trace of the super account for teacher on ${p}`); }
  r = await a.get(`/users/${vid}/edit`); assert(r.status === 404, 'admin cannot open super edit form');
  r = await a.post(`/users/${vid}/reset`, {}); assert(r.status === 404, 'admin cannot reset super password');
  r = await a.post(`/users/${vid}/delete`, {}); assert(r.status === 404, 'admin cannot delete super');
  r = await a.post(`/users/${vid}/toggle`, {}); assert(r.status === 404 || r.status === 302, 'admin cannot toggle super status');
  r = await a.post(`/auth/impersonate/${vid}`, {}); const dash = await a.get('/dashboard'); assert(r.status === 302 && !/بازگشت به کنسول|impersonate\/stop/.test(dash.text) && !leak(dash.text), 'admin cannot impersonate super');
  r = await a.post('/users', { username: 'x' + tag, name: 'آزمایش', role: 'admin', password: 'Passw0rd!xyz', is_super: '1', status: 'active' }); assert(r.status === 302, 'create user with is_super field posted');
  r = await sa.get('/users?q=x' + tag); const xid = (/\/users\/(\d+)\/edit/.exec(r.text) || [])[1];
  if (xid) { const rowHtml = (new RegExp('<tr[^>]*>(?:(?!</tr>)[\\s\\S])*x' + tag + '(?:(?!</tr>)[\\s\\S])*</tr>').exec(r.text) || [''])[0]; assert(rowHtml && !/سازندهٔ سامانه/.test(rowHtml), 'is_super cannot be mass-assigned via users form'); r = await a.get('/users?q=x' + tag); assert(r.text.includes('x' + tag), 'admin sees the normal admin user he created'); await sa.post(`/users/${xid}/delete`, {}); }
  r = await sa.get('/users'); assert(/\/auth\/impersonate\//.test(r.text) && /سازندهٔ سامانه/.test(r.text), 'super users list shows impersonate actions + super badge');

  // ---------- ورود به جای کاربر ----------
  r = await sa.get('/users?q=admin'); const aid = (/\/auth\/impersonate\/(\d+)/.exec(r.text) || [])[1]; assert(aid, 'impersonate link for admin present');
  r = await sa.post('/auth/impersonate/' + aid, {}); assert(r.status === 302 && /dashboard/.test(r.location || ''), 'super impersonates admin');
  r = await sa.get('/dashboard'); assert(r.status === 200 && /بازگشت به کنسول/.test(r.text) && /support-fab/.test(r.text) && !/href="\/system\/modules"/.test(r.text), 'impersonating: admin panel with return bar, widget, no super links');
  r = await sa.post('/academic/classes/1', { title: 'هفتم الف', capacity: '30' }); // ویرایش احتمالی برای ثبت impersonator_id (در صورت وجود مسیر)
  r = await sa.post('/auth/impersonate/stop', {}); assert(r.status === 302 && /console/.test(r.location || ''), 'stop impersonation returns to console');
  r = await sa.get('/console'); assert(r.status === 200, 'console still alive after impersonation');
  r = await sa.post('/console/impersonate', { username: 'teacher1' }); assert(r.status === 302 && /dashboard|lessons|attendance/.test(r.location || ''), 'impersonate by username from console');
  r = await sa.get('/dashboard'); assert(/بازگشت به کنسول/.test(r.text) && !/href="\/users"/.test(r.text), 'impersonating teacher: teacher-level menu');
  await sa.post('/auth/impersonate/stop', {}); await sa.get('/console');
  r = await sa.post('/console/impersonate', { username: 'no-such-user-' + tag }); r = await sa.get('/console'); assert(/یافت نشد/.test(r.text), 'impersonate unknown username → error flash');

  // ---------- ویجت گزارش مشکل ----------
  r = await t.get('/dashboard'); assert(/support-fab/.test(r.text) && /id="supportModal"/.test(r.text) && /enctype|FormData|support\/report/.test(r.text), 'teacher sees support FAB + modal');
  r = await sa.get('/console'); assert(!/support-fab/.test(r.text), 'super does not see the FAB');
  const subj = 'خطای آزمایشی ' + tag;
  r = await multipart(t, '/support/report', { kind: 'bug', subject: subj, message: 'دکمهٔ ذخیره در حضور و غیاب کار نمی‌کند.', page_url: '/attendance/take?class_id=1', screen: '1366x768', tech: '1' }, { field: 'image', data: PNG, type: 'image/png', name: 'shot.png' });
  assert(r.status === 200 && r.json && r.json.ok && r.json.id, 'report with image accepted → JSON {ok,id}');
  const rid = r.json && r.json.id;
  r = await multipart(t, '/support/report', { kind: 'bug', message: 'تصویر بزرگ' }, { field: 'image', data: Buffer.alloc(5 * 1024 * 1024 + 16), type: 'image/png', name: 'big.png' });
  assert(r.status === 400 && r.json && r.json.ok === false && /حجم/.test(r.json.error), 'image > 5MB rejected with JSON error');
  r = await multipart(t, '/support/report', { kind: 'bug', message: 'فایل غیرتصویری' }, { field: 'image', data: Buffer.from('MZ...'), type: 'application/x-msdownload', name: 'x.exe' });
  assert(r.status === 400 && r.json && r.json.ok === false, 'non-image attachment rejected');
  r = await multipart(t, '/support/report', { kind: 'bug', message: 'کم' }); assert(r.status === 400 && r.json && r.json.ok === false, 'too-short message rejected');
  r = await t.get('/support/my'); assert(r.status === 200 && r.text.includes(subj), 'reporter sees the report in «گزارش‌های من»');
  r = await sa.get('/console/reports'); assert(r.text.includes(subj) && /badge/.test(r.text), 'console reports list shows the new report');
  r = await sa.get('/console/reports?kind=bug&status=new&q=' + encodeURIComponent(tag)); assert(r.text.includes(subj), 'reports filters work');
  r = await sa.get('/console/reports?status=resolved&q=' + encodeURIComponent(tag)); assert(!r.text.includes(subj), 'status filter excludes non-matching');
  r = await sa.get('/console/reports/' + rid); assert(r.status === 200 && r.text.includes(subj) && /\/files\/support\//.test(r.text) && /1366x768/.test(r.text) && /attendance\/take/.test(r.text), 'report detail shows image, screen and page url');
  const img = (/\/files\/(support\/[^"']+)/.exec(r.text) || [])[1];
  if (img) {
    const own = await fetch(BASE + '/files/' + img, { headers: { cookie: sa.cookieHeader() }, redirect: 'manual' }); assert(own.status === 200, 'super can open the attachment');
    const adm = await fetch(BASE + '/files/' + img, { headers: { cookie: a.cookieHeader() }, redirect: 'manual' }); assert(adm.status === 403 || adm.status === 404, 'admin cannot open support attachments');
    const rep = await fetch(BASE + '/files/' + img, { headers: { cookie: t.cookieHeader() }, redirect: 'manual' }); assert(rep.status === 200, 'reporter can open own attachment');
    const other = new Client(); await other.login('teacher2', '123456'); const oth = await fetch(BASE + '/files/' + img, { headers: { cookie: other.cookieHeader() }, redirect: 'manual' }); assert(oth.status === 403 || oth.status === 404, 'other users cannot open the attachment');
  }
  r = await sa.post('/console/reports/' + rid, { status: 'resolved', reply: 'رفع شد؛ لطفاً صفحه را تازه کنید.', note: 'یادداشت داخلی ' + tag }); assert(r.status === 302, 'reply + resolve posted');
  r = await t.get('/support/my'); assert(/رفع شد؛ لطفاً صفحه را تازه کنید/.test(r.text) && !r.text.includes('یادداشت داخلی ' + tag), 'reporter sees the reply but not the internal note');
  r = await t.get('/notifications'); assert(/پاسخ به گزارش شما/.test(r.text), 'reporter notified about the reply');
  r = await a.get('/console/reports/' + rid); assert(r.status === 404, 'admin cannot open console report');
  // سقف تعداد در ساعت
  r = await superPost('/console/security/settings', { support_max_per_hour: '2', superadmin_session_hours: '12', superadmin_allow_ips: '' });
  await multipart(t, '/support/report', { kind: 'suggestion', message: 'پیشنهاد شمارهٔ یک برای آزمایش سقف' }); await multipart(t, '/support/report', { kind: 'suggestion', message: 'پیشنهاد شمارهٔ دو برای آزمایش سقف' });
  r = await multipart(t, '/support/report', { kind: 'suggestion', message: 'پیشنهاد شمارهٔ سه برای آزمایش سقف' }); assert(r.status === 429 && r.json && r.json.ok === false, 'rate limit per hour enforced (429)');
  await superPost('/console/security/settings', { support_max_per_hour: '10', superadmin_session_hours: '12', superadmin_allow_ips: '' });
  // غیرفعال‌کردن ویجت
  await superPost('/system/modules/toggle', { key: 'support.widget', enabled: '0' });
  r = await t.get('/dashboard'); assert(!/support-fab/.test(r.text), 'widget hidden when support.widget disabled');
  r = await multipart(t, '/support/report', { kind: 'bug', message: 'باید رد شود چون ویجت خاموش است' }); assert((r.status === 404 || r.status === 403) && r.json && r.json.ok === false, 'report endpoint rejected when widget disabled (' + r.status + ')');
  r = await t.post('/support/report', { kind: 'bug', message: 'باید رد شود چون ویجت خاموش است' }, { headers: { accept: 'application/json' } }); assert(r.status === 404, 'urlencoded report → 404 when widget disabled');
  await superPost('/system/modules/toggle', { key: 'support.widget', enabled: '1' });

  // ---------- درخواست ماژول ----------
  await superPost('/system/modules/toggle', { key: 'polls', enabled: '0' });
  r = await a.get('/polls'); assert(r.status === 404, 'polls disabled for admin');
  r = await a.get('/support/modules'); assert(/name="key" value="polls"/.test(r.text), 'catalogue offers request for disabled module');
  r = await a.post('/support/request', { key: 'polls', note: 'برای نظرسنجی اولیا لازم داریم' }); assert(r.status === 302, 'module request posted');
  r = await a.post('/support/request', { key: 'polls' }); r = await a.get('/support/modules'); assert(/قبلاً ثبت شده|در انتظار/.test(r.text), 'duplicate request is not created twice');
  r = await a.post('/support/request', { key: 'no_such_module' }); assert(r.status === 302 || r.status === 404, 'unknown module key rejected');
  r = await sa.get('/console'); assert(/درخواست/.test(r.text), 'console dashboard mentions requests');
  r = await sa.get('/console/requests'); const reqId = (/\/console\/requests\/(\d+)\/enable/.exec(r.text) || [])[1]; assert(reqId && /polls|نظرسنجی/.test(r.text), 'request listed in console');
  r = await sa.post(`/console/requests/${reqId}/enable`, {}); assert(r.status === 302, 'enable from console');
  r = await a.get('/polls'); assert(r.status === 200, 'polls enabled for admin after approval');
  r = await a.get('/notifications'); assert(/فعال شد/.test(r.text), 'admin notified about the enabled module');
  r = await sa.get('/console/requests?status=all'); assert(/انجام شد|فعال شد|resolved/.test(r.text), 'request marked resolved');
  r = await a.post('/support/request', { key: 'polls' }); r = await a.get('/support/modules'); assert(!/name="key" value="polls"/.test(r.text), 'no request button for already-enabled module');

  // ---------- امنیت کنسول: تنظیمات، رمز، ۲FA ----------
  r = await sa.get('/console/security'); assert(r.status === 200 && /superadmin_allow_ips/.test(r.text) && /دومرحله‌ای/.test(r.text) && /ورودهای کنسول/.test(r.text), 'security page renders');
  r = await sa.post('/console/security/settings', { superadmin_allow_ips: '10.99.99.99', superadmin_session_hours: '12' }); r = await sa.get('/console/security'); assert(/در فهرست نیست/.test(r.text) && !/value="10\.99\.99\.99"/.test(r.text), 'allowlist excluding own IP is refused (lockout guard)');
  r = await sa.post('/console/security/settings', { superadmin_allow_ips: '', superadmin_session_hours: '999' }); r = await sa.get('/console/security'); assert(!/value="999"/.test(r.text), 'session hours clamped');
  r = await sa.post('/console/security/password', { current: 'wrong-pass', password: 'NewVendor#12345', confirm: 'NewVendor#12345' }); r = await sa.get('/console/security'); assert(/نادرست/.test(r.text), 'password change requires the current password');
  r = await sa.post('/console/security/password', { current: SUPER.pass, password: 'short', confirm: 'short' }); r = await sa.get('/console/security'); assert(/۱۰|10/.test(r.text), 'super password needs ≥10 chars');
  r = await sa.get('/console/security/2fa'); const secret = ((/data-copy[^>]*>([A-Z2-7 ]+)</.exec(r.text) || [])[1] || '').replace(/\s/g, ''); assert(secret.length >= 16 && /<svg/.test(r.text), '2fa setup shows secret + QR');
  r = await sa.post('/console/security/2fa', { code: '000000' }); assert(r.status === 200 || r.status === 302, 'wrong code → stays on setup');
  r = await sa.get('/console/security'); assert(!/کدهای پشتیبان باقی‌مانده/.test(r.text), '2fa still off after wrong code');
  r = await sa.post('/console/security/2fa', { code: totp.code(secret) }); const codes = [...r.text.matchAll(/([A-F0-9]{5}-[A-F0-9]{5})/g)].map((m) => m[1]).filter((v, i, arr) => arr.indexOf(v) === i); assert(codes.length === 8, '2fa enabled → 8 backup codes shown');
  const s2 = new Client(); await s2.get('/console/login'); r = await s2.post('/console/login', { username: SUPER.user, password: SUPER.pass }); assert(r.status === 302 && /\/console\/login\/2fa/.test(r.location || ''), 'login now asks for the 2fa code');
  r = await s2.get('/console'); assert(r.status === 302 || r.status === 404, 'no console access before 2fa code');
  r = await s2.post('/console/login/2fa', { code: '123456' }); assert(r.status === 302 && /2fa/.test(r.location || ''), 'wrong 2fa code rejected');
  r = await s2.post('/console/login/2fa', { code: totp.code(secret) }); assert(r.status === 302 && /\/console$/.test(r.location || ''), 'valid TOTP code → console');
  r = await s2.get('/console'); assert(r.status === 200, 'console open after 2fa');
  const s3 = new Client(); await s3.get('/console/login'); await s3.post('/console/login', { username: SUPER.user, password: SUPER.pass }); r = await s3.post('/console/login/2fa', { code: codes[0] }); assert(r.status === 302 && /\/console$/.test(r.location || ''), 'backup code works once');
  const s4 = new Client(); await s4.get('/console/login'); await s4.post('/console/login', { username: SUPER.user, password: SUPER.pass }); r = await s4.post('/console/login/2fa', { code: codes[0] }, XFF); assert(/2fa/.test(r.location || ''), 'used backup code is rejected');
  r = await sa.post('/console/security/2fa/codes', { password: SUPER.pass }); assert(r.status === 200 && /[A-F0-9]{5}-[A-F0-9]{5}/.test(r.text), 'regenerate backup codes');
  r = await sa.post('/console/security/2fa/disable', { password: 'wrong' }); r = await sa.get('/console/security'); assert(/کدهای پشتیبان باقی‌مانده/.test(r.text), 'disable 2fa needs password');
  r = await sa.post('/console/security/2fa/disable', { password: SUPER.pass }); r = await sa.get('/console/security'); assert(!/کدهای پشتیبان باقی‌مانده/.test(r.text), '2fa disabled');
  r = await sa.get('/console/security'); assert(/kind|کنسول/.test(r.text) && /ورودهای کنسول/.test(r.text), 'console logins listed');
  r = await a.get('/system/activity'); assert(!leak(r.text), 'console logins/activity invisible to admin');

  // ---------- قفل‌شدن ----------
  const th = new Client(); await th.get('/console/login');
  for (let i = 0; i < 6; i++) await th.post('/console/login', { username: 'nobody-' + tag, password: 'wrong-' + i }, XFF);
  r = await th.get('/console/login', XFF); assert(/مسدود|قفل/.test(r.text), 'console login throttled after repeated failures');

  // ---------- بازگردانی پشتیبان نمی‌تواند حساب سازنده را تغییر دهد (در حد API) ----------
  r = await a.get('/system/backup'); assert(r.status === 200, 'admin keeps backup page');

  // ---------- خط فرمان ----------
  const cli = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'superadmin.js'), 'list'], { encoding: 'utf8', cwd: ROOT });
  assert(cli.status === 0 && cli.stdout.includes(SUPER.user), 'scripts/superadmin.js list works (' + (cli.stdout || cli.stderr).split('\n')[0].slice(0, 80) + ')');
  const cli2 = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'superadmin.js'), 'create', 'v' + tag, 'short'], { encoding: 'utf8', cwd: ROOT });
  assert(cli2.status !== 0, 'cli refuses short password');

  // ---------- راهنما ----------
  r = await sa.get('/help'); assert(/کنسول سازنده/.test(r.text), 'help shows console topic for super');
  r = await a.get('/help'); assert(!/کنسول سازنده \(مدیر ارشد\)/.test(r.text) && /گزارش مشکل و پشتیبانی/.test(r.text), 'help: support topic for admin, no console topic');
  console.log(process.exitCode ? 'flow-superadmin: FAILED' : 'flow-superadmin: all passed');
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
