'use strict';
/** جریان: ورود گروهی دانش‌آموزان از CSV (students.import) — قالب، درج در کلاس، حساب کاربری، تکراری‌ها، ردیف نامعتبر، نوع فایل */
const { Client, BASE } = require('./client');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 2; } else console.log('ok:', m); };
const en = (s) => String(s).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
/** کد ملی معتبر تصادفی (الگوریتم رقم کنترل) */
function nationalId() { let d = ''; for (let i = 0; i < 9; i++) d += Math.floor(Math.random() * 10); let s = 0; for (let i = 0; i < 9; i++) s += Number(d[i]) * (10 - i); const r = s % 11; return d + (r < 2 ? r : 11 - r); }
async function upload(a, path, filename, content, type, fields) {
  const fd = new FormData(); fd.append('_csrf', a.csrf);
  for (const [k, v] of Object.entries(fields || {})) fd.append(k, v);
  fd.append('file', new Blob([content], { type }), filename);
  const res = await fetch(BASE + path, { method: 'POST', headers: { cookie: a.cookieHeader() }, body: fd, redirect: 'manual' });
  await res.text(); // مصرف بدنه: ذخیرهٔ نشست (فلش) پیش از درخواست بعدی کامل شود
  return { status: res.status, location: res.headers.get('location') };
}

(async () => {
  const a = new Client(); let r = await a.login('admin', 'admin123'); assert(r.status === 302, 'admin login');
  await a.post('/system/modules/toggle', { key: 'students.import', enabled: '1' });

  r = await a.get('/students/import'); assert(r.status === 200 && /name="class_id"/.test(r.text) && /import\/template/.test(r.text), 'import page with class select + template link');
  r = await a.get('/students/import/template'); assert(r.status === 200 && /text\/csv/.test(r.headers['content-type']), 'template is csv');
  const lines = r.text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const header = lines[0].split(','); assert(header.includes('first_name') && header.includes('last_name') && header.includes('national_id'), 'template header has key columns');
  // نمونهٔ داخل قالب باید خودش قابل ورود باشد (کد ملی معتبر)
  const sampleNid = lines[1].split(',')[header.indexOf('national_id')]; let s = 0; for (let i = 0; i < 9; i++) s += Number(sampleNid[i]) * (10 - i); const rr = s % 11; assert(Number(sampleNid[9]) === (rr < 2 ? rr : 11 - rr), 'template sample national id is valid: ' + sampleNid);

  // دو ردیف معتبر + یک ردیف نامعتبر (بدون نام خانوادگی)
  const tag = Math.random().toString(36).slice(2, 7);
  const last = 'واردشده' + tag;
  const n1 = nationalId(), n2 = nationalId();
  const row = (o) => header.map((k) => o[k] || '').join(',');
  const csv = '\uFEFF' + header.join(',') + '\n' + [
    row({ first_name: 'آرش', last_name: last, gender: 'male', national_id: n1, birth_date: '1391/02/10', father_name: 'کامران', father_phone: '0912' + String(Math.floor(1000000 + Math.random() * 8999999)), mother_name: 'نسرین', mother_phone: '09120000001' }),
    row({ first_name: 'نیلوفر', last_name: last, gender: 'دختر', national_id: n2, birth_date: '۱۳۹۱/۰۶/۲۵', father_name: 'بهرام', father_phone: '0913' + String(Math.floor(1000000 + Math.random() * 8999999)) }),
    row({ first_name: 'بی‌نام', last_name: '', national_id: nationalId() })
  ].join('\n') + '\n';
  r = await a.get('/students/import'); const classId = (/<option value="(\d+)"/.exec(r.text.split('name="class_id"')[1]) || [])[1];
  assert(classId, 'picked class ' + classId);
  let up = await upload(a, '/students/import', 'students.csv', csv, 'application/octet-stream', { class_id: classId });
  assert(up.status === 302 && /\/students/.test(up.location || ''), 'import accepted (octet-stream mime): ' + up.status);
  r = await a.get(up.location); assert(/۲ دانش‌آموز ثبت شد/.test(r.text) && /۰ تکراری/.test(r.text) && /ردیف ۴/.test(r.text), 'flash: 2 inserted, invalid row 4 reported');

  // در فهرست و در کلاس
  r = await a.get('/students?q=' + encodeURIComponent(last)); assert((r.text.match(new RegExp(last, 'g')) || []).length >= 2, 'both imported students listed');
  const ids = [...r.text.matchAll(/href="\/students\/(\d+)"/g)].map((m) => m[1]).filter((v, i, arr) => arr.indexOf(v) === i);
  r = await a.get('/students/' + ids[0]); assert(r.status === 200 && new RegExp(last).test(r.text), 'profile opens');
  const numMatch = /شماره دانش‌آموزی[\s\S]{0,200}?([۰-۹\d]{4,})/.exec(r.text); const studentNumber = numMatch ? en(numMatch[1]) : null;
  assert(studentNumber, 'student number assigned: ' + studentNumber);
  const female = await a.get('/students/' + ids[1]); assert(/دختر|female/.test(female.text) || /دختر|female/.test(r.text), 'persian gender word mapped');

  // حساب کاربری ساخته شده (رمز پیش‌فرض یا کد ملی)
  r = await a.get('/system/settings?tab=academic'); const defPw = (/name="student_default_password" value="([^"]*)"/.exec(r.text) || [])[1] || '';
  const s1 = new Client(); const pw = defPw || n1; const nid = /کد ملی[\s\S]{0,200}?([۰-۹\d]{10})/.exec((await a.get('/students/' + ids[0])).text);
  const who = nid ? en(nid[1]) : n1; const loginPw = defPw || who;
  r = await s1.login(studentNumber, loginPw); assert(r.status === 302 || /must/.test(r.location || ''), 'imported student can log in: ' + r.status + ' ' + (r.location || '') + ' (pw=' + (defPw ? 'default' : 'national id') + ')');

  // ورود مجدد همان فایل → تکراری
  up = await upload(a, '/students/import', 'students.csv', csv, 'text/csv', { class_id: classId });
  r = await a.get(up.location); assert(/۰ دانش‌آموز ثبت شد/.test(r.text) && /۲ تکراری/.test(r.text), 'duplicates skipped on re-import');

  // نوع فایل نامعتبر
  up = await upload(a, '/students/import', 'evil.exe', 'MZ', 'application/octet-stream', {});
  r = await a.get('/students/import'); assert(/مجاز نیست|فقط فایل CSV/.test(r.text), 'non-csv rejected');
  up = await upload(a, '/students/import', 'photo.jpg', 'xx', 'image/jpeg', {});
  r = await a.get('/students/import'); assert(/مجاز نیست|فقط فایل CSV/.test(r.text), 'image rejected');

  // بارگذاری مدرک با نوع ناشناخته (octet-stream): پسوند امن پذیرفته، پسوند خطرناک رد
  await a.post('/system/modules/toggle', { key: 'students.documents', enabled: '1' });
  up = await upload(a, '/students/' + ids[0] + '/documents', 'madarek.zip', 'PK\u0003\u0004', 'application/octet-stream', { title: 'مدارک فشرده' });
  r = await a.get('/students/' + ids[0] + '?tab=docs'); assert(/مدرک بارگذاری شد/.test(r.text) && /مدارک فشرده/.test(r.text), 'zip with octet-stream mime accepted (safe extension)');
  up = await upload(a, '/students/' + ids[0] + '/documents', 'virus.exe', 'MZ', 'application/octet-stream', { title: 'x' });
  r = await a.get('/students/' + ids[0] + '?tab=docs'); assert(/مجاز نیست/.test(r.text) && !/>x</.test(r.text), 'exe with octet-stream rejected');
  up = await upload(a, '/students/' + ids[0] + '/documents', 'page.html', '<b>x</b>', 'text/html', { title: 'y' });
  r = await a.get('/students/' + ids[0] + '?tab=docs'); assert(/مجاز نیست/.test(r.text), 'html rejected');
  up = await upload(a, '/students/' + ids[0] + '/documents', 'scan.rar', 'Rar!', 'application/vnd.rar', { title: 'اسکن رار' });
  r = await a.get('/students/' + ids[0] + '?tab=docs'); assert(/اسکن رار/.test(r.text), 'rar accepted');

  // پاک‌سازی: حذف دانش‌آموزان واردشده
  for (const id of ids) await a.post('/students/' + id + '/delete', {});
  r = await a.get('/students?q=' + encodeURIComponent(last)); assert(!(new RegExp('/students/' + ids[0] + '"').test(r.text)), 'cleanup: imported students removed');

  // خاموش‌کردن
  await a.post('/system/modules/toggle', { key: 'students.import', enabled: '0' });
  r = await a.get('/students/import'); assert(r.status === 404, 'import 404 when feature off');
  await a.post('/system/modules/toggle', { key: 'students.import', enabled: '1' });
  console.log('done');
})().catch((e) => { console.error(e); process.exitCode = 2; });
