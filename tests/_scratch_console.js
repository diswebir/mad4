'use strict';
const { Client, BASE } = require('./client');
const totp = require('../src/core/totp');
(async () => {
  const log = (...a) => console.log(...a);
  // 1) normal login with super creds must fail
  const n = new Client(); const r0 = await n.login('vendor', 'Vendor#12345'); log('normal login super →', r0.status, r0.location, /نادرست/.test((await n.get('/auth/login')).text));
  // 2) console login
  const s = new Client(); const lp = await s.get('/console/login'); log('console login page', lp.status);
  const r1 = await s.post('/console/login', { username: 'vendor', password: 'Vendor#12345' }); log('console login →', r1.status, r1.location);
  const dash = await s.get('/console'); log('dashboard', dash.status, /کنسول سازنده/.test(dash.text), /ماژول فعال/.test(dash.text));
  for (const p of ['/console/reports', '/console/requests', '/console/security', '/console/security/2fa', '/system/modules', '/system/settings?tab=sms', '/system/settings?tab=advanced', '/system/update', '/system/logs', '/system/info', '/users', '/dashboard', '/system/activity']) { const r = await s.get(p); log('super', p, r.status, (r.text.length/1024).toFixed(0)+'KB', (r.text.match(/support-fab/)||[]).length ? 'FAB' : ''); }
  // users list shows vendor row + impersonate action
  const ul = await s.get('/users?q=vendor'); log('users?q=vendor shows super row:', /سازندهٔ سامانه/.test(ul.text));
  // 3) admin must not see super stuff
  const a = new Client(); await a.login('admin', 'admin123');
  for (const p of ['/console', '/console/login', '/console/reports', '/system/modules', '/system/settings?tab=sms', '/system/update', '/system/logs', '/system/info', '/users?q=vendor', '/support/modules', '/system/settings', '/dashboard']) { const r = await a.get(p); log('admin', p, r.status, /vendor|پشتیبانی سامانه/.test(r.text) ? 'LEAK?' : 'ok', (r.text.match(/support-fab/)||[]).length ? 'FAB' : ''); }
  const t = await a.post('/system/modules/toggle', { key: 'polls', enabled: '0' }); log('admin toggle →', t.status);
  // find vendor id
  const row = await s.get('/users?q=vendor'); const m = /\/users\/(\d+)\/edit/.exec(row.text); const vid = m && m[1]; log('vendor id', vid);
  if (vid) { for (const p of [`/users/${vid}/edit`, `/users/${vid}/reset`]) { const r = await a.get(p); log('admin', p, r.status); } const r = await a.post(`/auth/impersonate/${vid}`); log('admin impersonate super →', r.status, r.location); const d = await a.get('/dashboard'); log('admin still admin?', /vendor/.test(d.text) ? 'LEAK' : 'ok'); }
  // 4) super impersonates admin then returns
  const adminRow = await s.get('/users?q=admin'); const am = /\/auth\/impersonate\/(\d+)/.exec(adminRow.text); log('impersonate link for admin present:', !!am);
  const imp = await s.post('/auth/impersonate/' + (am ? am[1] : 1)); log('super impersonate admin →', imp.status, imp.location);
  const d2 = await s.get('/dashboard'); log('impersonating dashboard', d2.status, /بازگشت به کنسول سازنده/.test(d2.text), (d2.text.match(/support-fab/)||[]).length ? 'FAB shown' : 'no FAB');
  const back = await s.post('/auth/impersonate/stop'); log('stop →', back.status, back.location);
  const d3 = await s.get('/console'); log('back in console', d3.status);
  // 5) teacher sees FAB, posts a report with image
  const tc = new Client(); await tc.login('teacher1', '123456'); const tp = await tc.get('/dashboard'); log('teacher FAB', /support-fab/.test(tp.text), /supportModal/.test(tp.text));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const fd = new FormData(); fd.set('_csrf', tc.csrf); fd.set('kind', 'bug'); fd.set('subject', 'دکمهٔ ذخیره کار نمی‌کند'); fd.set('message', 'در صفحهٔ حضور و غیاب دکمهٔ ذخیره واکنشی ندارد.'); fd.set('page_url', '/attendance'); fd.set('screen', '1366x768'); fd.set('tech', '1'); fd.set('image', new Blob([png], { type: 'image/png' }), 'shot.png');
  const rep = await fetch(BASE + '/support/report', { method: 'POST', headers: { cookie: tc.cookieHeader(), accept: 'application/json' }, body: fd, redirect: 'manual' }); const rj = await rep.json(); log('report →', rep.status, JSON.stringify(rj));
  const my = await tc.get('/support/my'); log('my reports', my.status, /دکمهٔ ذخیره کار نمی‌کند/.test(my.text));
  // too big image
  const big = new FormData(); big.set('_csrf', tc.csrf); big.set('message', 'تصویر بزرگ'); big.set('image', new Blob([Buffer.alloc(5 * 1024 * 1024 + 10)], { type: 'image/png' }), 'big.png');
  const rb = await fetch(BASE + '/support/report', { method: 'POST', headers: { cookie: tc.cookieHeader(), accept: 'application/json' }, body: big, redirect: 'manual' }); log('big image →', rb.status, (await rb.text()).slice(0, 120));
  // 6) super sees report, replies
  const list = await s.get('/console/reports'); log('console reports has it', /دکمهٔ ذخیره کار نمی‌کند/.test(list.text));
  const det = await s.get('/console/reports/' + rj.id); log('detail', det.status, /shot|support\//.test(det.text));
  const img = /\/files\/(support\/[^"]+)/.exec(det.text); log('image path', img && img[1]);
  if (img) { const fs = await fetch(BASE + '/files/' + img[1], { headers: { cookie: s.cookieHeader() }, redirect: 'manual' }); log('super file access', fs.status); const fa = await fetch(BASE + '/files/' + img[1], { headers: { cookie: a.cookieHeader() }, redirect: 'manual' }); log('admin file access (expect 403/404)', fa.status); const ft = await fetch(BASE + '/files/' + img[1], { headers: { cookie: tc.cookieHeader() }, redirect: 'manual' }); log('reporter file access', ft.status); }
  const up = await s.post('/console/reports/' + rj.id, { status: 'resolved', reply: 'رفع شد؛ لطفاً صفحه را تازه کنید.', note: 'cache' }); log('reply →', up.status, up.location);
  const my2 = await tc.get('/support/my'); log('teacher sees reply', /رفع شد؛ لطفاً/.test(my2.text));
  const notif = await tc.get('/notifications'); log('teacher notification', /پاسخ به گزارش شما/.test(notif.text));
  // 7) admin module request → super enables
  await s.post('/system/modules/toggle', { key: 'polls', enabled: '0' }, { json: true });
  const mp = await a.get('/support/modules'); log('admin modules page', mp.status, /درخواست فعال‌سازی/.test(mp.text));
  const rq = await a.post('/support/request', { key: 'polls' }); log('request →', rq.status, rq.location);
  const rl = await s.get('/console/requests'); const rid = (/\/console\/requests\/(\d+)\/enable/.exec(rl.text) || [])[1]; log('request id', rid);
  if (rid) { const en = await s.post(`/console/requests/${rid}/enable`); log('enable →', en.status); const chk = await a.get('/polls'); log('polls enabled for admin', chk.status); const an = await a.get('/notifications'); log('admin notified', /فعال شد/.test(an.text)); }
  // 8) 2FA setup/login flow
  const setup = await s.get('/console/security/2fa'); const sec = (/data-copy>([A-Z2-7 ]+)</.exec(setup.text) || [])[1]; log('2fa secret shown', !!sec);
  const secret = sec.replace(/\s/g, '');
  const en2 = await s.post('/console/security/2fa', { code: totp.code(secret) }); log('2fa enable →', en2.status, /کدهای پشتیبان/.test(en2.text));
  const codes = [...en2.text.matchAll(/<div>([A-F0-9]{5}-[A-F0-9]{5})<\/div>/g)].map((x) => x[1]); log('backup codes', codes.length);
  const s2 = new Client(); await s2.get('/console/login'); const l2 = await s2.post('/console/login', { username: 'vendor', password: 'Vendor#12345' }); log('login w/ 2fa →', l2.status, l2.location);
  const bad = await s2.post('/console/login/2fa', { code: '000000' }); log('bad code →', bad.status, bad.location);
  const good = await s2.post('/console/login/2fa', { code: totp.code(secret) }); log('good code →', good.status, good.location); log('console after 2fa', (await s2.get('/console')).status);
  const s3 = new Client(); await s3.get('/console/login'); await s3.post('/console/login', { username: 'vendor', password: 'Vendor#12345' }); const bc = await s3.post('/console/login/2fa', { code: codes[0] }); log('backup code login →', bc.status, bc.location);
  const dis = await s2.post('/console/security/2fa/disable', { password: 'Vendor#12345' }); log('2fa disable →', dis.status);
  // 9) IP allowlist lockout protection
  const ipr = await s.post('/console/security/settings', { superadmin_allow_ips: '10.9.9.9', superadmin_session_hours: '12' }); const sp = await s.get('/console/security'); log('allowlist without own ip rejected:', /در فهرست نیست/.test(sp.text));
  // 10) throttle
  const th = new Client(); await th.get('/console/login'); let last; for (let i = 0; i < 6; i++) last = await th.post('/console/login', { username: 'vendor', password: 'wrong' }); const thp = await th.get('/console/login'); log('throttled:', /مسدود/.test(thp.text));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
