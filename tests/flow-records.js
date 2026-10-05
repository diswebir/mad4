'use strict';
// جریان پرونده‌ها: انضباط، سلامت، مشاوره، تقویم
const { Client } = require('./client');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 2; } else console.log('ok:', m); };
const lastId = (text, base) => (text.match(new RegExp(base.replace(/\//g, '\\/') + '\\/(\\d+)\\/edit', 'g')) || []).map((x) => Number(x.match(/(\d+)\/edit/)[1])).sort((x, y) => y - x)[0];
(async () => {
  const a = new Client(); let r = await a.login('admin', 'admin123'); assert(r.status === 302, 'admin login');
  const s = new Client(); r = await s.login('40001', '123456'); assert(r.status === 302, 'student login');
  const t = new Client(); r = await t.login('teacher1', '123456'); assert(r.status === 302, 'teacher login');
  r = await s.get('/students/me'); if (r.status === 302) r = await s.get(r.location); const sid = (r.location || '').match(/\d+/) ? null : null;
  const studentId = (await s.get('/students/me')).location.match(/\/students\/(\d+)/)[1]; assert(studentId, 'student id ' + studentId);
  // ---- انضباط
  r = await a.post('/discipline', { student_id: studentId, type: 'negative', category: 'late', points: '2', date: '1405/07/05', description: 'تأخیر ۱۵ دقیقه', action_taken: 'تذکر شفاهی', parent_notified: '1' }); assert(r.status === 302 && !/new/.test(r.location), 'create discipline');
  r = await a.post('/discipline', { student_id: studentId, type: 'positive', category: 'achievement', points: '5', date: '1405/07/06', description: 'رتبهٔ اول مسابقه' }); assert(r.status === 302, 'create positive');
  r = await a.get('/discipline?student_id=' + studentId); assert(/تأخیر ۱۵ دقیقه/.test(r.text) && /رتبهٔ اول/.test(r.text), 'list filtered by student');
  const did = lastId(r.text, '/discipline'); assert(did, 'discipline id ' + did);
  r = await s.get('/discipline/my'); assert(/تأخیر ۱۵ دقیقه/.test(r.text) && /رتبهٔ اول/.test(r.text), 'student sees own records');
  r = await s.get('/notifications'); assert(/انضباطی|تشویق/.test(r.text), 'student notified');
  r = await a.get('/students/' + studentId); assert(/انضباط|تشویق/.test(r.text), 'student profile shows discipline tab');
  r = await a.get('/discipline/report'); assert(r.status === 200, 'report page');
  r = await a.get('/discipline/export'); assert(r.status === 200 && /تأخیر/.test(r.text), 'export csv');
  r = await t.get('/discipline/new'); assert(r.status === 200, 'teacher form');
  r = await t.post('/discipline', { student_id: studentId, type: 'negative', category: 'behavior', points: '1', date: '1405/07/07', description: 'ثبت توسط معلم' }); assert(r.status === 302, 'teacher creates');
  r = await a.post(`/discipline/${did}/delete`, {}); assert(r.status === 302, 'delete');
  // ---- سلامت
  r = await a.post('/health', { student_id: studentId, date: '1405/07/01', type: 'checkup', title: 'معاینهٔ شروع سال', description: 'بینایی ۱۰/۱۰', action: '-', referred: '0' }); assert(r.status === 302 && !/new/.test(r.location), 'create health');
  r = await a.post('/health', { student_id: studentId, date: '1405/07/08', type: 'injury', title: 'زمین خوردن در حیاط', description: 'زخم سطحی', action: 'پانسمان', referred: '1' }); assert(r.status === 302, 'create injury (referred)');
  r = await a.get('/health?student_id=' + studentId); assert(/زمین خوردن/.test(r.text) && /معاینهٔ شروع سال/.test(r.text), 'health list');
  r = await a.get('/health/alerts'); assert(r.status === 200, 'alerts page');
  r = await s.get('/health/my'); assert(/زمین خوردن/.test(r.text), 'student sees own health');
  r = await t.get('/health/alerts'); assert(r.status === 200, 'teacher sees alerts');
  r = await t.get('/health'); assert(r.status === 403 || r.status === 200, 'teacher list status ' + r.status);
  const hid = lastId((await a.get('/health?student_id=' + studentId)).text, '/health'); r = await a.post(`/health/${hid}`, { student_id: studentId, date: '1405/07/08', type: 'injury', title: 'زمین خوردن در حیاط (ویرایش)', referred: '1' }); assert(r.status === 302, 'edit health');
  r = await a.get('/health?student_id=' + studentId); assert(/\(ویرایش\)/.test(r.text), 'edited');
  // ---- مشاوره
  r = await a.post('/counseling', { student_id: studentId, date: '1405/07/03', counselor_id: '1', topic: 'academic', summary: 'افت درسی ریاضی', follow_up_date: '1405/07/20', is_confidential: '0' }); assert(r.status === 302 && !/new/.test(r.location), 'create counseling');
  r = await a.post('/counseling', { student_id: studentId, date: '1405/07/04', counselor_id: '1', topic: 'family', summary: 'محرمانه خانوادگی', is_confidential: '1' }); assert(r.status === 302, 'create confidential');
  r = await a.get('/counseling?student_id=' + studentId); assert(/تحصیلی/.test(r.text) && /خانوادگی/.test(r.text), 'admin sees both');
  r = await a.get('/counseling?q=' + encodeURIComponent('محرمانه خانوادگی')); assert(/خانوادگی/.test(r.text), 'search by summary');
  r = await t.get('/counseling'); assert(r.status === 403 || !/خانوادگی/.test(r.text), 'teacher does not see confidential');
  r = await a.get('/counseling?followup=1'); assert(r.status === 200, 'follow-up filter');
  r = await s.get('/counseling/request'); assert(r.status === 302 && /tickets\/new/.test(r.location), 'student request → ticket');
  // ---- تقویم
  r = await a.post('/calendar/events', { title: 'اردوی علمی', type: 'trip', start_date: '1405/07/15', end_date: '1405/07/15', start_time: '08:00', end_time: '14:00', audience: 'students', description: 'موزه' }); assert(r.status === 302 && !/new/.test(r.location), 'create event');
  r = await a.post('/calendar/events', { title: 'تعطیل رسمی تست', type: 'holiday', start_date: '1405/07/22', audience: 'all' }); assert(r.status === 302, 'create holiday');
  r = await a.get('/calendar?month=1405/07'); assert(/اردوی علمی/.test(r.text) && /تعطیل رسمی تست/.test(r.text), 'month view shows events');
  r = await s.get('/calendar?month=1405/07'); assert(/اردوی علمی/.test(r.text), 'student sees student event');
  r = await a.post('/calendar/events', { title: 'جلسهٔ شورای معلمان', type: 'meeting', start_date: '1405/07/18', audience: 'teachers' }); assert(r.status === 302, 'teachers-only event');
  r = await s.get('/calendar?month=1405/07'); assert(!/جلسهٔ شورای معلمان/.test(r.text), 'student does not see teachers event');
  r = await t.get('/calendar?month=1405/07'); assert(/جلسهٔ شورای معلمان/.test(r.text), 'teacher sees it');
  r = await a.get('/calendar/ical'); assert(r.status === 200 && /BEGIN:VCALENDAR/.test(r.text) && /SUMMARY:اردوی علمی/.test(r.text), 'ical export');
  r = await a.get('/calendar/events?q=' + encodeURIComponent('اردوی علمی')); const eid = lastId(r.text, '/calendar/events'); assert(eid, 'event id');
  r = await a.post(`/calendar/events/${eid}/delete`, {}); assert(r.status === 302, 'delete event');
  r = await a.get('/dashboard'); assert(r.status === 200, 'dashboard ok');
  console.log(process.exitCode ? 'SOME FAILED' : 'ALL PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
