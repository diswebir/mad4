'use strict';
const { Client } = require('./client');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 2; } else console.log('ok:', m); };
const flashOf = (html) => { const m = /alert[^>]*>([\s\S]*?)<\/div>/.exec(html); return m ? m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) : ''; };
(async () => {
  const a = new Client(); let r = await a.login('admin', 'admin123'); assert(r.status === 302, 'admin login');
  // grade level crud
  r = await a.get('/academic/grade-levels/new'); assert(r.status === 200, 'grade-levels/new');
  r = await a.post('/academic/grade-levels', { title: 'دهم', stage: 'متوسطه دوم', sort_order: '10', grading_type: 'numeric' }); assert(r.status === 302 && !/new/.test(r.location), 'create grade level -> ' + r.location);
  r = await a.get('/academic/grade-levels'); assert(/دهم/.test(r.text), 'grade level listed');
  const gid = [...r.text.matchAll(/\/academic\/grade-levels\/(\d+)\/edit/g)].map((m) => m[1]).pop();
  r = await a.post(`/academic/grade-levels/${gid}`, { title: 'دهم ریاضی', stage: 'متوسطه دوم', sort_order: '10', grading_type: 'numeric' }); assert(r.status === 302, 'edit grade level');
  r = await a.get('/academic/grade-levels'); assert(/دهم ریاضی/.test(r.text), 'grade level edited');
  r = await a.post(`/academic/grade-levels/${gid}/delete`, {}); assert(r.status === 302, 'delete grade level');
  // subject
  r = await a.post('/academic/subjects', { title: 'آزمایشگاه', code: 'LAB7', grade_level_id: '1', weekly_hours: '1', is_active: '1' }); assert(r.status === 302 && !/new/.test(r.location), 'create subject ' + r.location);
  r = await a.get('/academic/subjects?q=' + encodeURIComponent('آزمایشگاه')); assert(/LAB۷/.test(r.text), 'subject listed');
  const subId = [...r.text.matchAll(/\/academic\/subjects\/(\d+)\/edit/g)].map((m) => m[1]).pop();
  assert(subId, 'subject id ' + subId);
  // class subject assign + schedule slot
  // معلم جدید (بدون برنامه) تا تداخل پیش نیاید
  r = await a.get('/teachers/new');
  const uname = 't9' + String(Date.now()).slice(-7);
  const fd0 = new FormData(); fd0.append('_csrf', a.csrf);
  for (const [k, v] of Object.entries({ name: 'معلم آزمایشگاه', username: uname, password: 'secret123', personnel_code: '9' + String(Date.now()).slice(-6), gender: 'female', status: 'active' })) fd0.append(k, v);
  const res0 = await fetch('http://localhost:3000/teachers', { method: 'POST', headers: { cookie: a.cookieHeader() }, body: fd0, redirect: 'manual' });
  assert(res0.status === 302 && !/new/.test(res0.headers.get('location')), 'create lab teacher -> ' + res0.headers.get('location'));
  r = await a.get('/teachers?q=' + uname); const labT = [...r.text.matchAll(/\/teachers\/(\d+)\/edit/g)].map((m) => m[1]).pop();
  r = await a.post('/academic/classes/1/subjects', { subject_id: subId, teacher_id: labT, weekly_hours: '1' }); assert(r.status === 302, 'assign class subject');
  r = await a.get('/academic/classes/1'); assert(/آزمایشگاه/.test(r.text), 'class shows subject');
  const csRow = new RegExp('subjects/(\\d+)/delete[\\s\\S]{0,600}?آزمایشگاه|آزمایشگاه[\\s\\S]{0,600}?subjects/(\\d+)/delete').exec(r.text);
  const csId = csRow && (csRow[1] || csRow[2]);
  assert(csId, 'cs id ' + csId);
  r = await a.post('/academic/schedule/class/1/slot', { day: '4', period: '5', class_subject_id: csId }, { json: true }); const j = r.json(); assert(j && j.ok, 'slot set json ' + r.text.slice(0, 100));
  r = await a.get('/academic/schedule/class/1'); assert(/آزمایشگاه/.test(r.text), 'schedule shows slot');
  r = await a.post('/academic/schedule/class/1/slot', { day: '4', period: '5', class_subject_id: '' }, { json: true }); assert(r.json() && r.json().ok, 'slot clear');
  r = await a.post(`/teachers/${labT}/delete`, {}); assert(r.status === 302, 'delete lab teacher');
  r = await a.post(`/academic/classes/1/subjects/${csId}/delete`, {}); assert(r.status === 302, 'remove class subject');
  r = await a.post(`/academic/subjects/${subId}/delete`, {}); assert(r.status === 302, 'delete subject');
  // rooms + classes
  r = await a.post('/academic/rooms', { title: 'اتاق تست', capacity: '20', floor: '1', type: 'class' }); assert(r.status === 302 && !/new/.test(r.location), 'create room ' + r.location);
  r = await a.post('/academic/classes', { title: 'کلاس تست', academic_year_id: '1', grade_level_id: '1', teacher_id: '1', capacity: '25', shift: 'morning', is_active: '1' }); assert(r.status === 302 && !/new/.test(r.location), 'create class ' + r.location);
  r = await a.get('/academic/classes'); assert(/کلاس تست/.test(r.text), 'class listed');
  const cid = [...r.text.matchAll(/\/academic\/classes\/(\d+)\/edit/g)].map((m) => m[1]).pop();
  r = await a.post(`/academic/schedule/class/${cid}/copy`, { source_id: '1' }); assert(r.status === 302, 'copy schedule ' + r.status);
  r = await a.post(`/academic/schedule/class/${cid}/copy`, { source_id: 'abc' }); assert(r.status === 302, 'copy schedule with invalid source → redirect (no 500)');
  r = await a.get(`/academic/schedule/class/${cid}`); assert(r.status === 200, 'copied schedule page');
  r = await a.post(`/academic/schedule/class/${cid}/clear`, {}); assert(r.status === 302, 'clear schedule');
  r = await a.post(`/academic/classes/${cid}/delete`, {}); assert(r.status === 302, 'delete class');
  // year
  r = await a.post('/academic/years', { title: '1406-1407', start_date: '1406/07/01', end_date: '1407/06/31', is_current: '0' }); assert(r.status === 302 && !/new/.test(r.location), 'create year ' + r.location);
  r = await a.get('/academic/years'); const yid = [...r.text.matchAll(/\/academic\/years\/(\d+)\/edit/g)].map((m) => m[1]).pop();
  r = await a.post(`/academic/years/${yid}/delete`, {}); assert(r.status === 302, 'delete year');
  // teacher create
  r = await a.get('/teachers/new'); assert(r.status === 200, 'teachers/new');
  const fd = new FormData(); fd.append('_csrf', a.csrf);
  for (const [k, v] of Object.entries({ name: 'معلم تست', username: 't9999', password: 'secret123', phone: '09121112233', personnel_code: '9999', gender: 'male', education: 'کارشناسی', field: 'فیزیک', status: 'active', employment_type: 'official' })) fd.append(k, v);
  const res = await fetch('http://localhost:3000/teachers', { method: 'POST', headers: { cookie: a.cookieHeader() }, body: fd, redirect: 'manual' });
  assert(res.status === 302 && !/new/.test(res.headers.get('location')), 'create teacher -> ' + res.headers.get('location'));
  r = await a.get('/teachers?q=t9999'); assert(/معلم تست/.test(r.text), 'teacher listed');
  const tid = [...r.text.matchAll(/\/teachers\/(\d+)\/edit/g)].map((m) => m[1]).pop();
  r = await a.get(`/teachers/${tid}`); assert(r.status === 200 && /فیزیک/.test(r.text), 'teacher profile');
  const t = new Client(); r = await t.login('t9999', 'secret123'); assert(r.status === 302, 'new teacher can login -> ' + r.location);
  r = await a.post(`/teachers/${tid}/delete`, {}); assert(r.status === 302, 'delete teacher');
  // promote preview
  r = await a.get('/academic/promote/students/1'); assert(r.status === 200, 'promote students json ' + r.text.slice(0, 60));
  r = await a.get('/academic/api/classes'); assert(r.status === 200 && r.json(), 'api classes');
  r = await a.get('/teachers?export=1'); assert(r.status === 200 && /\ufeff|,/.test(r.text), 'teachers export');
})().catch((e) => { console.error(e); process.exit(1); });
