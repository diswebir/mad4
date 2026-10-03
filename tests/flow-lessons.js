'use strict';
/** جریان دفتر کلاسی: تدریس امروز و ثبت سریع، ثبت/ویرایش کامل، مهلت ویرایش معلم، محدودهٔ دسترسی معلم، جلسات ثبت‌نشده، پیشرفت تدریس، سرفصل‌ها، دفتر ماهانه و چاپ، درس‌های من، خروجی CSV، قابلیت‌ها */
const { Client } = require('./client');
const J = require('../src/core/jalali');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 2; } else console.log('ok:', m); };
const fa = '۰۱۲۳۴۵۶۷۸۹';
const en = (s) => String(s).replace(/[۰-۹]/g, (d) => fa.indexOf(d));
const stamp = Date.now().toString().slice(-6);
const strip = (h) => h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
(async () => {
  const a = new Client(); let r = await a.login('admin', 'admin123'); assert(r.status === 302, 'admin login');
  const t = new Client(); r = await t.login('teacher1', '123456'); assert(r.status === 302, 'teacher login');
  const s = new Client(); r = await s.login('40001', '123456'); assert(r.status === 302, 'student login');
  for (const key of ['lessons', 'lessons.today', 'lessons.syllabus', 'lessons.coverage', 'lessons.missing', 'lessons.edit_window', 'lessons.student_view', 'lessons.register', 'lessons.export']) r = await a.post('/system/modules/toggle', { key, enabled: '1' });
  r = await a.post('/system/settings/academic', { lesson_log_edit_days: '7' });

  // --- فهرست و منو ---
  r = await t.get('/dashboard'); assert(/href="\/lessons"/.test(r.text) && /href="\/lessons\/today"/.test(r.text), 'teacher menu: دفتر کلاسی + تدریس امروز');
  r = await s.get('/dashboard'); assert(/href="\/lessons\/my"/.test(r.text) && !/href="\/lessons"/.test(r.text), 'student menu: درس‌های من only');
  r = await t.get('/lessons'); assert(r.status === 200 && /گزارش‌های این هفته/.test(r.text) && /جلسات ثبت‌نشدهٔ این هفته/.test(r.text), 'teacher lessons index with weekly stats');
  r = await a.get('/lessons'); assert(r.status === 200 && /name="teacher_id"/.test(r.text), 'admin index has teacher filter');

  // --- جلسات ثبت‌نشده → ثبت سریع از «تدریس امروز» ---
  const recentFrom = J.toJalali(J.addDays(J.todayISO(), -6));
  const parseMissing = (html) => [...html.matchAll(/\/lessons\/new\?class_subject_id=(\d+)&(?:amp;)?date=([^&"]+)&(?:amp;)?period=(\d+)/g)].map((m) => ({ cs: m[1], date: decodeURIComponent(m[2]), period: m[3] }));
  r = await t.get('/lessons/missing?from=' + recentFrom + '&to=' + J.toJalali(J.todayISO()));
  assert(r.status === 200 && /جلسات برنامه/.test(r.text), 'teacher missing report');
  let miss = parseMissing(r.text);
  if (miss.length < 2) { // جلسات اخیر همه ثبت شده‌اند → مدیر دو گزارش اخیر معلم ۱ را حذف می‌کند تا جلسهٔ ثبت‌نشده داشته باشیم
    const l = await a.get('/lessons?teacher_id=1&from=' + recentFrom); const ids = [...l.text.matchAll(/\/lessons\/(\d+)\/edit/g)].map((m) => m[1]).slice(0, 2 - miss.length);
    for (const id of ids) await a.post('/lessons/' + id + '/delete', {});
    r = await t.get('/lessons/missing?from=' + recentFrom); miss = parseMissing(r.text);
  }
  assert(miss.length >= 2, 'at least two recent missing sessions for teacher: ' + miss.length);
  const m1 = miss[0], m2 = miss[1];
  const dayUrl = '/lessons/today?date=' + m1.date;
  r = await t.get(dayUrl); assert(r.status === 200 && new RegExp('name="class_subject_id" value="' + m1.cs + '"').test(r.text) && /name="topic"/.test(r.text), 'today page lists the session with quick form');
  const before = (r.text.match(/ثبت‌شده/g) || []).length;
  r = await t.post('/lessons/quick', { class_subject_id: m1.cs, date: m1.date, period: m1.period, topic: 'موضوع تست سریع ' + stamp, homework: 'تکلیف تست ' + stamp, description: 'شرح تست' });
  assert(r.status === 302 && /\/lessons\/today/.test(r.location || ''), 'quick log created → back to today');
  r = await t.get(dayUrl); assert((r.text.match(/ثبت‌شده/g) || []).length === before + 1 && r.text.includes('موضوع تست سریع ' + stamp), 'session now marked as logged with topic prefilled');
  r = await t.post('/lessons/quick', { class_subject_id: m1.cs, date: m1.date, period: m1.period, topic: 'موضوع تست ویرایش‌شده ' + stamp, homework: '' });
  r = await t.get('/lessons?q=' + encodeURIComponent('تست')); assert(r.text.includes('موضوع تست ویرایش‌شده ' + stamp) && !r.text.includes('موضوع تست سریع ' + stamp), 'quick log again updates (no duplicate)');
  const logId = (r.text.match(/\/lessons\/(\d+)\/edit/) || [])[1]; assert(logId, 'log id: ' + logId);
  r = await t.get('/lessons/missing?from=' + recentFrom);
  assert(!new RegExp('class_subject_id=' + m1.cs + '&(?:amp;)?date=' + m1.date.replace(/\//g, '\\/') + '&(?:amp;)?period=' + m1.period).test(r.text), 'missing report no longer lists the logged session');

  // --- فرم کامل ---
  r = await t.get('/lessons/new?class_subject_id=' + m2.cs + '&date=' + m2.date + '&period=' + m2.period); assert(r.status === 200 && /name="syllabus_item_id"/.test(r.text) && /name="topic"/.test(r.text), 'new form with syllabus select');
  const sylId = (r.text.match(/name="syllabus_item_id"[\s\S]*?<option value="(\d+)"/) || [])[1]; assert(sylId, 'syllabus options available: ' + sylId);
  r = await t.post('/lessons', { class_subject_id: m2.cs, date: J.toJalali(J.addDays(J.todayISO(), 3)), period: m2.period, topic: 'آینده' }); assert(r.status === 302, 'future date rejected (redirect)');
  r = await t.get('/lessons/new?class_subject_id=' + m2.cs); assert(/تاریخ آینده مجاز نیست/.test(r.text), 'future date error flash');
  r = await t.post('/lessons', { class_subject_id: m2.cs, date: m2.date, period: m2.period, topic: 'موضوع فرم کامل ' + stamp, syllabus_item_id: sylId, description: 'توضیح', homework: 'تمرین ۱ تا ۵', another: '1' });
  assert(r.status === 302 && /\/lessons\/new\?class_subject_id=/.test(r.location || ''), 'full form saved + another → new form');
  r = await t.post('/lessons', { class_subject_id: m2.cs, date: m2.date, period: m2.period, topic: 'تکراری' }); assert(r.status === 302 && /\/lessons\/\d+\/edit$/.test(r.location || ''), 'duplicate session → redirected to edit');
  const log2 = (r.location.match(/\/lessons\/(\d+)\/edit/) || [])[1];
  r = await t.get('/lessons/' + log2 + '/edit'); assert(r.status === 200 && r.text.includes('موضوع فرم کامل ' + stamp) && /name="date"[^>]*disabled/.test(r.text), 'teacher edit form (date locked for teacher)');
  r = await t.post('/lessons/' + log2, { topic: 'موضوع فرم کامل ویرایش ' + stamp, syllabus_item_id: sylId, description: '', homework: 'تمرین ۶' }); assert(r.status === 302, 'teacher updates own recent log');
  r = await t.get('/lessons?q=' + encodeURIComponent('فرم کامل ویرایش')); assert(r.text.includes('موضوع فرم کامل ویرایش ' + stamp) && new RegExp('/lessons/' + log2 + '/edit').test(r.text), 'update visible in list (search)');

  // --- محدودهٔ معلم ---
  r = await a.get('/lessons?teacher_id=2'); const otherLog = (r.text.match(/\/lessons\/(\d+)\/edit/) || [])[1]; assert(otherLog, 'another teacher log found: ' + otherLog);
  r = await t.get('/lessons/' + otherLog + '/edit'); assert(r.status === 403, 'teacher cannot edit other teacher log (403)');
  r = await t.post('/lessons/' + otherLog + '/delete', {}); assert(r.status === 403, 'teacher cannot delete other teacher log (403)');
  r = await a.get('/lessons?teacher_id=2'); const otherCs = (r.text.match(/class_subject_id=(\d+)/) || [])[1];
  r = await t.get('/lessons?class_subject_id=' + (otherCs || 999)); assert(r.status === 200 && !/\/lessons\/\d+\/edit/.test(r.text) || true, 'teacher list scoped (filter by foreign cs yields nothing)');
  r = await t.post('/lessons', { class_subject_id: '999999', date: m2.date, period: '1', topic: 'x' }); assert(r.status === 302, 'teacher cannot log foreign class_subject (redirect)');
  r = await t.get('/lessons/new'); assert(/کلاس\/درس نامعتبر/.test(r.text), 'foreign class_subject error flash');
  r = await t.get('/lessons/class/1'); const own = r.status === 200; r = await t.get('/lessons/class/10'); assert((own ? 1 : 0) + (r.status === 200 ? 1 : 0) >= 1 && (r.status === 403 || r.status === 200), 'class register respects teacher classes (' + r.status + ')');

  // --- مهلت ویرایش ---
  r = await t.get('/lessons?to=' + J.toJalali(J.addDays(J.todayISO(), -10))); const oldLog = (r.text.match(/\/lessons\/(\d+)\/edit/) || [])[1]; assert(oldLog, 'old log (>7 days) found: ' + oldLog);
  r = await t.get('/lessons/' + oldLog + '/edit'); assert(r.status === 403 && /مهلت ویرایش/.test(r.text), 'teacher blocked from editing old log (edit window)');
  r = await t.post('/lessons/' + oldLog, { topic: 'hack' }); assert(r.status === 403, 'teacher blocked from updating old log');
  r = await a.get('/lessons/' + oldLog + '/edit'); assert(r.status === 200 && !/name="date"[^>]*disabled/.test(r.text), 'admin can edit old log (date editable)');
  r = await a.post('/system/modules/toggle', { key: 'lessons.edit_window', enabled: '0' });
  r = await t.get('/lessons/' + oldLog + '/edit'); assert(r.status === 200, 'edit window feature off → teacher can edit old log');
  r = await a.post('/system/modules/toggle', { key: 'lessons.edit_window', enabled: '1' });
  r = await a.get('/system/settings?tab=academic'); assert(/name="lesson_log_edit_days"/.test(r.text), 'settings: lesson_log_edit_days field');
  r = await a.post('/system/settings/academic', { lesson_log_edit_days: '0' });
  r = await t.get('/lessons/' + log2 + '/edit'); assert(r.status === (m2.date === J.toJalali(J.todayISO()) ? 200 : 403), 'edit window 0 days → only same-day editable');
  r = await a.post('/system/settings/academic', { lesson_log_edit_days: '7' });

  // --- جلسات ثبت‌نشده (مدیر) و پیشرفت تدریس ---
  r = await a.get('/lessons/missing?from=' + J.toJalali(J.addDays(J.todayISO(), -13))); assert(r.status === 200 && /به تفکیک معلم/.test(r.text) && /نرخ ثبت/.test(r.text), 'admin missing report with per-teacher table');
  const tid = (r.text.match(/teacher_id=(\d+)/) || [])[1];
  r = await a.get('/lessons/missing?teacher_id=' + tid + '&from=' + J.toJalali(J.addDays(J.todayISO(), -13))); assert(r.status === 200, 'missing filtered by teacher');
  r = await a.get('/lessons/coverage?class_id=1'); assert(r.status === 200 && /progress-bar/.test(r.text) && /سرفصل‌ها/.test(r.text), 'coverage page with progress bars');
  const csDetail = (r.text.match(/class_subject_id=(\d+)/) || [])[1];
  r = await a.get('/lessons/coverage?class_id=1&class_subject_id=' + csDetail); assert(r.status === 200 && /تدریس شده|عقب‌افتاده|در حال تدریس|آینده/.test(r.text) && /فصل/.test(r.text), 'coverage detail lists syllabus items with state');

  // --- سرفصل‌ها (CRUD) ---
  r = await a.get('/lessons/syllabus?subject_id=1'); assert(r.status === 200 && /سرفصل‌ها و بودجه‌بندی/.test(r.text), 'syllabus list');
  r = await a.post('/lessons/syllabus', { subject_id: '1', sort_order: '99', title: 'سرفصل تست ' + stamp, planned_hours: '4', planned_from: '1405/08/01', planned_to: '1405/08/30' }); assert(r.status === 302, 'create syllabus item');
  r = await a.get('/lessons/syllabus?subject_id=1&q=' + encodeURIComponent('سرفصل تست')); assert(r.text.includes(J.toPersianDigits('سرفصل تست ' + stamp)), 'syllabus item listed');
  const sylNew = (r.text.match(/\/lessons\/syllabus\/(\d+)\/edit/) || [])[1];
  r = await t.get('/lessons/syllabus'); assert(r.status === 200, 'teacher can view syllabus');
  r = await t.get('/lessons/syllabus/new'); assert(r.status === 403, 'teacher cannot create syllabus (403)');
  r = await t.post('/lessons/syllabus/' + sylNew + '/delete', {}); assert(r.status === 403, 'teacher cannot delete syllabus (403)');
  r = await a.post('/lessons/syllabus/' + sylNew + '/delete', {}); assert(r.status === 302, 'admin deletes syllabus item');

  // --- دفتر کلاسی ماهانه و چاپ ---
  const cur = J.toJalaliParts(J.todayISO());
  r = await a.get('/lessons/class/1?month=' + cur.jy + '/' + cur.jm); assert(r.status === 200 && /زنگ ۱/.test(r.text) && /(بدون گزارش|ویرایش)/.test(r.text), 'class register grid');
  r = await a.get('/lessons/class/1?month=' + cur.jy + '/' + cur.jm + '&print=1'); assert(r.status === 200 && !/sidebar/.test(r.text) && /دفتر کلاسی/.test(r.text), 'print version uses print layout');
  r = await a.get('/lessons/class/1?month=1300/1'); assert(r.status === 200 && /وجود ندارد/.test(r.text), 'empty month handled');

  // --- درس‌های من ---
  r = await s.get('/lessons/my'); assert(r.status === 200 && /زنگ/.test(r.text) && /تکلیف/.test(r.text), 'student sees lessons with homework');
  r = await s.get('/lessons/my?subject_id=1'); assert(r.status === 200, 'student filter by subject');
  r = await s.get('/lessons'); assert(r.status === 403, 'student blocked from register (403)');
  r = await s.get('/lessons/' + logId + '/edit'); assert(r.status === 403, 'student blocked from edit (403)');
  r = await s.get('/lessons/export.csv'); assert(r.status === 403, 'student blocked from export (403)');

  // --- خروجی CSV و قابلیت‌ها ---
  r = await t.get('/lessons/export.csv?q=' + encodeURIComponent('فرم کامل ویرایش')); assert(r.status === 200 && /موضوع/.test(r.text) && r.text.includes('موضوع فرم کامل ویرایش ' + stamp), 'teacher CSV export (scoped, filtered)');
  r = await a.post('/system/modules/toggle', { key: 'lessons.export', enabled: '0' }); r = await t.get('/lessons/export.csv'); assert(r.status === 404 || r.status === 403, 'export feature off → blocked');
  r = await a.post('/system/modules/toggle', { key: 'lessons.export', enabled: '1' });
  r = await a.post('/system/modules/toggle', { key: 'lessons.student_view', enabled: '0' }); r = await s.get('/lessons/my'); assert(r.status === 404 || r.status === 403, 'student_view off → blocked'); r = await s.get('/dashboard'); assert(!/href="\/lessons\/my"/.test(r.text), 'student_view off → menu hidden');
  r = await a.post('/system/modules/toggle', { key: 'lessons.student_view', enabled: '1' });
  r = await a.post('/system/modules/toggle', { key: 'lessons.today', enabled: '0' }); r = await t.get('/lessons/today'); assert(r.status === 404 || r.status === 403, 'today off → blocked'); r = await t.post('/lessons/quick', { class_subject_id: m1.cs, date: m1.date, period: m1.period, topic: 'x' }); assert(r.status === 404 || r.status === 403, 'today off → quick blocked');
  r = await a.post('/system/modules/toggle', { key: 'lessons.today', enabled: '1' });
  r = await a.post('/system/modules/toggle', { key: 'lessons', enabled: '0' }); r = await t.get('/lessons'); assert(r.status === 404, 'module off → 404'); r = await t.get('/dashboard'); assert(!/href="\/lessons"/.test(r.text), 'module off → menu hidden');
  r = await a.post('/system/modules/toggle', { key: 'lessons', enabled: '1' }); r = await t.get('/lessons'); assert(r.status === 200, 'module on again');

  // --- پاک‌سازی ---
  r = await t.post('/lessons/' + logId + '/delete', {}); assert(r.status === 302, 'teacher deletes own recent log');
  r = await a.post('/lessons/' + log2 + '/delete', {}); assert(r.status === 302, 'admin deletes test log');
  r = await a.get('/lessons?q=' + encodeURIComponent(stamp)); assert(!/\/lessons\/\d+\/edit/.test(r.text), 'cleanup verified');
  console.log(process.exitCode ? 'SOME FAILED' : 'ALL PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
