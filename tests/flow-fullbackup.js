'use strict';
/** جریان: پشتیبان کامل (ZIP = پایگاه داده + فایل‌ها) — ساخت، manifest، دانلود، بازیابی داده‌ها و فایل‌ها با متن فارسی/ایموجی و نام فایل یونیکد، JSON با BOM، مسیر ناامن در ZIP، تنظیم نوع پشتیبان خودکار */
const fs = require('fs');
const path = require('path');
const { Client, BASE } = require('./client');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 2; } else console.log('ok:', m); };
const zip = require('../src/core/zip');

async function upload(a, p, filename, content, type, fields, field) {
  const fd = new FormData(); fd.append('_csrf', a.csrf);
  for (const [k, v] of Object.entries(fields || {})) fd.append(k, v);
  fd.append(field || 'file', new Blob([content], { type }), filename);
  const res = await fetch(BASE + p, { method: 'POST', headers: { cookie: a.cookieHeader() }, body: fd, redirect: 'manual' });
  await res.text();
  return { status: res.status, location: res.headers.get('location') };
}

(async () => {
  const a = new Client(); let r = await a.login('admin', 'admin123'); assert(r.status === 302, 'admin login');
  await a.post('/system/modules/toggle', { key: 'system.backup', enabled: '1' });
  await a.post('/system/modules/toggle', { key: 'students.documents', enabled: '1' });
  const root = path.join(__dirname, '..');
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'storage', 'config.json'), 'utf8'));
  const uploadsDir = path.resolve(root, (cfg.uploads && cfg.uploads.dir) || 'storage/uploads');
  const backupsDir = path.join(root, 'storage', 'backups');
  const tag = Math.floor(Math.random() * 1e6);

  // ۱) دادهٔ یونیکد: دانش‌آموز با نام فارسی + ایموجی و یک مدرک با نام اصلی فارسی
  const nid = () => { const d = []; for (let i = 0; i < 9; i++) d.push(Math.floor(Math.random() * 10)); let s = 0; for (let i = 0; i < 9; i++) s += d[i] * (10 - i); const rr = s % 11; d.push(rr < 2 ? rr : 11 - rr); return d.join(''); };
  const uniName = 'یونیکد‌' + tag + ' 🎓';
  r = await a.post('/students', { first_name: 'آزمایش', last_name: uniName, gender: 'female', class_id: '1', status: 'active', national_id: nid(), student_number: String(800000 + Math.floor(Math.random() * 90000)), address: 'تهران، خیابان «ولیعصر»، پلاک ۱۲ — واحد ۳' });
  assert(r.status === 302, 'unicode student created');
  const sid = Number((/\/students\/(\d+)/.exec(r.location || '') || [])[1]) || Number((/href="\/students\/(\d+)"/.exec((await a.get('/students?q=' + encodeURIComponent('یونیکد‌' + tag))).text) || [])[1]);
  assert(sid > 0, 'student id ' + sid);
  const fileBody = 'محتوای فایل فارسی ' + tag + ' — تست یونیکد ✓';
  const up = await upload(a, `/students/${sid}/documents`, 'کارنامهٔ نیم‌سال ' + tag + '.txt', fileBody, 'text/plain', { title: 'مدرک فارسی ' + tag });
  assert(up.status === 302, 'document with unicode original name uploaded');
  r = await a.get(`/students/${sid}?tab=docs`); const rel = (/\/files\/(students\/docs\/[^"?]+)/.exec(r.text) || [])[1]; assert(!!rel, 'document path ' + rel);
  assert(r.text.includes('کارنامهٔ نیم‌سال ' + tag), 'unicode original file name shown');
  const abs = path.join(uploadsDir, rel);

  // ۲) ساخت پشتیبان کامل
  const before = new Set(fs.readdirSync(backupsDir));
  r = await a.post('/system/backup/create', { type: 'full' }); assert(r.status === 302, 'create full backup');
  r = await a.get('/system/backup'); assert(/کامل \(پایگاه داده \+ فایل‌ها\)/.test(r.text) && /فایل‌های بارگذاری‌شده:/.test(r.text), 'backup page lists full backup type + uploads info');
  const zipName = fs.readdirSync(backupsDir).find((f) => !before.has(f) && f.endsWith('.zip')); assert(!!zipName, 'zip file created: ' + zipName);
  const zr = new zip.ZipReader(path.join(backupsDir, zipName));
  const names = zr.entries().map((e) => e.name);
  const manifest = JSON.parse(zr.read('manifest.json').toString('utf8'));
  const dbJson = JSON.parse(zr.read('database.json').toString('utf8'));
  zr.close();
  assert(manifest.type === 'full' && manifest.tables.students > 0 && manifest.files >= 1, 'manifest ok (students=' + manifest.tables.students + ', files=' + manifest.files + ')');
  assert(names.includes('uploads/' + rel), 'uploaded file inside zip');
  const stu = (dbJson.tables.students || []).find((s) => s.id === sid);
  assert(stu && stu.last_name === uniName && /ولیعصر/.test(stu.address), 'unicode data intact inside database.json');
  const doc = (dbJson.tables.student_documents || []).find((d) => d.file_path === rel);
  assert(doc && doc.file_name === 'کارنامهٔ نیم‌سال ' + tag + '.txt', 'unicode file_name intact in dump');
  r = await a.get('/system/backup/download/' + zipName); assert(r.status === 200 && r.text.startsWith('PK'), 'download zip');

  // ۳) تخریب: حذف دانش‌آموز (و مدرک) + حذف فیزیکی فایل → بازیابی
  r = await a.post(`/students/${sid}/delete`, {}); assert(r.status === 302, 'student deleted');
  try { fs.unlinkSync(abs); } catch (e) { /* ممکن است با حذف دانش‌آموز پاک شده باشد */ }
  assert(!fs.existsSync(abs), 'file physically removed');
  r = await a.get(`/students/${sid}`); assert(r.status === 404, 'student gone');
  const zipBuf = fs.readFileSync(path.join(backupsDir, zipName));
  const rs = await upload(a, '/system/backup/restore', zipName, zipBuf, 'application/zip', {});
  assert(rs.status === 302, 'restore posted');
  r = await a.get('/system/backup'); assert(/بازیابی با موفقیت انجام شد/.test(r.text) && /فایل\)/.test(r.text), 'restore success flash with files count');
  r = await a.get(`/students/${sid}`); assert(r.status === 200 && r.text.includes(uniName), 'student restored with unicode name');
  assert(fs.existsSync(abs) && fs.readFileSync(abs, 'utf8') === fileBody, 'file restored byte-identical');
  r = await a.get(`/students/${sid}?tab=docs`); assert(r.text.includes('کارنامهٔ نیم‌سال ' + tag) && r.text.includes(rel), 'document row + unicode name restored');
  r = await a.get('/files/' + rel); assert(r.status === 200 && r.text === fileBody, 'restored file served');

  // ۴) بازیابی فقط فایل‌ها (بدون داده‌ها) و ZIP با مسیر ناامن
  fs.unlinkSync(abs);
  const evil = zip.build([{ name: 'manifest.json', data: '{"type":"full"}' }, { name: 'uploads/../../evil.txt', data: 'x' }, { name: 'uploads/' + rel, data: fileBody }]);
  const rs2 = await upload(a, '/system/backup/restore', 'evil.zip', evil, 'application/zip', { restore_db: '0' });
  assert(rs2.status === 302, 'files-only restore posted');
  r = await a.get('/system/backup'); assert(/مسیر نامعتبر نادیده گرفته شد/.test(r.text) && /۰ سطر/.test(r.text), 'unsafe path skipped, db untouched');
  assert(fs.existsSync(abs) && !fs.existsSync(path.join(root, 'evil.txt')) && !fs.existsSync(path.join(uploadsDir, '..', 'evil.txt')), 'file restored, traversal blocked');

  // ۵) JSON با BOM
  const bomJson = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify({ version: '1', tables: { settings: dbJson.tables.settings } }), 'utf8')]);
  const rs3 = await upload(a, '/system/backup/restore', 'bom.json', bomJson, 'application/json', {});
  assert(rs3.status === 302, 'BOM json restore posted');
  r = await a.get('/system/backup'); assert(/بازیابی با موفقیت انجام شد/.test(r.text), 'BOM json restored');
  // فایل بی‌ربط
  const bad = zip.build([{ name: 'readme.txt', data: 'hi' }]);
  await upload(a, '/system/backup/restore', 'bad.zip', bad, 'application/zip', {});
  r = await a.get('/system/backup'); assert(/بازیابی ناموفق/.test(r.text) && /database\.json/.test(r.text), 'foreign zip rejected');

  // ۶) نوع پشتیبان خودکار
  r = await a.post('/system/jobs/settings', { scheduler_mode: 'internal', backup_keep: '7', backup_auto_type: 'full' });
  r = await a.get('/system/jobs'); assert(/<option value="full" selected/.test(r.text), 'auto backup type saved');
  await a.post('/system/jobs/settings', { scheduler_mode: 'internal', backup_keep: '7', backup_auto_type: 'db' });

  // پاک‌سازی
  await a.post(`/students/${sid}/delete`, {});
  await a.post('/system/backup/delete/' + zipName, {});
  console.log('flow-fullbackup done');
})().catch((e) => { console.error(e); process.exit(1); });
