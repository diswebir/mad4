'use strict';
/** جریان: برنامهٔ هفتگی حرفه‌ای — مودال هوشمند (slot-info)، ساعات در دسترس‌نبودن معلم، تولید خودکار برای یک کلاس و سراسری با پیش‌نمایش */
const { Client } = require('./client');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 2; } else console.log('ok:', m); };
const en = (s) => String(s).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));

(async () => {
  const a = new Client(); let r = await a.login('admin', 'admin123'); assert(r.status === 302, 'admin login');
  for (const k of ['academic.schedule', 'academic.schedule_auto', 'academic.teacher_availability', 'academic.class_subjects']) await a.post('/system/modules/toggle', { key: k, enabled: '1' });

  // دروس/معلمان کلاس ۱ (هفتم الف) — دو درس با معلم را برمی‌داریم تا در کلاس تست استفاده کنیم
  r = await a.get('/academic/classes/1');
  const pairs = [...r.text.matchAll(/data-subject="(\d+)" data-teacher="(\d+)" data-hours="(\d+)"/g)].map((m) => ({ subject: Number(m[1]), teacher: Number(m[2]), hours: Number(m[3]) }));
  assert(pairs.length >= 2, 'class 1 has subjects with teachers: ' + pairs.length);
  const s1 = pairs[0], s2 = pairs.find((p) => p.teacher !== s1.teacher) || pairs[1];

  // کلاس تست
  const tag = 'TT' + Math.floor(Math.random() * 1e6);
  r = await a.post('/academic/classes', { title: 'کلاس برنامه ' + tag, academic_year_id: '1', grade_level_id: '1', capacity: '20', shift: 'morning', is_active: '1' });
  assert(r.status === 302 && !/new/.test(r.location || ''), 'test class created');
  r = await a.get('/academic/classes?q=' + encodeURIComponent('کلاس برنامه ' + tag));
  const cid = Number(([...r.text.matchAll(/\/academic\/classes\/(\d+)\/edit/g)].map((m) => m[1]).pop()) || 0); assert(cid > 0, 'class id ' + cid);
  r = await a.post(`/academic/classes/${cid}/subjects`, { subject_id: String(s1.subject), teacher_id: String(s1.teacher), weekly_hours: '3' }); assert(r.status === 302, 'assign subject 1 (3h)');
  r = await a.post(`/academic/classes/${cid}/subjects`, { subject_id: String(s2.subject), teacher_id: String(s2.teacher), weekly_hours: '2' }); assert(r.status === 302, 'assign subject 2 (2h)');

  // صفحهٔ برنامهٔ کلاس: پوشش ۰/۵ و مودال هوشمند
  r = await a.get(`/academic/schedule/class/${cid}`);
  assert(r.status === 200 && /پوشش ساعات هفتگی/.test(r.text) && /۰ \/ ۵ زنگ/.test(r.text) && /id="slotModal"/.test(r.text) && /id="autoModal"/.test(r.text) && /slot-info/.test(r.text), 'class schedule page: coverage 0/5, smart modal, auto modal');

  // slot-info: پیدا کردن خانه‌ای که معلم ۱ در کلاس ۱ مشغول است و خانه‌ای که آزاد است
  let busyCell = null, freeCell = null, info = null;
  for (let d = 0; d <= 4 && !(busyCell && freeCell); d++) for (let p = 1; p <= 5 && !(busyCell && freeCell); p++) {
    r = await a.get(`/academic/schedule/class/${cid}/slot-info?day=${d}&period=${p}`); const j = r.json();
    if (!j || !j.ok) continue;
    const me = j.subjects.find((x) => x.teacher_id === s1.teacher);
    if (me && me.status === 'busy' && !busyCell) { busyCell = { d, p }; info = j; }
    if (me && me.status === 'free' && !freeCell) freeCell = { d, p };
  }
  assert(info && info.subjects.length === 2 && info.rooms.length >= 1, 'slot-info returns both subjects + rooms');
  assert(busyCell && /در کلاس «/.test(info.subjects.find((x) => x.teacher_id === s1.teacher).detail), 'slot-info marks teacher busy in another class: ' + JSON.stringify(busyCell));
  assert(freeCell, 'a free cell exists for teacher 1: ' + JSON.stringify(freeCell));
  const csId1 = info.subjects.find((x) => x.teacher_id === s1.teacher).id;
  // قرار دادن در خانهٔ تداخل → 400
  r = await a.post(`/academic/schedule/class/${cid}/slot`, { day: String(busyCell.d), period: String(busyCell.p), class_subject_id: String(csId1) }, { json: true });
  assert(r.status === 400 && /تداخل/.test(r.text), 'placing on busy cell rejected (400 تداخل)');

  // در دسترس‌نبودن معلم ۱ در خانهٔ آزاد
  r = await a.post(`/academic/schedule/teacher/${s1.teacher}/availability`, { day: String(freeCell.d), period: String(freeCell.p), status: 'unavailable', note: 'مدرسهٔ دیگر' }, { json: true });
  assert(r.status === 200 && r.json().ok, 'admin marks teacher unavailable');
  r = await a.get(`/academic/schedule/teacher/${s1.teacher}`); assert(/unavail/.test(r.text) && /مدرسهٔ دیگر/.test(r.text) && /id="availModal"/.test(r.text), 'teacher schedule page shows unavailable cell + modal');
  r = await a.get(`/academic/schedule/class/${cid}/slot-info?day=${freeCell.d}&period=${freeCell.p}`);
  assert(r.json().subjects.find((x) => x.id === csId1).status === 'unavailable', 'slot-info now says unavailable');
  r = await a.post(`/academic/schedule/class/${cid}/slot`, { day: String(freeCell.d), period: String(freeCell.p), class_subject_id: String(csId1) }, { json: true });
  assert(r.status === 400 && /در دسترس نیست/.test(r.text), 'placing on unavailable cell rejected');
  r = await a.post(`/academic/schedule/class/${cid}/slot`, { day: String(freeCell.d), period: String(freeCell.p), class_subject_id: String(csId1), force: '1' }, { json: true });
  assert(r.status === 200 && r.json().ok && r.json().forced === true && r.json().slot.class_subject_id === csId1, 'force placement works and is flagged');
  r = await a.get(`/academic/schedule/class/${cid}/slot-info?day=${freeCell.d}&period=${freeCell.p}`); assert(r.json().current === csId1 && r.json().subjects.find((x) => x.id === csId1).status === 'current', 'slot-info reports current');
  r = await a.post(`/academic/schedule/class/${cid}/slot`, { day: String(freeCell.d), period: String(freeCell.p), class_subject_id: '' }, { json: true }); assert(r.json().cleared, 'cleared again');
  // هشدار هنگام علامت‌گذاری زنگی که معلم در آن درس دارد
  r = await a.post(`/academic/schedule/teacher/${s1.teacher}/availability`, { day: String(busyCell.d), period: String(busyCell.p), status: 'unavailable', note: '' }, { json: true });
  assert(r.json().ok && /برنامه دارد/.test(r.json().warning || ''), 'marking a scheduled slot unavailable returns warning');
  r = await a.post(`/academic/schedule/teacher/${s1.teacher}/availability`, { day: String(busyCell.d), period: String(busyCell.p), status: 'available' }, { json: true }); assert(r.json().ok, 'reverted');

  // معلم: فقط برنامهٔ خودش
  const t = new Client(); r = await t.login('teacher1', '123456'); assert(r.status === 302, 'teacher login');
  r = await t.get('/academic/schedule'); const myId = Number((/\/academic\/schedule\/teacher\/(\d+)/.exec(r.location || '') || [])[1]); assert(myId > 0, 'teacher redirected to own schedule ' + myId);
  r = await t.get(`/academic/schedule/teacher/${myId}`); assert(r.status === 200 && /avail-cell/.test(r.text), 'teacher can edit own availability');
  r = await t.post(`/academic/schedule/teacher/${myId}/availability`, { day: '4', period: '5', status: 'unavailable', note: 'تست' }, { json: true }); assert(r.status === 200 && r.json().ok, 'teacher marks own cell');
  const otherT = myId === s1.teacher ? s2.teacher : s1.teacher;
  r = await t.post(`/academic/schedule/teacher/${otherT}/availability`, { day: '4', period: '5', status: 'unavailable' }, { json: true }); assert(r.status === 403, 'teacher cannot edit another teacher');
  r = await t.post(`/academic/schedule/teacher/${myId}/availability`, { day: '4', period: '5', status: 'available' }, { json: true }); assert(r.json().ok, 'teacher clears own cell');
  r = await t.get(`/academic/schedule/class/${cid}/slot-info?day=0&period=1`); assert(r.status === 403 || r.status === 302, 'teacher cannot call slot-info');

  // تولید خودکار برای کلاس تست (replace)
  r = await a.post(`/academic/schedule/class/${cid}/auto`, { mode: 'replace', max_per_day: '2', allow_double: '1' }); assert(r.status === 302, 'auto for class posted');
  r = await a.get(`/academic/schedule/class/${cid}`);
  assert(/زنگ به برنامه افزوده شد/.test(r.text) && /۵ \/ ۵ زنگ \(۱۰۰٪\)/.test(r.text), 'auto placed all 5 hours (coverage 100%)');
  const cells = [...r.text.matchAll(/id="cell-(\d)-(\d+)"[^>]*data-cs="(\d+)"/g)].map((m) => ({ d: Number(m[1]), p: Number(m[2]), cs: Number(m[3]) }));
  assert(cells.length === 5, '5 filled cells');
  const perDay = {}; for (const c of cells.filter((c) => c.cs === csId1)) perDay[c.d] = (perDay[c.d] || 0) + 1; assert(Object.values(perDay).every((n) => n <= 2) && Object.keys(perDay).length >= 2, 'subject 1 spread over ≥2 days, ≤2 per day');
  assert(!cells.some((c) => c.cs === csId1 && c.d === freeCell.d && c.p === freeCell.p), 'unavailable cell not used for teacher 1');
  // بدون تداخل: slot-info هر خانهٔ پر باید وضعیت current بدهد و معلم در کلاس دیگر نباشد
  let clash = 0;
  for (const c of cells) { r = await a.get(`/academic/schedule/class/${cid}/slot-info?day=${c.d}&period=${c.p}`); const me = r.json().subjects.find((x) => x.id === c.cs); if (!me || me.status !== 'current') clash++; }
  assert(clash === 0, 'no teacher conflicts in generated plan');
  // fill: چیزی برای افزودن نیست
  r = await a.post(`/academic/schedule/class/${cid}/auto`, { mode: 'fill' }); r = await a.get(`/academic/schedule/class/${cid}`); assert(/۰ زنگ به برنامه افزوده شد/.test(r.text), 'fill mode adds nothing when complete');

  // سراسری: صفحه، پیش‌نمایش، ثبت
  r = await a.get('/academic/schedule/auto'); assert(r.status === 200 && /پوشش برنامهٔ کلاس‌ها/.test(r.text) && r.text.includes('کلاس برنامه ' + tag), 'global auto page lists coverage');
  r = await a.get('/academic/schedule'); assert(/تولید خودکار/.test(r.text) && /progress-bar/.test(r.text), 'schedule index shows coverage bars + auto link');
  await a.post(`/academic/schedule/class/${cid}/clear`, {});
  r = await a.post('/academic/schedule/auto', { scope: 'some', 'class_ids[]': String(cid), mode: 'fill', max_per_day: '1', allow_double: '0' });
  assert(r.status === 200 && /پیش‌نمایش نتیجه/.test(r.text) && /name="apply" value="1"/.test(r.text) && /name="seed"/.test(r.text), 'preview rendered (not applied)');
  const seed = (/name="seed" value="(\d+)"/.exec(r.text) || [])[1];
  r = await a.get(`/academic/schedule/class/${cid}`); assert(/۰ \/ ۵ زنگ/.test(r.text), 'preview did not write anything');
  r = await a.post('/academic/schedule/auto', { scope: 'some', 'class_ids[]': String(cid), mode: 'fill', max_per_day: '1', allow_double: '0', apply: '1', seed }); assert(r.status === 302 && /schedule\/auto$/.test(r.location || ''), 'apply posted');
  r = await a.get('/academic/schedule/auto'); assert(/زنگ برای ۱ کلاس ثبت شد/.test(r.text), 'report shown after apply');
  r = await a.get(`/academic/schedule/class/${cid}`);
  const cells2 = [...r.text.matchAll(/id="cell-(\d)-(\d+)"[^>]*data-cs="(\d+)"/g)].map((m) => ({ d: Number(m[1]), p: Number(m[2]), cs: Number(m[3]) }));
  const perDay2 = {}; for (const c of cells2.filter((c) => c.cs === csId1)) perDay2[c.d] = (perDay2[c.d] || 0) + 1;
  assert(cells2.length === 5 && Object.values(perDay2).every((n) => n === 1), 'applied with max 1 per day: subject 1 on 3 different days');

  // غیرفعال‌کردن ویژگی → صفحهٔ auto 404
  await a.post('/system/modules/toggle', { key: 'academic.schedule_auto', enabled: '0' });
  r = await a.get('/academic/schedule/auto'); assert(r.status === 404, 'feature off → 404');
  await a.post('/system/modules/toggle', { key: 'academic.schedule_auto', enabled: '1' });

  // پاک‌سازی
  await a.post(`/academic/schedule/teacher/${s1.teacher}/availability`, { day: String(freeCell.d), period: String(freeCell.p), status: 'available' }, { json: true });
  await a.post(`/academic/schedule/class/${cid}/clear`, {});
  r = await a.post(`/academic/classes/${cid}/delete`, {}); assert(r.status === 302, 'test class deleted');
  console.log(process.exitCode ? 'flow-timetable: FAILED' : 'flow-timetable: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
