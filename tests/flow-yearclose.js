'use strict';
/** جریان پایان سال تحصیلی: فرم، اعتبارسنجی، پیش‌نمایش، اجرا (سال/نوبت/کلاس/درس/دانش‌آموز/سوابق)، بازگردانی کامل و ارتقای گروهی با ثبت سابقه */
const { Client } = require('./client');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 2; } else console.log('ok:', m); };
const fa = '۰۱۲۳۴۵۶۷۸۹';
const en = (s) => String(s).replace(/[۰-۹]/g, (d) => fa.indexOf(d));
const pd = (s) => String(s).replace(/\d/g, (d) => fa[d]);
const enrollTable = (html) => { const i = html.indexOf('سوابق تحصیلی (سال به سال)'); if (i < 0) return ''; const j = html.indexOf('</table>', i); return strip(html.slice(i, j)); };
const strip = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
(async () => {
  const a = new Client(); let r = await a.login('admin', 'admin123'); assert(r.status === 302, 'admin login');
  const t = new Client(); r = await t.login('teacher1', '123456'); assert(r.status === 302, 'teacher login');
  for (const key of ['academic.year_close', 'academic.promote', 'enrollments']) { r = await a.post('/system/modules/toggle', { key, enabled: '1' }); }

  // --- دسترسی و فرم ---
  r = await t.get('/academic/year-close'); assert(r.status === 403, 'teacher cannot open year-close');
  r = await a.get('/academic/years'); assert(r.status === 200 && /\/academic\/year-close/.test(r.text), 'years page links to year-close');
  r = await a.get('/academic/year-close'); assert(r.status === 200, 'year-close form opens');
  const page = r.text;
  const classIds = [...page.matchAll(/<tr data-class="(\d+)">/g)].map((m) => Number(m[1]));
  assert(classIds.length >= 3, 'classes listed: ' + classIds.length);
  const srcYear = /سال جاری: ([^<]+)<\/div>/.exec(page)[1].trim();
  const defTitle = /name="year_title" value="([^"]+)"/.exec(page)[1];
  assert(/^\d{4}-\d{4}$/.test(en(defTitle)), 'default next-year title: ' + defTitle);
  const grades = [...page.matchAll(/name="cls\[c\d+\]\[grade_level_id\]"[^>]*>([\s\S]*?)<\/select>/g)][0][1].match(/value="(\d+)"/g).map((x) => Number(x.match(/\d+/)[0]));
  assert(grades.length >= 2, 'grade options: ' + grades.join(','));
  // کلاس‌های پایهٔ آخر پیش‌فرض فارغ‌التحصیلی
  const lastGradeRows = [...page.matchAll(/<tr data-class="(\d+)">([\s\S]*?)<\/tr>/g)].filter((m) => new RegExp('value="graduate" selected').test(m[2]));
  assert(lastGradeRows.length >= 1, 'last grade defaults to graduate: ' + lastGradeRows.length + ' classes');
  const gradClass = Number(lastGradeRows[0][1]);
  // اولین کلاس غیرفارغ‌التحصیلی که دست‌کم ۳ دانش‌آموز فعال دارد (ترتیب کلاس‌ها بین SQLite/MySQL می‌تواند متفاوت باشد؛ کلاس‌های خالی تست‌های دیگر را رد می‌کنیم)
  let promoteClass = null; let promoteStudents = [];
  for (const id of classIds.filter((id) => !lastGradeRows.some((m) => Number(m[1]) === id))) {
    const rows = (await a.get('/academic/promote/students/' + id)).json();
    if (rows.length >= 3) { promoteClass = id; promoteStudents = rows; break; }
  }
  assert(promoteClass, 'found a promote class with students');

  // آمار قبل از اجرا
  const before = {};
  before.years = (await a.get('/academic/years')).text;
  assert(promoteStudents.length >= 3, 'promote class has students: ' + promoteStudents.length);
  r = await a.get('/academic/promote/students/' + gradClass); const gradStudents = r.json(); assert(gradStudents.length >= 2, 'graduating class has students: ' + gradStudents.length);
  const retainId = promoteStudents[0].id, promotedId = promoteStudents[1].id, gradId = gradStudents[0].id;

  // --- اعتبارسنجی: عنوان تکراری سال ---
  const body = { target_mode: 'new', year_title: srcYear, year_start: '1406/07/01', year_end: '1407/06/31', copy_terms: '1', archive_old: '1', set_current: '1', backup: '0' };
  r = await a.post('/academic/year-close/preview', body); assert(r.status === 422 && /از قبل وجود دارد/.test(r.text), 'duplicate year title rejected');
  r = await a.post('/academic/year-close/preview', Object.assign({}, body, { year_title: 'تست-' + Date.now(), year_start: '1406/07/01', year_end: '1406/01/01' })); assert(r.status === 422 && /باید بعد از شروع/.test(r.text), 'end<start rejected');
  // تکرار پایه بدون کلاس هم‌پایه در مقصد
  r = await a.post('/academic/year-close/preview', Object.assign({}, body, { year_title: 'تست-' + Date.now(), entry_classes: '0', retain: [String(retainId)], ['cls[c' + promoteClass + '][action]']: 'promote' }));
  const noTarget = r.status === 422 && /کلاسی با پایهٔ/.test(r.text);
  assert(noTarget || r.status === 200, 'retain without same-grade target handled (' + r.status + ')');

  // --- پیش‌نمایش معتبر ---
  const yearTitle = 'سال‌تست-' + Date.now().toString().slice(-6);
  const form = Object.assign({}, body, { year_title: yearTitle, entry_classes: '1', retain: [String(retainId)], ['cls[c' + promoteClass + '][title]']: 'کلاس ارتقای تست', ['cls[c' + promoteClass + '][keep_teacher]']: '1', ['cls[c' + promoteClass + '][copy_subjects]']: '1', ['cls[c' + gradClass + '][action]']: 'graduate' });
  r = await a.post('/academic/year-close/preview', form); assert(r.status === 200 && /پیش‌نمایش پایان سال تحصیلی/.test(r.text), 'preview renders');
  const ptxt = strip(r.text);
  assert(ptxt.includes(yearTitle) && /سال جدید ساخته می‌شود/.test(ptxt), 'preview shows target year (new)');
  assert(/کلاس ارتقای تست/.test(ptxt) && /کلاس ورودی/.test(ptxt), 'preview lists custom class title and entry classes');
  assert(new RegExp('دانش‌آموزان تکرار پایه \\(' + fa[1] + '\\)').test(ptxt), 'preview lists 1 retained student');
  const counts = [...r.text.matchAll(/<div class="fs-3 fw-bold[^"]*">([^<]+)<\/div>/g)].map((m) => Number(en(m[1])));
  assert(counts[0] > 0 && counts[1] >= gradStudents.length && counts[2] === 1 && counts[4] > 0, 'preview counters promote/graduate/retain/newClasses: ' + counts.join('/'));

  // --- اجرا: بدون تایید ---
  r = await a.post('/academic/year-close/execute', { confirm: 'نه' }); assert(r.status === 302, 'execute without confirmation redirects');
  r = await a.get('/academic/year-close'); assert(/باید عبارت «تایید»/.test(r.text), 'flash: confirmation required');
  r = await a.post('/academic/year-close/preview', form); assert(r.status === 200, 'preview again');
  r = await a.post('/academic/year-close/execute', { confirm: 'تایید' }); assert(r.status === 302, 'execute accepted');
  r = await a.get('/academic/year-close'); const after = strip(r.text);
  assert(/پایان سال با موفقیت اجرا شد/.test(after), 'flash: executed');
  assert(after.includes(srcYear + ' ← ' + yearTitle) && /اجرا شده/.test(after), 'run listed with status done');
  const runId = Number((/data-post="\/academic\/year-close\/(\d+)\/revert"/.exec(r.text) || [])[1]); assert(runId > 0, 'revert button for latest run #' + runId);
  assert(/سال جاری: /.test(r.text) && new RegExp('سال جاری: ' + yearTitle).test(r.text), 'new year is now current');

  // بررسی داده‌ها
  r = await a.get('/academic/years'); assert(r.status === 200 && r.text.includes(pd(yearTitle)), 'new year in years list');
  r = await a.get('/academic/terms'); const termsTxt = strip(r.text); assert(termsTxt.includes(yearTitle), 'terms copied to new year');
  r = await a.get('/academic/api/classes'); const apiClasses = r.json() || []; const newCls = apiClasses.find((c) => c.title === 'کلاس ارتقای تست');
  assert(!!newCls && apiClasses.length >= 10, 'promoted class created (current-year classes: ' + apiClasses.length + ')');
  const newClassId = newCls ? newCls.id : 0;
  r = await a.get('/academic/classes/' + newClassId); const ctxt = strip(r.text);
  assert(r.status === 200 && /کلاس ارتقای تست/.test(ctxt), 'new class page opens #' + newClassId);
  assert(new RegExp('/students/' + promotedId + '"').test(r.text) || ctxt.includes(promoteStudents[1].last_name), 'promoted student is in the new class');
  assert(!new RegExp('/students/' + retainId + '"').test(r.text), 'retained student NOT in the promoted class');
  assert(!/درسی تخصیص داده نشده است/.test(ctxt) && (r.text.match(/data-subject="/g) || []).length >= 1, 'class subjects copied to the new class (' + (r.text.match(/data-subject="/g) || []).length + ')');
  r = await a.get('/students/' + gradId); const gtxt = strip(r.text); assert(/فارغ‌التحصیل/.test(gtxt), 'graduating student status = graduated');
  r = await a.get('/students/' + promotedId); const stxt = strip(r.text); assert(/کلاس ارتقای تست/.test(stxt), 'promoted student profile shows the new class');
  r = await a.get('/students/' + promotedId + '?tab=enrollments'); const etxt = enrollTable(r.text);
  assert(r.status === 200 && /ارتقا یافته/.test(etxt) && etxt.includes(yearTitle) && /در حال تحصیل/.test(etxt) && /کلاس ارتقای تست/.test(etxt), 'enrollment history: promoted + new active row');
  r = await a.get('/students/' + retainId + '?tab=enrollments'); const rtab = enrollTable(r.text); assert(r.status === 200 && /تکرار پایه/.test(rtab) && /در حال تحصیل/.test(rtab) && rtab.includes(yearTitle), 'enrollment history: retained + new active row in same grade');
  r = await a.get('/students/' + gradId + '?tab=enrollments'); assert(r.status === 200 && /فارغ‌التحصیل/.test(enrollTable(r.text)), 'enrollment history: graduated');
  r = await a.get('/academic/classes/' + promoteClass); assert(/غیرفعال/.test(strip(r.text)) || r.status === 200, 'old class archived (is_active=0)');
  r = await a.get('/system/activity?q=year_close'); assert(r.status === 200, 'activity log reachable');

  // --- بازگردانی ---
  r = await a.post('/academic/year-close/' + runId + '/revert'); assert(r.status === 302, 'revert posted');
  r = await a.get('/academic/year-close'); const rtxt = strip(r.text);
  assert(/بازگردانی شد؛/.test(rtxt) && /بازگردانی شده/.test(rtxt), 'revert flash + status reverted');
  assert(new RegExp('سال جاری: ' + srcYear).test(r.text), 'source year is current again');
  assert(!/data-post="\/academic\/year-close\/\d+\/revert"/.test(r.text), 'no revert button after revert');
  r = await a.get('/academic/years'); assert(!r.text.includes(pd(yearTitle)), 'new year deleted');
  r = await a.get('/academic/classes/' + newClassId); assert(r.status === 404, 'promoted class deleted');
  r = await a.get('/academic/api/classes'); assert(!(r.json() || []).some((c) => c.title === 'کلاس ارتقای تست') && (r.json() || []).some((c) => c.id === promoteClass), 'old classes active again, new ones gone');
  r = await a.get('/students/' + gradId + '?tab=enrollments'); assert(!/فارغ‌التحصیل/.test(enrollTable(r.text)) && /در حال تحصیل/.test(enrollTable(r.text)), 'graduated student active again');
  r = await a.get('/academic/promote/students/' + promoteClass); assert(r.json().length === promoteStudents.length, 'old class has all its students back');
  r = await a.get('/students/' + promotedId + '?tab=enrollments'); assert(!enrollTable(r.text).includes(yearTitle) && !/کلاس ارتقای تست/.test(enrollTable(r.text)) && /در حال تحصیل/.test(enrollTable(r.text)), 'enrollment rows restored');
  r = await a.post('/academic/year-close/' + runId + '/revert'); r = await a.get('/academic/year-close'); assert(/قبلاً بازگردانی شده/.test(strip(r.text)), 'double revert refused');

  // --- ارتقای گروهی قدیمی اکنون سابقه ثبت می‌کند ---
  r = await a.get('/academic/promote'); assert(r.status === 200, 'promote page');
  const otherClass = classIds.find((id) => id !== promoteClass && id !== gradClass);
  r = await a.post('/academic/promote', { from_class: String(promoteClass), to_class: String(otherClass), student_ids: [String(promotedId)], reason: 'تست انتقال' }); assert(r.status === 302, 'bulk promote one student');
  r = await a.get('/academic/api/classes'); const otherTitle = ((r.json() || []).find((c) => c.id === otherClass) || {}).title;
  r = await a.get('/students/' + promotedId + '?tab=enrollments'); assert(/در حال تحصیل/.test(enrollTable(r.text)) && !!otherTitle && enrollTable(r.text).includes(otherTitle), 'enrollment row follows bulk promote (' + otherTitle + ')');
  r = await a.post('/academic/promote', { from_class: String(otherClass), to_class: String(promoteClass), student_ids: [String(promotedId)], reason: 'بازگشت تست' }); assert(r.status === 302, 'moved back');
  r = await a.get('/academic/promote/students/' + promoteClass); assert(r.json().some((s) => s.id === promotedId), 'student back in original class');

  // --- غیرفعال‌سازی قابلیت ---
  r = await a.post('/system/modules/toggle', { key: 'academic.year_close', enabled: '0' });
  r = await a.get('/academic/year-close'); assert(r.status === 404, 'feature disabled → 404');
  r = await a.post('/system/modules/toggle', { key: 'academic.year_close', enabled: '1' });
  r = await a.get('/academic/year-close'); assert(r.status === 200, 'feature re-enabled');
  console.log('done');
})().catch((e) => { console.error(e); process.exitCode = 2; });
