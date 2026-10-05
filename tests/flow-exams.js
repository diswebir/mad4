'use strict';
/** تست جریان آزمون‌ها: ایجاد → ثبت نمره → انتشار → مشاهده دانش‌آموز → نظر معلم → خروجی → حذف */
const { Client } = require('./client');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 2; } else console.log('ok:', m); };
const en = (s) => String(s).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
(async () => {
  const a = new Client(); let r = await a.login('admin', 'admin123'); assert(r.status === 302, 'admin login');
  r = await a.get('/exams/new?class_id=1'); assert(r.status === 200 && /class_subject_id/.test(r.text), 'exam form');
  r = await a.get('/exams/api/class-subjects/1'); const cs = r.json(); assert(Array.isArray(cs) && cs.length > 0, 'class-subjects api');
  const title = 'آزمون تستی ' + Date.now();
  r = await a.post('/exams', { class_subject_id: cs[0].id, term_id: 1, title, type: 'midterm', date: '۱۴۰۵/۰۷/۱۵', max_score: '۲۰', weight: 1, description: 'تست' });
  assert(r.status === 302 && /\/exams\/\d+/.test(r.location || ''), 'create exam (persian digits date/score) → ' + r.location);
  const examId = Number((/\/exams\/(\d+)/.exec(r.location || '') || [])[1]);
  r = await a.post('/exams', { class_subject_id: cs[0].id, title: '', date: '' }); assert(r.status === 302 && /\/exams\/new/.test(r.location), 'validation redirects back');
  r = await a.get('/exams/' + examId); assert(r.status === 200 && r.text.includes(title) && /score_\d+/.test(r.text), 'exam show with grade inputs');
  const sids = [...r.text.matchAll(/name="score_(\d+)"/g)].map((m) => Number(m[1])); assert(sids.length >= 10, 'students in grade sheet: ' + sids.length);
  const body = {}; body['score_' + sids[0]] = '۱۸/۵'; body['score_' + sids[1]] = '7'; body['score_' + sids[2]] = '25'; body['absent_' + sids[3]] = '1'; body['note_' + sids[3]] = 'مریض'; body['score_' + sids[4]] = '12.25'; body['desc_' + sids[4]] = '3'; if (sids.includes(1)) body.score_1 = '15';
  r = await a.post('/exams/' + examId + '/grades', body); assert(r.status === 302, 'save grades');
  r = await a.get('/exams/' + examId);
  assert(r.text.includes('value="۱۸.۵"') || r.text.includes('value="۱۸٫۵"') || /value="۱۸[.٫]۵"/.test(r.text), 'persian decimal score stored (18.5)');
  assert(/نامعتبر/.test(r.text) || !/value="۲۵"/.test(r.text), 'out-of-range score rejected');
  assert(/غایب/.test(r.text), 'absent recorded');
  // قبل از انتشار دانش‌آموز نمره را نمی‌بیند
  const s = new Client(); r = await s.login('40001', '123456'); assert(r.status === 302, 'student login');
  r = await s.get('/exams/my?term_id=1'); assert(r.status === 200 && !new RegExp('<td[^>]*>[^<]*' + title).test(r.text), 'student does not see unpublished exam grade');
  r = await a.post('/exams/' + examId + '/publish', {}); assert(r.status === 302, 'publish exam');
  r = await s.get('/exams/my?term_id=1'); assert(r.status === 200 && new RegExp('<td[^>]*>[^<]*' + title).test(r.text), 'student sees published exam (grade row)');
  r = await s.get('/exams/report-card/1?term_id=1'); assert(r.status === 200 && /کارنامه/.test(r.text), 'student report card');
  r = await s.get('/exams/report-card/2'); assert(r.status === 403, 'student cannot view other report card');
  r = await s.get('/exams/' + examId); assert(r.status === 403 || r.status === 302, 'student cannot open grade sheet');
  r = await s.get('/exams/schedule'); assert(r.status === 200 && r.text.includes(title), 'student schedule lists exam');
  // نظر معلم
  r = await a.post('/exams/remarks/1', { term_id: 1, remark: 'پیشرفت خوبی داشته است' }); assert(r.status === 302, 'save remark');
  r = await a.get('/exams/report-card/1?term_id=1'); assert(r.text.includes('پیشرفت خوبی داشته است'), 'remark shown');
  r = await a.get('/exams/report-card/1?term_id=1&print=1'); assert(r.status === 200 && !/sidebar/.test(r.text), 'print layout');
  r = await a.get('/exams/class/1?term_id=1&export=1'); assert(r.status === 200 && /^\uFEFF?شماره,نام,/.test(r.text), 'class sheet csv export');
  r = await a.get('/exams/analytics?class_id=1&term_id=1'); assert(r.status === 200 && /chart/i.test(r.text), 'analytics');
  r = await a.get('/exams?status=ungraded'); assert(r.status === 200, 'filter ungraded');
  r = await a.get('/exams?q=' + encodeURIComponent(title)); assert(r.status === 200 && r.text.includes(title), 'search exam');
  // ویرایش
  r = await a.post('/exams/' + examId, { class_subject_id: cs[0].id, term_id: 1, title: title + ' ویرایش', type: 'final', date: '1405/07/16', max_score: 20, weight: 2 }); assert(r.status === 302, 'edit exam');
  r = await a.get('/exams/' + examId); assert(r.text.includes(title + ' ویرایش'), 'edit persisted');
  // معلم غیرمرتبط
  const t = new Client(); r = await t.login('teacher1', '123456'); assert(r.status === 302, 'teacher login');
  r = await t.get('/exams'); assert(r.status === 200, 'teacher exams list');
  r = await t.get('/exams/my'); assert(r.status === 403 || r.status === 302, 'teacher cannot open student view');
  // حذف
  r = await a.post('/exams/' + examId + '/delete', {}); assert(r.status === 302, 'delete exam');
  r = await a.get('/exams/' + examId); assert(r.status === 404, 'exam gone');
  console.log('done');
})().catch((e) => { console.error(e); process.exit(1); });
