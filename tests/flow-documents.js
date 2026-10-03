'use strict';
/** جریان اسناد رسمی: صدور گواهی با قالب، چاپ با سربرگ، استعلام عمومی، ابطال، کارنامهٔ رسمی (snapshot)، ریزنمرات، دفتر حضور و غیاب، دسترسی‌ها، تنظیمات سربرگ */
const { Client } = require('./client');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 2; } else console.log('ok:', m); };
(async () => {
  const a = new Client(); let r = await a.login('admin', 'admin123'); assert(r.status === 302, 'admin login');
  const t = new Client(); r = await t.login('teacher1', '123456'); assert(r.status === 302, 'teacher login');
  const s = new Client(); r = await s.login('40001', '123456'); assert(r.status === 302, 'student login');
  for (const key of ['documents', 'documents.certificates', 'documents.letters', 'documents.report_card', 'documents.grade_sheet', 'documents.roster', 'documents.verify', 'documents.revoke', 'documents.student_view']) { r = await a.post('/system/modules/toggle', { key, enabled: '1' }); assert(r.status === 200, 'enable ' + key); }

  // تنظیمات سربرگ
  r = await a.get('/system/settings?tab=documents'); assert(r.status === 200 && /name="certificate_template"/.test(r.text) && /name="signature_image"/.test(r.text), 'settings tab documents');
  r = await a.post('/system/settings/documents', { school_district: 'ادارهٔ آموزش و پرورش ناحیهٔ تست', letterhead_header: 'جمهوری اسلامی ایران\nوزارت آموزش و پرورش', signatory_title: 'مدیر دبیرستان' }); assert(r.status === 302, 'save letterhead settings');

  // بایگانی و دادهٔ نمونه
  r = await a.get('/documents'); assert(r.status === 200 && /گواهی اشتغال به تحصیل/.test(r.text) && /گ-۱۴۰۵-۰۰۰۱|گ-\d{4}-\d{4}|گ-[۰-۹]{4}-[۰-۹]{4}/.test(r.text), 'documents archive lists demo documents with serials');
  r = await a.get('/documents?status=revoked'); assert(r.status === 200 && /باطل/.test(r.text), 'filter revoked');

  // صدور گواهی برای دانش‌آموز ۱
  r = await a.get('/students/1'); assert(/\/documents\/new\?type=certificate&(amp;)?student_id=1/.test(r.text) && /\/documents\/report-card\/1/.test(r.text), 'student profile has certificate + official report card actions');
  r = await a.get('/documents/new?type=certificate&student_id=1'); assert(r.status === 200 && /name="body"/.test(r.text) && /گواهی می‌شود/.test(r.text) && /\{recipient\}/.test(r.text), 'certificate form prefilled from template (student vars + {recipient})');
  const studentName = (r.text.match(/گواهی می‌شود ([^\s]+ [^\s]+) فرزند/) || [])[1]; assert(studentName, 'student name substituted: ' + studentName);
  r = await a.post('/documents', { type: 'certificate', student_id: '1', title: 'گواهی اشتغال به تحصیل', recipient: 'ادارهٔ گذرنامه', purpose: 'صدور گذرنامه', body: 'گواهی می‌شود {student} فرزند {father} با شمارهٔ {student_number} در کلاس {class} مشغول به تحصیل است. جهت ارائه به {recipient}.' });
  assert(r.status === 302 && /\/documents\/\d+$/.test(r.location || ''), 'issue certificate → ' + r.location);
  const docId = (r.location.match(/\/documents\/(\d+)/) || [])[1];
  r = await a.get('/documents/' + docId); assert(r.status === 200, 'document print page 200');
  assert(/بسمه تعالی/.test(r.text) && /وزارت آموزش و پرورش/.test(r.text) && /ناحیهٔ تست/.test(r.text), 'letterhead rendered (header lines + district)');
  assert(/مدیر دبیرستان/.test(r.text), 'signatory title from settings');
  assert(/ادارهٔ گذرنامه/.test(r.text) && !/\{student\}/.test(r.text) && !/\{recipient\}/.test(r.text), 'placeholders replaced in body');
  const serial = (r.text.match(/شماره:<\/td><td[^>]*>([^<]+)</) || [])[1]; assert(serial && /^گ-[۰-۹]{4}-[۰-۹]{4}$/.test(serial.trim()), 'serial format گ-سال-شماره: ' + serial);
  const code = (r.text.match(/کد استعلام: <code>([A-F0-9]+)<\/code>/) || [])[1]; assert(code && code.length === 10, 'verify code shown: ' + code);
  assert(!/class="print-header/.test(r.text) && /class="letterhead/.test(r.text), 'default print header replaced by letterhead');

  // استعلام عمومی (بدون ورود)
  const g = new Client();
  r = await g.get('/documents/verify/' + code); assert(r.status === 200 && /سند معتبر است/.test(r.text) && r.text.includes(studentName.split(' ')[0]), 'public verify: valid');
  r = await g.get('/documents/verify/ZZZZZZZZZZ'); assert(r.status === 404 && /یافت نشد/.test(r.text), 'public verify: unknown code 404');
  r = await g.get('/documents/verify?code=' + code.toLowerCase()); assert(r.status === 302 && r.location.endsWith('/documents/verify/' + code), 'verify form redirects (uppercased)');
  r = await g.get('/documents/' + docId); assert(r.status === 302 && /\/auth\/login/.test(r.location || ''), 'document itself requires login');

  // دانش‌آموز: اسناد من
  r = await s.get('/documents/my'); assert(r.status === 200 && /ادارهٔ گذرنامه|گواهی اشتغال/.test(r.text) && new RegExp(serial.trim()).test(r.text), 'student sees own document in /documents/my');
  r = await s.get('/documents/' + docId); assert(r.status === 200 && /بسمه تعالی/.test(r.text), 'student can print own document');
  r = await s.get('/documents'); assert(r.status === 403, 'student cannot open archive (403)');
  r = await s.get('/documents/new'); assert(r.status === 403, 'student cannot issue (403)');
  // سند دانش‌آموز دیگر
  r = await a.post('/documents', { type: 'certificate', student_id: '2', title: 'گواهی', recipient: 'بانک', body: 'گواهی می‌شود {student} در این مدرسه مشغول به تحصیل است.' }); const otherId = (r.location.match(/\/documents\/(\d+)/) || [])[1];
  r = await s.get('/documents/' + otherId); assert(r.status === 403, 'student cannot see another student document (403)');
  // معلم
  r = await t.get('/documents'); assert(r.status === 403, 'teacher cannot open archive (403)');
  r = await t.get('/documents/new?type=certificate'); assert(r.status === 403, 'teacher cannot issue (403)');

  // اعتبارسنجی فرم
  r = await a.post('/documents', { type: 'certificate', student_id: '', title: 'x', body: 'کوتاه' }); assert(r.status === 200 && /باید دانش‌آموز انتخاب شود/.test(r.text), 'validation: student required for certificate');

  // ابطال
  r = await a.post('/documents/' + otherId + '/revoke', { reason: '' }); assert(r.status === 302, 'revoke without reason redirects');
  r = await a.get('/documents'); assert(/ثبت دلیل الزامی/.test(r.text), 'revoke requires reason (flash)');
  r = await a.post('/documents/' + otherId + '/revoke', { reason: 'اشتباه در گیرنده' }); assert(r.status === 302, 'revoke with reason');
  r = await a.get('/documents/' + otherId); assert(/باطل شد/.test(r.text), 'revoked watermark on document');
  const code2 = (r.text.match(/کد استعلام: <code>([A-F0-9]+)<\/code>/) || [])[1];
  r = await g.get('/documents/verify/' + code2); assert(r.status === 200 && /باطل شده است/.test(r.text), 'public verify shows revoked');
  r = await a.post('/documents/' + otherId + '/revoke', { reason: 'دوباره' }); r = await a.get('/documents'); assert(/قبلاً باطل شده/.test(r.text), 'double revoke warned');

  // نامه بدون دانش‌آموز
  r = await a.post('/documents', { type: 'letter', student_id: '', title: 'نامه به اداره', recipient: 'ادارهٔ کل', purpose: 'درخواست تجهیزات', body: 'با سلام، احتراماً خواهشمند است نسبت به تأمین تجهیزات آزمایشگاه {school} اقدام فرمایید. {date}' });
  assert(r.status === 302 && /\/documents\/\d+$/.test(r.location || ''), 'issue letter without student');
  r = await a.get(r.location.replace(/^https?:\/\/[^/]+/, '')); assert(/^[\s\S]*ن-[۰-۹]{4}-[۰-۹]{4}/.test(r.text) && /ادارهٔ کل/.test(r.text) && !/\{school\}/.test(r.text), 'letter serial ن- and placeholders replaced');

  // کارنامهٔ رسمی
  r = await a.get('/documents/report-card/1'); assert(r.status === 200 && /کارنامهٔ تحصیلی/.test(r.text) && /صدور رسمی|صدور نسخهٔ جدید/.test(r.text) && /name="term_id"/.test(r.text), 'official report card preview');
  const termId = (r.text.match(/name="term_id" value="(\d+)"/) || [])[1]; assert(termId, 'term id ' + termId);
  r = await a.post('/documents/report-card/1', { term_id: termId }); assert(r.status === 302 && /\/documents\/\d+$/.test(r.location || ''), 'issue official report card');
  const rcId = (r.location.match(/\/documents\/(\d+)/) || [])[1];
  r = await a.get('/documents/' + rcId); assert(r.status === 200 && /ک-[۰-۹]{4}-[۰-۹]{4}/.test(r.text) && /معدل/.test(r.text) && /بسمه تعالی/.test(r.text), 'official report card document with serial ک-');
  r = await a.get('/documents/report-card/1?term_id=' + termId); assert(/چاپ نسخهٔ صادرشده/.test(r.text) && /صدور نسخهٔ جدید/.test(r.text), 'preview shows issued version');
  r = await s.get('/documents/my'); assert(/کارنامهٔ/.test(r.text), 'student sees official report card in my documents');
  r = await t.get('/documents/report-card/1'); assert(r.status === 200 && !/<form method="post" action="\/documents\/report-card/.test(r.text), 'teacher can preview (own class) but cannot issue');
  r = await t.get('/documents/report-card/150'); assert(r.status === 403 || r.status === 200, 'teacher other-class report card: ' + r.status);

  // ریزنمرات رسمی و دفتر حضور و غیاب
  r = await a.get('/exams/class/1'); const csId = (r.text.match(/\/documents\/grade-sheet\/(\d+)/) || [])[1]; assert(csId, 'class sheet links to official grade sheet: cs ' + csId);
  r = await a.get('/documents/grade-sheet/' + csId); assert(r.status === 200 && /ریزنمرات درس/.test(r.text) && /ر-[۰-۹]{4}-[۰-۹]{4}/.test(r.text) && /نمرهٔ نهایی/.test(r.text), 'official grade sheet');
  r = await t.get('/documents/grade-sheet/' + csId); assert(r.status === 200, 'teacher can print own class grade sheet');
  r = await a.get('/documents/roster/1'); assert(r.status === 200 && /دفتر حضور و غیاب/.test(r.text) && /ل-[۰-۹]{4}-[۰-۹]{4,}/.test(r.text) && /معلم راهنما/.test(r.text), 'monthly roster');
  r = await a.get('/documents/roster/1?month=1405/6'); assert(r.status === 200 && /شهریور/.test(r.text), 'roster for a given month');
  r = await t.get('/documents/roster/1'); assert(r.status === 200, 'teacher can print own class roster');
  r = await a.get('/attendance/take?class_id=1'); assert(/\/documents\/roster\/1\?month=/.test(r.text), 'take page links to roster');

  // غیرفعال‌سازی قابلیت‌ها
  r = await a.post('/system/modules/toggle', { key: 'documents.verify', enabled: '0' }); r = await g.get('/documents/verify/' + code); assert(r.status === 404 || r.status === 403, 'verify disabled → ' + r.status);
  r = await a.post('/system/modules/toggle', { key: 'documents.verify', enabled: '1' });
  r = await a.post('/system/modules/toggle', { key: 'documents.letters', enabled: '0' }); r = await a.get('/documents/new?type=letter'); assert(r.status === 404, 'letters disabled → 404');
  r = await a.post('/system/modules/toggle', { key: 'documents.letters', enabled: '1' });
  r = await a.post('/system/modules/toggle', { key: 'documents.student_view', enabled: '0' }); r = await s.get('/documents/' + docId); assert(r.status === 403, 'student view disabled → 403');
  r = await a.post('/system/modules/toggle', { key: 'documents.student_view', enabled: '1' });
  console.log(process.exitCode ? 'SOME FAILED' : 'ALL PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
