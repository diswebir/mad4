'use strict';
/** جریان: تعطیلات رسمی در حضور و غیاب (attendance.holidays) — خودبازگردان */
const { Client, superPost } = require('./client');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 2; } else console.log('ok:', m); };
const strip = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const lastId = (text, base) => (text.match(new RegExp(base.replace(/\//g, '\\/') + '\\/(\\d+)\\/edit', 'g')) || []).map((x) => Number(x.match(/(\d+)\/edit/)[1])).sort((x, y) => y - x)[0];
const J = require('../src/core/jalali');
const TITLE = 'تعطیلی آزمایشی حضور';

(async () => {
  const a = new Client(); let r = await a.login('admin', 'admin123'); assert(r.status === 302, 'admin login');
  for (const key of ['attendance.holidays', 'calendar.holidays', 'calendar.events', 'attendance.daily', 'attendance.monthly_report', 'attendance.class_report', 'attendance.student_report']) await superPost('/system/modules/toggle', { key, enabled: '1' });
  // پاک‌سازی رویدادهای باقی‌مانده از اجرای ناقص قبلی
  r = await a.get('/calendar/events?q=' + encodeURIComponent(TITLE)); let old = lastId(r.text, '/calendar/events');
  while (old) { await a.post(`/calendar/events/${old}/delete`, {}); r = await a.get('/calendar/events?q=' + encodeURIComponent(TITLE)); old = lastId(r.text, '/calendar/events'); }

  // نزدیک‌ترین روز کاری (شنبه تا چهارشنبه) در ۳ روز اخیر — داخل پنجرهٔ ویرایش معلم
  const today = J.todayISO(); let date = null;
  for (let back = 0; back <= 3 && !date; back++) { const d = J.addDays(today, -back); if ([0, 1, 2, 3, 4].includes(J.weekdayIndex(d))) date = d; }
  assert(date, 'picked school day ' + date);
  const jDate = J.toJalali(date); const parts = J.toJalaliParts(date);
  const classes = JSON.parse((await a.get('/academic/api/classes')).text); const cls = classes[classes.length - 1];
  assert(cls && cls.id, 'last class id ' + (cls && cls.id));

  // ۱) قبل از تعطیلی: صفحهٔ ثبت بدون هشدار
  const t = new Client(); r = await t.login('teacher1', '123456'); assert(r.status === 302, 'teacher login');
  r = await t.get('/attendance/take?class_id=1&date=' + date); assert(r.status === 200 && !/تعطیل رسمی/.test(r.text), 'no holiday warning before event');

  // ۲) ثبت تعطیلی در تقویم
  r = await a.post('/calendar/events', { title: TITLE, type: 'holiday', start_date: jDate, audience: 'all' }); assert(r.status === 302, 'create holiday event');
  r = await a.get('/calendar/events?q=' + encodeURIComponent(TITLE)); const eid = lastId(r.text, '/calendar/events'); assert(eid, 'holiday event id ' + eid);
  try {
    // ۳) معلم: هشدار + قفل فرم + منع POST
    r = await t.get('/attendance?date=' + date); assert(r.status === 200 && /تعطیل رسمی/.test(r.text) && r.text.includes(TITLE), 'index shows holiday banner for teacher');
    r = await t.get('/attendance/take?class_id=1&date=' + date); assert(r.status === 200 && /تعطیل رسمی/.test(r.text), 'take page shows holiday');
    assert(!/ثبت حضور و غیاب<\/button>/.test(r.text), 'submit button hidden for teacher on holiday');
    assert(!/مهلت ویرایش معلمان/.test(r.text), 'edit-window message not shown for holiday lock');
    r = await t.post('/attendance/take', { class_id: '1', date, status_1: 'present' }); assert(r.status === 302 && (r.location || '').includes('/attendance?date=' + date), 'teacher POST blocked -> ' + r.location);
    r = await t.get('/attendance?date=' + date); assert(/تعطیل رسمی است/.test(strip(r.text)) && /مجاز نیست/.test(strip(r.text)), 'teacher sees block flash');

    // ۴) مدیر: بدون تأیید → بازگشت با هشدار؛ با تأیید → ثبت
    r = await a.get('/attendance/take?class_id=' + cls.id + '&date=' + date); assert(r.status === 200 && /confirm_holiday/.test(r.text), 'admin sees confirm_holiday checkbox');
    const ids = [...r.text.matchAll(/name="status_(\d+)"/g)].map((m) => m[1]).filter((v, i, arr) => arr.indexOf(v) === i);
    assert(ids.length > 0, 'students in form: ' + ids.length);
    const body = { class_id: String(cls.id), date }; ids.forEach((id) => { body['status_' + id] = 'present'; });
    r = await a.post('/attendance/take', body); assert(r.status === 302 && (r.location || '').includes('/attendance/take?class_id=' + cls.id), 'admin POST without confirm redirected back -> ' + r.location);
    r = await a.get(r.location); assert(/علامت بزنید/.test(strip(r.text)), 'admin warning flash shown');
    r = await a.post('/attendance/take', Object.assign({ confirm_holiday: '1' }, body)); assert(r.status === 302 && (r.location || '').includes('/attendance?date=' + date), 'admin POST with confirm saved -> ' + r.location);
    r = await a.get('/attendance?date=' + date); assert(/ثبت شد/.test(strip(r.text)), 'admin success flash');

    // ۵) گزارش‌ها
    r = await a.get(`/attendance/report/monthly?class_id=${cls.id}&jy=${parts.jy}&jm=${parts.jm}`); assert(r.status === 200 && r.text.includes('تعطیل: ' + TITLE), 'monthly report marks holiday');
    r = await a.get(`/attendance/report/class/${cls.id}?from=${jDate}&to=${jDate}`); const txt = strip(r.text);
    assert(/روز آموزشی بازه/.test(txt) && /تعطیل رسمی کسر شد/.test(txt), 'class report subtracts holiday from school days');
    assert(/۰ روز آموزشی/.test(txt), 'single holiday range → 0 school days');
    r = await a.get(`/attendance/report/student/${ids[0]}?jy=${parts.jy}&jm=${parts.jm}`); assert(r.status === 200 && /تعطیل: /.test(r.text), 'student report calendar marks holiday');
    // دفتر کلاسی هم از همان سرویس استفاده می‌کند
    r = await a.get('/lessons/missing?from=' + jDate + '&to=' + jDate); assert(r.status === 200, 'lessons missing page ok on holiday range');

    // ۶) خاموش‌کردن قابلیت: رفتار قبلی
    r = await superPost('/system/modules/toggle', { key: 'attendance.holidays', enabled: '0' }); assert(r.status === 302 || r.status === 200, 'disable attendance.holidays');
    r = await t.get('/attendance/take?class_id=1&date=' + date); assert(r.status === 200 && !/تعطیل رسمی/.test(r.text) && /ثبت حضور و غیاب<\/button>/.test(r.text), 'feature off: teacher form unlocked');
    r = await a.get(`/attendance/report/monthly?class_id=${cls.id}&jy=${parts.jy}&jm=${parts.jm}`); assert(!r.text.includes('تعطیل: ' + TITLE), 'feature off: monthly report plain');
    r = await superPost('/system/modules/toggle', { key: 'attendance.holidays', enabled: '1' }); assert(r.status === 302 || r.status === 200, 're-enable attendance.holidays');
  } finally {
    r = await a.post(`/calendar/events/${eid}/delete`, {}); assert(r.status === 302, 'cleanup: delete holiday event');
  }
  r = await t.get('/attendance/take?class_id=1&date=' + date); assert(r.status === 200 && !/تعطیل رسمی/.test(r.text), 'after cleanup: no holiday warning');
  console.log('done');
})().catch((e) => { console.error(e); process.exit(1); });
