'use strict';
/** جریان: راهنما و راه‌اندازی (help) — راهنمای نقش‌محور، جستجو، راهنمای زمینه‌ای، چک‌لیست زنده، ویجت داشبورد، درباره */
const { Client } = require('./client');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 2; } else console.log('ok:', m); };
const strip = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

(async () => {
  const a = new Client(); let r = await a.login('admin', 'admin123'); assert(r.status === 302, 'admin login');
  for (const key of ['help', 'help.guide', 'help.checklist', 'help.contextual', 'help.about']) await a.post('/system/modules/toggle', { key, enabled: '1' });
  await a.post('/help/setup/dismiss', { state: '0' });

  // راهنمای مدیر
  r = await a.get('/help'); assert(r.status === 200 && /شروع کار مدیر/.test(r.text) && /گام‌های راه‌اندازی/.test(r.text), 'admin help default topic = start');
  const txt = strip(r.text);
  assert(/راهنمای معلم/.test(txt) === false && /راهنمای دانش‌آموز/.test(txt) === false, 'admin does not see teacher/student-only topics in nav');
  assert(/تنظیمات، امنیت و نگهداری/.test(txt) && /پرسش‌های متداول/.test(txt), 'admin sees system + faq topics');
  r = await a.get('/help?topic=attendance'); assert(r.status === 200 && /موجه‌کردن غیبت/.test(r.text), 'attendance topic renders excuse section (feature on)');
  r = await a.get('/help?topic=nope'); assert(r.status === 200 && /شروع کار مدیر/.test(r.text), 'unknown topic falls back to first');
  r = await a.get('/help?for=' + encodeURIComponent('/exams/analytics')); assert(/آزمون‌ها، نمرات و کارنامه/.test(strip(r.text)) && /قفل نمرات/.test(r.text), 'contextual ?for= maps /exams → exams topic');
  r = await a.get('/help?q=' + encodeURIComponent('پشتیبان')); assert(/نتایج جستجو/.test(r.text) && /پشتیبان‌گیری/.test(r.text), 'search finds backup sections');
  r = await a.get('/help?q=' + encodeURIComponent('zzzqqq')); assert(/موردی یافت نشد/.test(strip(r.text)), 'search empty state');
  r = await a.get('/dashboard'); assert(/id="helpBtn"/.test(r.text) && /href="\/help\?for=%2Fdashboard"/.test(r.text), 'topbar help button links to current path');

  // بخش وابسته به قابلیت پنهان می‌شود
  await a.post('/system/modules/toggle', { key: 'attendance.excuses', enabled: '0' });
  r = await a.get('/help?topic=attendance'); assert(!/موجه‌کردن غیبت/.test(r.text) && /ثبت روزانه و زنگی/.test(r.text), 'section hidden when its feature is off');
  await a.post('/system/modules/toggle', { key: 'attendance.excuses', enabled: '1' });

  // چک‌لیست
  r = await a.get('/help/setup'); assert(r.status === 200 && /راه‌اندازی اولیهٔ مدرسه/.test(r.text), 'setup page renders');
  const items = [...r.text.matchAll(/data-check="([^"]+)" data-done="(\d)"/g)].map((m) => ({ key: m[1], done: m[2] === '1' }));
  assert(items.length >= 10, 'checklist has items: ' + items.length);
  const byKey = Object.fromEntries(items.map((i) => [i.key, i.done]));
  assert(byKey.year === true && byKey.classes === true && byKey.teachers === true && byKey.students === true, 'demo data satisfies academic/people items');
  assert(byKey.password === false, 'default admin password flagged as not done');
  assert(byKey.demo === false, 'demo-mode item present and not done');
  const pct = Number((/aria-valuenow="(\d+)"/.exec(r.text) || [])[1]); assert(pct > 0 && pct < 100, 'progress percent in (0,100): ' + pct);

  // تغییر وضعیت زنده: تلفن/آدرس مدرسه
  const s = await a.get('/system/settings?tab=school');
  const cur = { phone: (/name="school_phone" value="([^"]*)"/.exec(s.text) || [])[1] || '', addr: (/name="school_address" value="([^"]*)"/.exec(s.text) || [])[1] || '' };
  r = await a.post('/system/settings/school', { school_name: 'دبیرستان نمونهٔ دولتی شهید بهشتی', school_phone: '', school_address: '' });
  r = await a.get('/help/setup'); assert(/data-check="school" data-done="0"/.test(r.text), 'school item not done when phone/address empty');
  r = await a.post('/system/settings/school', { school_name: 'دبیرستان نمونهٔ دولتی شهید بهشتی', school_phone: cur.phone || '02112345678', school_address: cur.addr || 'تهران' });
  r = await a.get('/help/setup'); assert(/data-check="school" data-done="1"/.test(r.text), 'school item done after filling phone/address');
  if (!cur.phone && !cur.addr) await a.post('/system/settings/school', { school_name: 'دبیرستان نمونهٔ دولتی شهید بهشتی', school_phone: '', school_address: '' });

  // ویجت داشبورد + پنهان‌کردن
  r = await a.get('/dashboard'); assert(/id="setupWidget"/.test(r.text) && /راه‌اندازی اولیه:/.test(strip(r.text)), 'dashboard shows setup widget');
  r = await a.post('/help/setup/dismiss', { state: '1' }); assert(r.status === 302 && (r.location || '').includes('/dashboard'), 'dismiss redirects to dashboard');
  r = await a.get('/dashboard'); assert(!/id="setupWidget"/.test(r.text), 'widget hidden after dismiss');
  r = await a.get('/help/setup'); assert(/نمایش دوباره در داشبورد/.test(r.text), 'setup page offers re-show');
  r = await a.post('/help/setup/dismiss', { state: '0' }); assert(r.status === 302, 're-show posted');
  r = await a.get('/dashboard'); assert(/id="setupWidget"/.test(r.text), 'widget back after re-show');

  // درباره
  r = await a.get('/help/about'); assert(r.status === 200 && /دربارهٔ سامانه/.test(r.text) && /Node\.js/.test(r.text) && /ماژول‌ها/.test(r.text), 'about page (admin sees runtime info)');

  // نقش‌ها
  const t = new Client(); await t.login('teacher1', '123456');
  r = await t.get('/help'); assert(r.status === 200 && /راهنمای معلم/.test(r.text) && !/شروع کار مدیر/.test(r.text) && !/تنظیمات، امنیت و نگهداری/.test(strip(r.text)), 'teacher sees teacher guide, not admin topics');
  r = await t.get('/help/setup'); assert(r.status === 403, 'teacher cannot open setup checklist');
  r = await t.post('/help/setup/dismiss', { state: '1' }); assert(r.status === 403, 'teacher cannot dismiss');
  r = await t.get('/help/about'); assert(r.status === 200 && !/Node\.js/.test(r.text), 'teacher about page hides runtime info');
  const st = new Client(); await st.login('40001', '123456');
  r = await st.get('/help'); assert(r.status === 200 && /راهنمای دانش‌آموز/.test(r.text) && /پرسش‌های متداول/.test(strip(r.text)) && !/راهنمای معلم/.test(r.text), 'student sees student guide + faq');
  r = await st.get('/help?for=' + encodeURIComponent('/system/settings')); assert(/راهنمای دانش‌آموز/.test(r.text), 'student contextual link to admin-only topic falls back');
  const lp = await new Client().get('/auth/login'); const pu = (lp.text.match(/data-u="(09\d{9})"/) || [])[1];
  if (pu) { const p = new Client(); await p.login(pu, '123456'); r = await p.get('/help'); assert(r.status === 200 && /راهنمای اولیا/.test(r.text) && /انتخاب فرزند/.test(r.text), 'parent sees parent guide'); }

  // خاموش‌کردن
  await a.post('/system/modules/toggle', { key: 'help.contextual', enabled: '0' });
  r = await a.get('/dashboard'); assert(!/id="helpBtn"/.test(r.text), 'contextual off -> no topbar button');
  await a.post('/system/modules/toggle', { key: 'help.checklist', enabled: '0' });
  r = await a.get('/dashboard'); assert(!/id="setupWidget"/.test(r.text), 'checklist off -> no widget');
  r = await a.get('/help/setup'); assert(r.status === 404, 'checklist off -> 404');
  await a.post('/system/modules/toggle', { key: 'help', enabled: '0' });
  r = await a.get('/help'); assert(r.status === 404, 'module off -> 404');
  r = await a.get('/dashboard'); assert(!/href="\/help"/.test(r.text), 'module off -> no menu');
  for (const key of ['help', 'help.checklist', 'help.contextual']) await a.post('/system/modules/toggle', { key, enabled: '1' });
  r = await a.get('/help'); assert(r.status === 200, 'restored');
  console.log('done');
})().catch((e) => { console.error(e); process.exit(1); });
