'use strict';
/** جریان سمت‌ها و مجوزها: سمت پیش‌فرض، کاربر کارمند با سمت، محدودیت دسترسی، مجوز اختصاصی، کارمند بدون سمت */
const { Client } = require('./client');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 2; } else console.log('ok:', m); };
(async () => {
  const a = new Client(); let r = await a.login('admin', 'admin123'); assert(r.status === 302, 'admin login');
  r = await a.get('/users/positions'); assert(r.status === 200 && /کتابدار/.test(r.text) && /حسابدار/.test(r.text), 'positions page lists default positions');
  const libId = (r.text.match(/\/users\/positions\/(\d+)\/edit"[^>]*>[^<]*<\/a>\s*<a href="\/users\?position_id=\d+"[^]*?/) || [])[1];
  // پیدا کردن شناسهٔ سمت کتابدار از صفحهٔ ویرایش
  const ids = [...r.text.matchAll(/\/users\/positions\/(\d+)\/edit/g)].map((m) => m[1]);
  let librarian = null, accountant = null;
  for (const id of ids) { const e = await a.get(`/users/positions/${id}/edit`); if (/ویرایش سمت: کتابدار/.test(e.text)) librarian = id; if (/ویرایش سمت: حسابدار/.test(e.text)) accountant = id; }
  assert(librarian && accountant, `found positions librarian=${librarian} accountant=${accountant}`);
  void libId;
  // ساخت سمت جدید
  r = await a.post('/users/positions', { title: 'سمت آزمایشی', description: 'تست', 'perms[]': ['students.view', 'transport.manage'] }); assert(r.status === 302, 'create custom position');
  r = await a.get('/users/positions'); assert(/سمت آزمایشی/.test(r.text), 'custom position listed');
  r = await a.get('/users/positions/matrix.csv'); assert(r.status === 200 && /کتابدار/.test(r.text), 'matrix CSV');
  // کاربر کارمند با سمت کتابدار
  const un = 'lib' + String(Date.now()).slice(-6);
  r = await a.post('/users', { name: 'کتابدار تستی', username: un, role: 'staff', password: 'secret123', status: 'active', position_id: librarian }); assert(r.status === 302, 'create staff user with librarian position');
  const s = new Client(); r = await s.login(un, 'secret123'); assert(r.status === 302, 'librarian login');
  r = await s.get('/dashboard'); assert(r.status === 200 && /کتابخانه/.test(r.text) && !/امور مالی/.test(r.text), 'menu shows library, hides finance');
  r = await s.get('/library'); assert(r.status === 200, 'librarian can open /library');
  r = await s.get('/library/new'); assert(r.status === 200, 'librarian can add book');
  r = await s.get('/students'); assert(r.status === 200, 'librarian can view students (students.view)');
  r = await s.get('/students/new'); assert(r.status === 403, 'librarian cannot create student (403)');
  r = await s.get('/finance'); assert(r.status === 403, 'librarian cannot open finance (403)');
  r = await s.get('/finance/invoices'); assert(r.status === 403, 'librarian cannot open invoices crud (403)');
  r = await s.get('/system/settings'); assert(r.status === 403, 'librarian cannot open settings (403)');
  r = await s.get('/users'); assert(r.status === 403, 'librarian cannot open users (403)');
  r = await s.get('/reports'); assert(r.status === 403, 'librarian cannot open reports (403)');
  r = await s.get('/teachers'); assert(r.status === 403, 'librarian cannot open teachers (403)');
  // مجوز اختصاصی: افزودن finance.view
  r = await a.get('/users?q=' + un); const uid = (r.text.match(/\/users\/(\d+)\/edit/) || [])[1]; assert(uid, 'found user id ' + uid);
  r = await a.get(`/users/${uid}/edit`); assert(r.status === 200 && /مجوزهای اختصاصی/.test(r.text), 'user form shows extra permissions');
  r = await a.post(`/users/${uid}`, { name: 'کتابدار تستی', username: un, role: 'staff', status: 'active', position_id: librarian, 'perms[]': ['finance.view'] }); assert(r.status === 302, 'grant finance.view to user');
  r = await s.get('/finance'); assert(r.status === 200, 'librarian with finance.view can open finance');
  r = await s.get('/finance/fees/new'); assert(r.status === 403, 'but cannot add fee (403)');
  // تغییر سمت به حسابدار
  r = await a.post(`/users/${uid}`, { name: 'کتابدار تستی', username: un, role: 'staff', status: 'active', position_id: accountant }); assert(r.status === 302, 'switch position to accountant');
  r = await s.get('/finance/fees/new'); assert(r.status === 200, 'accountant can add fee');
  r = await s.get('/library/new'); assert(r.status === 403, 'accountant cannot add book (403)');
  // کارمند بدون سمت = دسترسی عمومی کارکنان (سازگاری)
  const un2 = 'st' + String(Date.now()).slice(-6);
  r = await a.post('/users', { name: 'کارمند بدون سمت', username: un2, role: 'staff', password: 'secret123', status: 'active' }); assert(r.status === 302, 'create staff without position');
  const s2 = new Client(); await s2.login(un2, 'secret123');
  r = await s2.get('/finance'); assert(r.status === 200, 'staff w/o position: finance ok');
  r = await s2.get('/library'); assert(r.status === 200, 'staff w/o position: library ok');
  r = await s2.get('/system/settings'); assert(r.status === 403, 'staff w/o position: settings 403');
  r = await s2.get('/users'); assert(r.status === 403, 'staff w/o position: users 403');
  // معلم همچنان دسترسی نقش‌محور دارد
  const t = new Client(); await t.login('teacher1', '123456');
  r = await t.get('/exams'); assert(r.status === 200, 'teacher exams ok');
  r = await t.get('/users/positions'); assert(r.status === 403, 'teacher positions 403');
  // حذف سمت دارای کاربر ممنوع
  r = await a.post(`/users/positions/${accountant}/delete`, {}); r = await a.get('/users/positions'); assert(/حسابدار/.test(r.text), 'position with users cannot be deleted');
  console.log(process.exitCode ? 'SOME FAILED' : 'ALL PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
