'use strict';
/** جریان اولیا: ساخت حساب از پروندهٔ دانش‌آموز، ورود ولی، صفحات فرزند، سوئیچ فرزند، تیکت و پیام، سوابق تحصیلی */
const { Client } = require('./client');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 2; } else console.log('ok:', m); };
const mp = async (c, url, fields) => { const fd = new FormData(); fd.append('_csrf', c.csrf); for (const [k, v] of Object.entries(fields)) fd.append(k, v); const res = await fetch('http://localhost:3000' + url, { method: 'POST', body: fd, headers: { cookie: c.cookieHeader() }, redirect: 'manual' }); return { status: res.status, location: res.headers.get('location'), text: await res.text() }; };
(async () => {
  const a = new Client(); let r = await a.login('admin', 'admin123'); assert(r.status === 302, 'admin login');
  const phone = '0912' + String(Date.now()).slice(-7);
  // ساخت حساب ولی برای دانش‌آموز ۱ و پیوند همان ولی به دانش‌آموز ۲ (دو فرزند)
  r = await a.get('/students/1?tab=parents'); assert(r.status === 200 && /حساب‌های کاربری اولیا/.test(r.text), 'parents tab on student profile');
  r = await a.post('/parents/link/1', { relation: 'father', name: 'ولی آزمایشی', phone, national_id: '', password: 'parent123' }); assert(r.status === 302 && /tab=parents/.test(r.location || ''), 'create parent account');
  r = await a.get('/students/1?tab=parents'); assert(new RegExp(phone).test(r.text) && /ولی آزمایشی/.test(r.text), 'parent listed on student');
  r = await a.post('/parents/link/2', { relation: 'father', name: 'ولی آزمایشی', phone, national_id: '' }); assert(r.status === 302, 'link same parent to second student');
  r = await a.get('/parents?q=' + encodeURIComponent('ولی آزمایشی')); assert(r.status === 200 && /ولی آزمایشی/.test(r.text), 'parents list search');
  const pid = (r.text.match(/\/parents\/(\d+)"/) || [])[1]; assert(pid, 'parent id found: ' + pid);
  r = await a.get('/parents/' + pid); assert(r.status === 200 && (r.text.match(/\/students\/\d+\?tab=parents/g) || []).length >= 2, 'parent detail shows 2 children');
  r = await a.get('/parents/export.csv'); assert(r.status === 200 && /ولی آزمایشی/.test(r.text), 'parents CSV');
  // ورود ولی
  const p = new Client(); r = await p.login(phone, 'parent123'); assert(r.status === 302, 'parent login -> ' + r.location);
  r = await p.get('/dashboard'); assert(r.status === 302 && /\/parents\/panel/.test(r.location || ''), 'dashboard redirects to parent panel');
  r = await p.get('/parents/panel'); assert(r.status === 200 && /پنل اولیا/.test(r.text) && /پروندهٔ فرزند/.test(r.text), 'parent panel renders');
  assert(/parents\/switch\/2/.test(r.text), 'child switcher shows second child');
  for (const path of ['/students/me', '/attendance/my', '/exams/my', '/homework/my', '/finance/my', '/discipline/my', '/health/my', '/library/my', '/announcements', '/calendar', '/polls', '/tickets', '/messages', '/notifications']) {
    const x = await p.get(path); assert(x.status === 200 || x.status === 302, `parent GET ${path} -> ${x.status}`);
  }
  r = await p.get('/students/me?child=1'); assert(r.status === 302 && /\/students\/1$/.test(r.location || ''), 'students/me?child=1 redirects to child 1');
  r = await p.get('/students/1'); assert(r.status === 200 && /نمای کلی/.test(r.text) && !/حساب اولیا/.test(r.text), 'parent sees child profile without parents tab');
  r = await p.get('/attendance/my'); r = await p.get(r.location); assert(r.status === 200, 'parent attendance report of child');
  r = await p.get('/parents/switch/2?back=/students/me'); assert(r.status === 302, 'switch child');
  r = await p.get('/students/me'); assert(r.status === 302 && /\/students\/2$/.test(r.location || ''), 'students/me now points to child 2');
  r = await p.get('/students/2'); assert(r.status === 200, 'child 2 profile after switch');
  // ولی به پروندهٔ دانش‌آموز غیرفرزند دسترسی ندارد
  r = await p.get('/students/50'); assert(r.status === 403, 'parent cannot open other student (403)');
  r = await p.get('/students'); assert(r.status === 403 || r.status === 302, 'parent cannot list students');
  // منو: عنوان «فرزندم»
  assert(/فرزندم/.test((await p.get('/parents/panel')).text), 'menu titles say فرزندم');
  // تیکت از طرف ولی
  r = await p.get('/tickets/new'); assert(r.status === 200 && /دربارهٔ فرزند/.test(r.text), 'ticket form has child chooser');
  let t = await mp(p, '/tickets', { department: 'admin', category: 'general', priority: 'normal', subject: 'تیکت ولی', message: 'سلام از طرف ولی', student_id: '2' });
  assert(t.status === 302 && /\/tickets\/\d+/.test(t.location || ''), 'parent creates ticket -> ' + t.location);
  r = await a.get(t.location); assert(r.status === 200 && /تیکت ولی/.test(r.text), 'admin sees parent ticket');
  // پیام به معلم
  r = await p.get('/messages/compose'); assert(r.status === 200 && /معلمان من/.test(r.text), 'parent compose lists child teachers');
  const to = (r.text.match(/<optgroup label="معلمان من">\s*<option value="(\d+)"/) || [])[1];
  if (to) { r = await p.post('/messages/compose', { receiver_id: to, subject: 'پیام ولی', body: 'سلام استاد', mode: 'user' }); assert(r.status === 302, 'parent sends message to teacher'); }
  // اطلاعیه با مخاطب اولیا
  r = await a.post('/announcements', { title: 'اطلاعیهٔ مخصوص اولیا', body: 'متن', audience: 'parents', is_published: '1' }); assert(r.status === 302, 'admin creates parents-only announcement');
  r = await p.get('/announcements'); assert(/اطلاعیهٔ مخصوص اولیا/.test(r.text), 'parent sees parents-only announcement');
  const s = new Client(); await s.login('40001', '123456'); r = await s.get('/announcements'); assert(!/اطلاعیهٔ مخصوص اولیا/.test(r.text), 'student does not see parents-only announcement');
  // مدیریت: بازنشانی رمز و غیرفعال‌سازی
  r = await a.post(`/parents/${pid}/reset-password`, { password: 'newpass123' }); assert(r.status === 302, 'reset parent password');
  const p2 = new Client(); r = await p2.login(phone, 'newpass123'); assert(r.status === 302, 'parent login with new password');
  r = await a.post(`/parents/${pid}/status`, { status: 'inactive' }); assert(r.status === 302, 'deactivate parent');
  const p3 = new Client(); r = await p3.login(phone, 'newpass123'); assert(r.status !== 302 || !/dashboard/.test(r.location || ''), 'inactive parent cannot login');
  // سوابق تحصیلی
  r = await a.get('/enrollments'); assert(r.status === 200 && /سوابق تحصیلی/.test(r.text), 'enrollments list');
  r = await a.post('/enrollments/backfill', {}); assert(r.status === 302, 'enrollments backfill');
  r = await a.get('/enrollments?student_id=1'); assert(/در حال تحصیل/.test(r.text), 'student 1 has active enrollment');
  r = await a.get('/students/1?tab=enrollments'); assert(r.status === 200 && /سوابق تحصیلی \(سال به سال\)/.test(r.text), 'profile enrollments tab');
  r = await a.get('/enrollments?export=1'); assert(r.status === 200 && /پایه/.test(r.text), 'enrollments CSV');
  // انتقال کلاس → سابقه به‌روز می‌شود
  const sid = 150; const prof = (await a.get('/students/' + sid)).text; const origClass = (prof.match(/\/academic\/classes\/(\d+)/) || [])[1];
  r = await a.post(`/students/${sid}/transfer`, { class_id: '2', reason: 'تست' }); assert(r.status === 302, `transfer student ${sid} to class 2`);
  r = await a.get(`/enrollments?student_id=${sid}`); assert(r.status === 200 && /در حال تحصیل/.test(r.text), 'enrollment reflects transfer');
  if (origClass) { r = await a.post(`/students/${sid}/transfer`, { class_id: origClass, reason: 'بازگشت تست' }); assert(r.status === 302, 'transfer back to original class ' + origClass); }
  const cls2 = '';
  // پاک‌سازی
  r = await a.post(`/parents/${pid}/delete`, {}); assert(r.status === 302, 'delete parent');
  void cls2;
  console.log(process.exitCode ? 'SOME FAILED' : 'ALL PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
