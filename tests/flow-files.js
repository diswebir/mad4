'use strict';
/** جریان: مجوز دسترسی به فایل‌های بارگذاری‌شده (/files/*) بر اساس رکورد — مدارک دانش‌آموز، عکس، پیوست تیکت، فایل یتیم، پیمایش مسیر */
const fs = require('fs');
const path = require('path');
const { Client, BASE, superPost } = require('./client');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 2; } else console.log('ok:', m); };

async function upload(a, p, filename, content, type, fields, field) {
  const fd = new FormData(); fd.append('_csrf', a.csrf);
  for (const [k, v] of Object.entries(fields || {})) fd.append(k, v);
  fd.append(field || 'file', new Blob([content], { type }), filename);
  const res = await fetch(BASE + p, { method: 'POST', headers: { cookie: a.cookieHeader() }, body: fd, redirect: 'manual' });
  await res.text();
  return { status: res.status, location: res.headers.get('location') };
}
const filesIn = (html, folder) => [...html.matchAll(new RegExp('/files/(' + folder + '/[^"?&\\s<]+)', 'g'))].map((m) => m[1]);

(async () => {
  const a = new Client(); let r = await a.login('admin', 'admin123'); assert(r.status === 302, 'admin login');
  await superPost('/system/modules/toggle', { key: 'students.documents', enabled: '1' });
  await superPost('/system/modules/toggle', { key: 'students.photo', enabled: '1' });
  await superPost('/system/modules/toggle', { key: 'tickets.attachments', enabled: '1' });
  const tag = Math.floor(Math.random() * 1e6);

  // دانش‌آموز ۱ (کلاس ۱ — معلم راهنما teacher1) و یک دانش‌آموز از کلاس دیگر
  r = await a.get('/students/1'); assert(r.status === 200, 'student 1 page');
  const s1Class = Number((/\/academic\/classes\/(\d+)/.exec(r.text) || [])[1]);
  const otherList = await a.get('/students?class_id=' + (s1Class === 1 ? 2 : 1)); const otherId = Number((/href="\/students\/(\d+)"/.exec(otherList.text) || [])[1]);
  const otherPage = await a.get('/students/' + otherId); const otherNum = (/شماره دانش‌آموزی[\s\S]{0,200}?(\d{5,})/.exec(otherPage.text.replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))) || [])[1];

  // ---- مدرک دانش‌آموز
  let up = await upload(a, '/students/1/documents', 'karname-' + tag + '.pdf', '%PDF-1.4 test ' + tag, 'application/pdf', { title: 'کارنامهٔ ' + tag });
  assert(up.status === 302, 'document uploaded');
  r = await a.get('/students/1?tab=docs'); const docs = filesIn(r.text, 'students/docs'); const doc = docs[docs.length - 1];
  assert(!!doc, 'document path found: ' + doc);
  r = await a.get('/files/' + doc); assert(r.status === 200 && r.text.includes('test ' + tag), 'admin can read document');
  r = await a.get('/files/' + doc + '?dl=1'); assert(r.status === 200 && /attachment/.test(r.headers['content-disposition'] || ''), 'download header');

  const t1 = new Client(); await t1.login('teacher1', '123456');
  r = await t1.get('/files/' + doc); assert(r.status === 200, 'homeroom/class teacher can read document');
  // معلمی که در کلاس دانش‌آموز ۱ تدریس ندارد
  let outsider = null;
  for (let i = 2; i <= 14 && !outsider; i++) { const c = new Client(); const l = await c.login('teacher' + i, '123456'); if (l.status !== 302) continue; const st = await c.get('/students'); const cls = [...st.text.matchAll(/name="class_id"[\s\S]*?<\/select>/g)].flatMap((m) => [...m[0].matchAll(/<option value="(\d+)"/g)].map((x) => Number(x[1]))); if (!cls.includes(s1Class)) outsider = { c, name: 'teacher' + i }; }
  if (outsider) { r = await outsider.c.get('/files/' + doc); assert(r.status === 403, outsider.name + ' (not teaching class ' + s1Class + ') gets 403 for document'); }
  else console.log('skip: all teachers teach class ' + s1Class);

  const s1 = new Client(); r = await s1.login('40001', '123456');
  if (r.status === 302) { r = await s1.get('/files/' + doc); assert(r.status === 200, 'student 1 can read own document'); }
  const s2 = new Client(); r = await s2.login(otherNum, '123456');
  if (r.status === 302) { r = await s2.get('/files/' + doc); assert(r.status === 403, 'student from other class gets 403 for document'); }
  else console.log('skip: other student login ' + otherNum + ' (' + r.status + ')');
  // ولی دانش‌آموز ۱
  const p1 = await a.get('/students/1?tab=parents'); const pm = /نام کاربری[^<]*<\/[^>]+>\s*<[^>]*>([0-9۰-۹]{10,11})/.exec(p1.text) || /(09[0-9۰-۹]{9})/.exec(p1.text.replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
  const pu = pm ? pm[1].replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)) : null;
  if (pu) { const pc = new Client(); r = await pc.login(pu, '123456'); if (r.status === 302) { r = await pc.get('/files/' + doc); assert(r.status === 200, 'parent of student 1 can read document'); } else console.log('skip: parent login ' + pu); }

  // ---- عکس دانش‌آموز: معلمان همه، دانش‌آموز دیگر خیر
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  up = await upload(a, '/students/1/photo', 'p' + tag + '.png', png, 'image/png', {}, 'photo'); assert(up.status === 302, 'photo uploaded');
  r = await a.get('/students/1'); const photo = filesIn(r.text, 'students').find((f) => !f.startsWith('students/docs/'));
  assert(!!photo, 'photo path found: ' + photo);
  if (photo) {
    r = await a.get('/files/' + photo); assert(r.status === 200 && /image\/png/.test(r.headers['content-type']), 'admin reads photo');
    if (outsider) { r = await outsider.c.get('/files/' + photo); assert(r.status === 200, 'any teacher can see profile photo'); }
    if (otherNum) { r = await s2.get('/files/' + photo); assert(r.status === 403, 'other student cannot see photo'); }
    r = await s1.get('/files/' + photo); assert(r.status === 200, 'student sees own photo');
  }

  // ---- پیوست تیکت: فقط طرفین
  const tk = await upload(s1, '/tickets', 'note-' + tag + '.txt', 'ticket file ' + tag, 'text/plain', { subject: 'پیوست ' + tag, message: 'سلام', department: 'admin' });
  assert(tk.status === 302, 'student created ticket with attachment');
  r = await s1.get(tk.location || '/tickets'); const tf = filesIn(r.text, 'tickets')[0];
  if (tf) {
    r = await s1.get('/files/' + tf); assert(r.status === 200, 'ticket creator reads attachment');
    r = await a.get('/files/' + tf); assert(r.status === 200, 'admin reads ticket attachment');
    if (otherNum) { r = await s2.get('/files/' + tf); assert(r.status === 403, 'other student cannot read ticket attachment'); }
    if (outsider) { r = await outsider.c.get('/files/' + tf); assert(r.status === 403, 'unrelated teacher cannot read ticket attachment'); }
  } else console.log('skip: ticket attachment path not found');

  // ---- فایل یتیم و پیمایش مسیر
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'storage', 'config.json'), 'utf8'));
  const dir = path.resolve(path.join(__dirname, '..'), (cfg.uploads && cfg.uploads.dir) || 'storage/uploads');
  fs.mkdirSync(path.join(dir, 'students', 'docs'), { recursive: true });
  const orphan = 'students/docs/orphan-' + tag + '.txt'; fs.writeFileSync(path.join(dir, orphan), 'orphan');
  r = await a.get('/files/' + orphan); assert(r.status === 200, 'admin reads orphan file');
  r = await t1.get('/files/' + orphan); assert(r.status === 403, 'teacher cannot read orphan file');
  fs.unlinkSync(path.join(dir, orphan));
  r = await a.get('/files/..%2F..%2Fpackage.json'); assert(r.status === 404, 'path traversal blocked');
  r = await a.get('/files/students/docs/'); assert(r.status === 404, 'directory path → 404');
  r = await t1.get('/files/imports/x.csv'); assert(r.status === 404 || r.status === 403, 'imports folder not for teachers');
  const anon = new Client(); r = await anon.get('/files/' + doc); assert(r.status === 302 || r.status === 401, 'anonymous redirected to login');

  // پاک‌سازی مدرک
  const dm = new RegExp('/students/1/documents/(\\d+)/delete[^"]*"[\\s\\S]{0,400}?' + tag).exec((await a.get('/students/1?tab=docs')).text) || new RegExp('کارنامهٔ ' + tag + '[\\s\\S]{0,600}?/students/1/documents/(\\d+)/delete').exec((await a.get('/students/1?tab=docs')).text);
  if (dm) await a.post('/students/1/documents/' + dm[1] + '/delete', {});
  console.log('flow-files done');
})().catch((e) => { console.error(e); process.exit(1); });
