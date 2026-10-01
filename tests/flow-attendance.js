'use strict';
const { Client } = require('./client');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 2; } else console.log('ok:', m); };
(async () => {
  const t = new Client();
  let r = await t.login('teacher1', '123456'); assert(r.status === 302, 'teacher login');
  r = await t.get('/attendance/take?class_id=1');
  const ids = [...r.text.matchAll(/name="status_(\d+)"/g)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i);
  assert(ids.length >= 15, 'take form has students: ' + ids.length);
  const body = { class_id: '1', date: r.text.match(/name="date" value="([^"]+)"/)[1], session_key: 'daily' };
  ids.forEach((id, i) => { body['status_' + id] = i === 0 ? 'absent' : i === 1 ? 'late' : 'present'; if (i === 1) body['late_' + id] = '12'; if (i === 0) body['note_' + id] = 'تست'; });
  r = await t.post('/attendance/take', body); assert(r.status === 302, 'POST take -> ' + r.location + ' ' + (r.status !== 302 ? r.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300) : ''));
  r = await t.get('/attendance/take?class_id=1'); assert(/checked[^>]*value="absent"|value="absent"[^>]*checked/.test(r.text), 'absent persisted');
  // excuse as student
  const s = new Client(); r = await s.login('40001', '123456'); assert(r.status === 302, 'student login');
  r = await s.get('/attendance/excuses');
  const opt = /name="attendance_id"[\s\S]*?<option value="(\d+)"/.exec(r.text);
  assert(opt, 'student has absence option');
  if (opt) {
    // multipart post
    const fd = new FormData(); fd.append('_csrf', s.csrf); fd.append('attendance_id', opt[1]); fd.append('reason', 'بیماری — گواهی پزشک');
    const res = await fetch('http://localhost:3000/attendance/excuses', { method: 'POST', headers: { cookie: s.cookieHeader() }, body: fd, redirect: 'manual' });
    assert(res.status === 302, 'POST excuse multipart ' + res.status);
    r = await s.get('/attendance/excuses'); assert(/بیماری — گواهی پزشک/.test(r.text), 'excuse listed for student');
  }
  // admin reviews
  const a = new Client(); r = await a.login('admin', 'admin123'); assert(r.status === 302, 'admin login');
  r = await a.get('/attendance/excuses?status=pending');
  const rid = /action="\/attendance\/excuses\/(\d+)\/review"/.exec(r.text);
  assert(rid, 'pending excuse exists');
  if (rid) { r = await a.post('/attendance/excuses/' + rid[1] + '/review', { action: 'approve', note: 'تأیید' }); assert(r.status === 302, 'review approve ' + r.status); }
  // staff attendance
  r = await a.get('/attendance/staff');
  const uids = [...r.text.matchAll(/name="status_(\d+)"/g)].map((m) => m[1]);
  const sb = { date: r.text.match(/name="date" value="([^"]+)"/)[1] };
  uids.forEach((u, i) => { sb['status_' + u] = i === 0 ? 'late' : 'present'; sb['in_' + u] = '07:30'; sb['out_' + u] = '13:30'; sb['note_' + u] = ''; });
  r = await a.post('/attendance/staff', sb); assert(r.status === 302, 'POST staff ' + r.status);
  r = await a.get('/attendance/staff'); assert(/value="07:30"/.test(r.text), 'staff attendance persisted');
  // student create
  r = await a.get('/students/new');
  const fd = new FormData(); fd.append('_csrf', a.csrf);
  for (const [k, v] of Object.entries({ first_name: 'تست', last_name: 'آزمایشی', national_id: '0012345678', gender: 'male', class_id: '1', birth_date: '1391/05/12', father_name: 'علی آزمایشی', father_phone: '09121234567', mother_name: 'مریم', mother_phone: '09121234568', status: 'active', enrollment_date: '1405/07/01' })) fd.append(k, v);
  const res2 = await fetch('http://localhost:3000/students', { method: 'POST', headers: { cookie: a.cookieHeader() }, body: fd, redirect: 'manual' });
  assert(res2.status === 302, 'POST /students ' + res2.status + ' -> ' + res2.headers.get('location'));
  const loc = res2.headers.get('location');
  r = await a.get(loc); assert(r.status === 200 && /آزمایشی/.test(r.text), 'new student page ' + loc);
  const sid = (loc.match(/\/students\/(\d+)/) || [])[1];
  if (sid) {
    r = await a.post(`/students/${sid}/notes`, { content: 'یادداشت تست', type: 'general' }); assert(r.status === 302, 'POST note ' + r.status);
    r = await a.post(`/students/${sid}/transfer`, { to_class_id: '2', reason: 'تست' }); assert(r.status === 302, 'POST transfer ' + r.status);
    r = await a.post(`/students/${sid}/status`, { status: 'suspended', reason: 'تست' }); assert(r.status === 302, 'POST status ' + r.status);
    r = await a.get(`/students/${sid}?tab=history`); assert(/تست/.test(r.text), 'history shows transfer');
    r = await a.post(`/students/${sid}/delete`, {}); assert(r.status === 302, 'delete student ' + r.status);
  }
  // CSV import
  r = await a.get('/students/import/template'); assert(r.status === 200, 'import template');
  const csv = '\ufeff' + r.text.split('\n')[0] + '\n';
  console.log('template header:', r.text.split('\n')[0].slice(0, 120));
})().catch((e) => { console.error(e); process.exit(1); });
