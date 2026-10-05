'use strict';
/** تست جریان تکالیف: تعریف با فایل → مشاهده دانش‌آموز → ارسال پاسخ → تأخیر → نمره‌دهی → محتوای آموزشی */
const { Client, BASE } = require('./client');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 2; } else console.log('ok:', m); };
const mp = async (c, url, fields, file) => { const fd = new FormData(); fd.append('_csrf', c.csrf); for (const [k, v] of Object.entries(fields)) fd.append(k, v); if (file) fd.append(file.field, new Blob([file.data], { type: file.type || 'text/plain' }), file.name); const res = await fetch(BASE + url, { method: 'POST', headers: { cookie: c.cookieHeader() }, body: fd, redirect: 'manual' }); c.storeCookies(res); return { status: res.status, location: res.headers.get('location'), text: await res.text() }; };
(async () => {
  const a = new Client(); let r = await a.login('admin', 'admin123'); assert(r.status === 302, 'admin login');
  r = await a.get('/homework'); assert(r.status === 200, 'homework list');
  r = await a.get('/homework/new'); assert(r.status === 200 && /class_subject_id/.test(r.text), 'homework form');
  const csId = Number((/<option value="(\d+)"[^>]*>[^<]*کلاس|<option value="(\d+)"/.exec(r.text) || [])[1] || (/name="class_subject_id"[\s\S]*?<option value="(\d+)"/.exec(r.text) || [])[1]);
  // درس کلاس ۱ را مستقیم از API آزمون‌ها می‌گیریم تا دانش‌آموز ۴۰۰۰۱ (کلاس ۱) آن را ببیند
  r = await a.get('/exams/api/class-subjects/1'); const cs = r.json(); assert(cs && cs.length, 'class 1 subjects');
  const title = 'تکلیف تستی ' + Date.now();
  r = await mp(a, '/homework', { class_subject_id: cs[0].id, title, description: 'صفحهٔ ۱۲ تا ۱۵', due_date: '۱۴۰۵/۰۷/۲۰', max_score: '۱۰', allow_submission: '1' }, { field: 'file', name: 'tamrin.txt', data: 'hello homework' });
  assert(r.status === 302 && /\/homework\/\d+$/.test(r.location || ''), 'create homework with file → ' + r.location);
  const hwId = Number((/\/homework\/(\d+)/.exec(r.location || '') || [])[1]);
  r = await a.get('/homework/' + hwId); assert(r.status === 200 && r.text.includes(title) && /tamrin\.txt/.test(r.text) && /score_\d+/.test(r.text), 'homework show (staff) with file & grading inputs');
  const fileUrl = (/href="(\/files\/[^"]+)"/.exec(r.text) || [])[1]; r = await a.get(fileUrl); assert(r.status === 200 && r.text === 'hello homework', 'attachment download');
  r = await mp(a, '/homework', { class_subject_id: cs[0].id, title: '', due_date: '' }); assert(r.status === 302 && /\/homework\/new/.test(r.location), 'validation');
  // دانش‌آموز
  const s = new Client(); r = await s.login('40001', '123456'); assert(r.status === 302, 'student login');
  r = await s.get('/homework/my'); assert(r.status === 200 && r.text.includes(title), 'student pending list shows homework');
  r = await s.get('/homework/' + hwId); assert(r.status === 200 && /name="content"/.test(r.text), 'student sees submit form');
  r = await mp(s, '/homework/' + hwId + '/submit', { content: 'پاسخ من' }, { field: 'file', name: 'javab.txt', data: 'my answer' }); assert(r.status === 302, 'student submits');
  r = await s.get('/homework/' + hwId); assert(/پاسخ من/.test(r.text) && /javab\.txt/.test(r.text), 'submission shown to student');
  r = await s.get('/homework/my?tab=submitted'); assert(r.text.includes(title), 'submitted tab');
  r = await mp(s, '/homework/' + hwId + '/submit', {}); assert(r.status === 302, 'empty submission rejected (redirect)');
  r = await s.get('/homework/2'); assert([200, 404].includes(r.status), 'student other homework access handled: ' + r.status);
  // نمره‌دهی
  r = await a.get('/homework/' + hwId); assert(/پاسخ من/.test(r.text), 'staff sees submission');
  const body = { score_1: '۸/۵', feedback_1: 'آفرین' }; r = await a.post('/homework/' + hwId + '/grade', body); assert(r.status === 302, 'grade submission');
  r = await s.get('/homework/' + hwId); assert(/۸\.۵|۸٫۵/.test(r.text) && /آفرین/.test(r.text), 'student sees score + feedback');
  r = await s.get('/homework/my?tab=graded'); assert(r.text.includes(title), 'graded tab');
  r = await mp(s, '/homework/' + hwId + '/submit', { content: 'تغییر' }); r = await s.get('/homework/' + hwId); assert(!/>تغییر</.test(r.text), 'graded submission locked');
  r = await a.post('/homework/' + hwId + '/grade', { score_1: '99' }); r = await a.get('/homework/' + hwId); assert(/value="۸[.٫]۵"/.test(r.text), 'out-of-range grade ignored');
  // تأخیر: ویرایش مهلت به گذشته
  r = await mp(a, '/homework/' + hwId, { class_subject_id: cs[0].id, title, due_date: '1405/07/01', max_score: '10', allow_submission: '1' }); assert(r.status === 302, 'edit due date to past');
  const s2 = new Client(); await s2.login('40002', '123456'); r = await s2.get('/homework/' + hwId); assert(r.status === 200, 'second student opens');
  r = await mp(s2, '/homework/' + hwId + '/submit', { content: 'دیر رسیدم' }); assert(r.status === 302, 'late submit request');
  r = await a.get('/homework/' + hwId); const lateOk = /با تأخیر|late/.test(r.text) && /دیر رسیدم/.test(r.text); const rejected = !/دیر رسیدم/.test(r.text); assert(lateOk || rejected, 'late submission labelled or rejected per setting (labelled=' + lateOk + ')');
  r = await a.get('/homework?status=past&q=' + encodeURIComponent(title)); assert(r.status === 200 && r.text.includes(title), 'filter past + search');
  r = await s.get('/homework/my?tab=all'); assert(r.status === 200, 'student all tab');
  // محتوای آموزشی
  r = await a.get('/homework/materials'); assert(r.status === 200, 'materials page');
  const mt = 'جزوهٔ تستی ' + Date.now();
  r = await mp(a, '/homework/materials', { class_subject_id: cs[0].id, title: mt, description: 'توضیح', link: 'https://example.com' }, { field: 'file', name: 'jozve.pdf', data: '%PDF-1.4 test', type: 'application/pdf' }); assert(r.status === 302, 'add material');
  r = await a.get('/homework/materials?q=' + encodeURIComponent(mt)); assert(r.text.includes(mt) && /example\.com/.test(r.text), 'material listed');
  const mid = Number((/data-post="\/homework\/materials\/(\d+)\/delete"/.exec(r.text) || [])[1]);
  r = await s.get('/homework/materials'); assert(r.status === 200 && r.text.includes(mt), 'student sees material');
  r = await a.post('/homework/materials/' + mid + '/delete', {}); assert(r.status === 302, 'delete material');
  r = await a.get('/homework/materials?q=' + encodeURIComponent(mt)); assert(!r.text.includes('fw-semibold">' + mt), 'material gone');
  // معلم
  const t = new Client(); r = await t.login('teacher1', '123456'); assert(r.status === 302, 'teacher login');
  r = await t.get('/homework'); assert(r.status === 200, 'teacher list'); r = await t.get('/homework/new'); assert(r.status === 200, 'teacher form'); r = await t.get('/homework/materials'); assert(r.status === 200, 'teacher materials');
  // حذف
  r = await a.post('/homework/' + hwId + '/delete', {}); assert(r.status === 302, 'delete homework');
  r = await a.get('/homework/' + hwId); assert(r.status === 404, 'homework gone');
  console.log('done');
})().catch((e) => { console.error(e); process.exit(1); });
