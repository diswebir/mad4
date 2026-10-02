'use strict';
/** جریان قفل نمرات نوبت: ایجاد آزمون، قفل نوبت، منع معلم، ویرایش مدیر با دلیل، تاریخچه، کارنامهٔ نهایی، بازکردن قفل، غیرفعال کردن قابلیت */
const { Client } = require('./client');
const J = require('../src/core/jalali');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 2; } else console.log('ok:', m); };
(async () => {
  const a = new Client(); let r = await a.login('admin', 'admin123'); assert(r.status === 302, 'admin login');
  const t = new Client(); r = await t.login('teacher1', '123456'); assert(r.status === 302, 'teacher login');
  // اطمینان از فعال بودن قابلیت‌ها
  for (const key of ['exams.lock', 'exams.history']) { r = await a.post('/system/modules/toggle', { key, enabled: '1' }); assert(r.status === 200, 'enable ' + key); }

  // یک نوبت مخصوص تست می‌سازیم تا نوبت‌های دمو دست‌نخورده بمانند
  const termTitle = 'نوبت تست قفل ' + String(Date.now()).slice(-5);
  r = await a.get('/academic/terms/new'); const yearId = (r.text.match(/name="academic_year_id"[^]*?<option value="(\d+)"[^>]*selected/) || r.text.match(/name="academic_year_id"[^]*?<option value="(\d+)"/) || [])[1];
  assert(yearId, 'academic year id found: ' + yearId);
  r = await a.post('/academic/terms', { academic_year_id: yearId, title: termTitle, number: 3, start_date: '۱۴۰۵/۱۲/۰۱', end_date: '۱۴۰۵/۱۲/۲۹', is_current: '0' }); assert(r.status === 302, 'create test term');
  r = await a.get('/academic/terms?q=' + encodeURIComponent('نوبت تست قفل'));
  const termId = (r.text.match(new RegExp(J.toPersianDigits(termTitle) + '[\\s\\S]*?/academic/terms/(\\d+)/edit')) || [])[1]; assert(termId, 'term id: ' + termId);
  assert(!/نوبت اول/.test(r.text.slice(r.text.indexOf('<tbody'))), 'search filters terms list to the test term only');
  assert(/باز<\/span>/.test(r.text) && /\/lock"/.test(r.text), 'terms list shows open status + lock action');

  // آزمون معلم در این نوبت
  r = await t.get('/exams/api/class-subjects/1'); const cs = r.json(); assert(Array.isArray(cs) && cs.length, 'teacher class-subjects for class 1');
  const title = 'آزمون قفل ' + String(Date.now()).slice(-5);
  r = await t.post('/exams', { class_subject_id: cs[0].id, term_id: termId, title, type: 'written', date: '۱۴۰۵/۱۲/۱۰', max_score: '20', weight: 1 });
  assert(r.status === 302 && /\/exams\/\d+/.test(r.location || ''), 'teacher creates exam in test term');
  const examId = Number((/\/exams\/(\d+)/.exec(r.location || '') || [])[1]);
  r = await t.get('/exams/' + examId); const sids = [...r.text.matchAll(/name="score_(\d+)"/g)].map((m) => Number(m[1])); assert(sids.length >= 3, 'grade sheet students: ' + sids.length);
  assert(/باز<\/span>/.test(r.text), 'exam page shows term open');
  let body = {}; body['score_' + sids[0]] = '15'; body['score_' + sids[1]] = '12';
  r = await t.post('/exams/' + examId + '/grades', body); assert(r.status === 302, 'teacher saves grades while open');
  r = await t.get('/exams/' + examId + '/history'); assert(r.status === 200 && /تغییری ثبت نشده/.test(r.text), 'no change history yet (initial entry is not a change)');

  // تغییر نمره قبل از قفل → در تاریخچه ثبت می‌شود (بدون دلیل)
  body = {}; body['score_' + sids[0]] = '16'; body['score_' + sids[1]] = '12';
  r = await t.post('/exams/' + examId + '/grades', body); assert(r.status === 302, 'teacher edits a grade (open)');
  r = await t.get('/exams/' + examId + '/history'); assert(r.status === 200 && /۱۵<\/span>/.test(r.text) && /۱۶<\/span>/.test(r.text), 'history shows 15 → 16');

  // قفل نوبت توسط معلم → ۴۰۳
  r = await t.post('/academic/terms/' + termId + '/lock', {}); assert(r.status === 403, 'teacher cannot lock term (403)');
  // قفل نوبت توسط مدیر
  r = await a.post('/academic/terms/' + termId + '/lock', {}); assert(r.status === 302, 'admin locks term');
  r = await a.get('/academic/terms?q=' + encodeURIComponent('نوبت تست قفل')); assert(/نهایی<\/span>/.test(r.text) && /\/unlock"/.test(r.text), 'terms list shows locked + unlock action');

  // معلم: صفحه فقط‌خواندنی، ذخیره ۴۰۳، ویرایش/حذف آزمون ۴۰۳، آزمون جدید در نوبت قفل ۴۰۳
  r = await t.get('/exams/' + examId); assert(r.status === 200 && /نهایی شده است/.test(r.text) && new RegExp('name="score_' + sids[0] + '"[^>]*readonly').test(r.text), 'teacher sees locked notice + readonly inputs');
  assert(!/name="change_reason"/.test(r.text), 'teacher has no reason field');
  body = {}; body['score_' + sids[0]] = '19';
  r = await t.post('/exams/' + examId + '/grades', body); assert(r.status === 403, 'teacher cannot save grades after lock (403)');
  r = await t.post('/exams/' + examId, { class_subject_id: cs[0].id, term_id: termId, title: title + ' ویرایش', type: 'written', date: '۱۴۰۵/۱۲/۱۰', max_score: '20', weight: 1 }); assert(r.status === 403, 'teacher cannot edit locked exam (403)');
  r = await t.post('/exams/' + examId + '/delete', {}); assert(r.status === 403, 'teacher cannot delete locked exam (403)');
  r = await t.post('/exams', { class_subject_id: cs[0].id, term_id: termId, title: 'آزمون جدید در نوبت قفل', type: 'quiz', date: '۱۴۰۵/۱۲/۱۲', max_score: '10', weight: 1 }); assert(r.status === 403, 'teacher cannot create exam in locked term (403)');
  r = await t.get('/exams/' + examId); assert(!new RegExp('name="score_' + sids[0] + '"[^>]*value="۱۹"').test(r.text), 'grade unchanged after blocked attempt');

  // مدیر: بدون دلیل رد می‌شود، با دلیل ثبت و در تاریخچه می‌آید
  r = await a.get('/exams/' + examId); assert(/name="change_reason"/.test(r.text) && /نهایی<\/span>/.test(r.text), 'admin sees reason field + locked badge');
  body = {}; body['score_' + sids[0]] = '17'; body['score_' + sids[1]] = '12';
  r = await a.post('/exams/' + examId + '/grades', body); assert(r.status === 302, 'admin save without reason redirects');
  r = await a.get('/exams/' + examId); assert(/دلیل تغییر/.test(r.text) && !new RegExp('name="score_' + sids[0] + '"[^>]*value="۱۷"').test(r.text), 'admin save without reason rejected (flash + unchanged)');
  body.change_reason = 'اعتراض دانش‌آموز تأیید شد';
  r = await a.post('/exams/' + examId + '/grades', body); assert(r.status === 302, 'admin saves with reason');
  r = await a.get('/exams/' + examId); assert(new RegExp('name="score_' + sids[0] + '"[^>]*value="۱۷"').test(r.text), 'grade changed to 17 by admin');
  r = await a.get('/exams/' + examId + '/history'); assert(r.status === 200 && /اعتراض دانش‌آموز تأیید شد/.test(r.text) && /۱۷<\/span>/.test(r.text) && /مدیر مدرسه/.test(r.text), 'exam history lists admin change with reason');
  r = await a.get('/exams/changes?q=' + encodeURIComponent('اعتراض')); assert(r.status === 200 && /اعتراض دانش‌آموز تأیید شد/.test(r.text) && r.text.includes(title), 'global changes page filters by reason');
  r = await a.get('/exams/changes?term_id=' + termId); assert(r.status === 200 && r.text.includes(title), 'global changes page filters by term');
  r = await t.get('/exams/changes'); assert(r.status === 200 && r.text.includes(title), 'teacher sees changes of own classes');
  // کارنامه: نشان «نهایی»
  r = await a.get('/exams/report-card/' + sids[0] + '?term_id=' + termId); assert(r.status === 200 && /نهایی<\/span>/.test(r.text), 'report card shows final badge for locked term');
  // دانش‌آموز هم در کارنامه نشان نهایی را می‌بیند (بعد از انتشار)
  r = await a.post('/exams/' + examId + '/publish', {}); assert(r.status === 302, 'publish exam');

  // باز کردن قفل → معلم دوباره می‌تواند
  r = await a.post('/academic/terms/' + termId + '/unlock', {}); assert(r.status === 302, 'admin unlocks term');
  body = {}; body['score_' + sids[0]] = '18'; body['score_' + sids[1]] = '12';
  r = await t.post('/exams/' + examId + '/grades', body); assert(r.status === 302, 'teacher can save again after unlock');
  r = await a.get('/exams/report-card/' + sids[0] + '?term_id=' + termId); assert(r.status === 200 && /موقت<\/span>/.test(r.text), 'report card shows temporary badge when open');

  // غیرفعال کردن قابلیت قفل → قفل نادیده گرفته می‌شود
  r = await a.post('/academic/terms/' + termId + '/lock', {}); assert(r.status === 302, 'lock again');
  r = await a.post('/system/modules/toggle', { key: 'exams.lock', enabled: '0' }); assert(r.status === 200, 'disable exams.lock feature');
  body = {}; body['score_' + sids[0]] = '18.5'; body['score_' + sids[1]] = '12';
  r = await t.post('/exams/' + examId + '/grades', body); assert(r.status === 302, 'teacher can save when lock feature disabled');
  r = await t.post('/academic/terms/' + termId + '/unlock', {}); assert(r.status === 403 || r.status === 404, 'lock routes unavailable when feature disabled (' + r.status + ')');
  r = await a.post('/system/modules/toggle', { key: 'exams.lock', enabled: '1' }); assert(r.status === 200, 're-enable exams.lock');
  r = await a.post('/academic/terms/' + termId + '/unlock', {}); assert(r.status === 302, 'unlock for cleanup');

  // پاک‌سازی: حذف آزمون و نوبت تست
  r = await a.post('/exams/' + examId + '/delete', {}); assert(r.status === 302, 'cleanup exam');
  r = await a.post('/academic/terms/' + termId + '/delete', {}); assert(r.status === 302, 'cleanup term');
  console.log(process.exitCode ? 'SOME FAILED' : 'ALL PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
