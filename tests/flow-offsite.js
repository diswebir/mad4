'use strict';
/** جریان: ارسال پشتیبان به بیرون (system.backup_offsite) — تنظیمات، آزمایش اتصال، ارسال دستی به WebDAV محلی، مسیر خطا، اجرای کار شبانه، خاموش‌کردن */
const http = require('http');
const zlib = require('zlib');
const { Client, BASE } = require('./client');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 2; } else console.log('ok:', m); };

// یک سرور WebDAV ساده (PROPFIND/HEAD/PUT) روی 127.0.0.1 برای دریافت فایل‌ها
const received = [];
const dav = http.createServer((req, res) => {
  const auth = req.headers.authorization || '';
  if (auth !== 'Basic ' + Buffer.from('davuser:davpass').toString('base64')) { res.writeHead(401, { 'WWW-Authenticate': 'Basic' }); return res.end(); }
  if (req.method === 'PROPFIND' || req.method === 'HEAD') { res.writeHead(req.method === 'HEAD' ? 200 : 207, { 'Content-Type': 'application/xml' }); return res.end(); }
  if (req.method === 'PUT') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { received.push({ url: req.url, body: Buffer.concat(chunks) }); res.writeHead(201); res.end(); });
    return;
  }
  res.writeHead(405); res.end();
});

(async () => {
  await new Promise((ok) => dav.listen(0, '127.0.0.1', ok));
  const port = dav.address().port;
  const davUrl = `http://127.0.0.1:${port}/dav/backups`;
  const a = new Client(); let r = await a.login('admin', 'admin123'); assert(r.status === 302, 'admin login');
  await a.post('/system/modules/toggle', { key: 'system.backup_offsite', enabled: '1' });
  await a.post('/system/modules/toggle', { key: 'system.auto_backup', enabled: '1' });

  // تب تنظیمات
  r = await a.get('/system/settings?tab=offsite'); assert(r.status === 200 && /id="st_backup_offsite_mode"/.test(r.text) && /backup_webdav_url/.test(r.text) && /backup_ftp_host/.test(r.text) && /backup_email_to/.test(r.text), 'offsite settings tab renders all destinations');
  r = await a.get('/system/backup'); assert(/ارسال پشتیبان به بیرون/.test(r.text) && /غیرفعال/.test(r.text), 'backup page shows offsite card (disabled)');

  // آزمایش اتصال بدون پیکربندی
  r = await a.post('/system/settings/test/offsite', {}); assert(r.status === 302, 'test connection redirects');
  r = await a.get('/system/settings?tab=offsite'); assert(/آزمایش ناموفق/.test(r.text), 'test without configuration reports failure');

  // پیکربندی WebDAV محلی
  r = await a.post('/system/settings/offsite', { backup_offsite_mode: 'webdav', backup_webdav_url: davUrl + '/', backup_webdav_user: 'davuser', backup_webdav_pass: 'davpass', backup_offsite_max_mb: '۵۰' });
  assert(r.status === 302, 'save offsite settings');
  r = await a.get('/system/settings?tab=offsite'); assert(new RegExp('value="' + davUrl.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '/"').test(r.text) && /name="backup_offsite_max_mb" value="50"/.test(r.text), 'settings persisted (digits normalized)');
  r = await a.post('/system/settings/test/offsite', {}); r = await a.get('/system/settings?tab=offsite'); assert(/اتصال برقرار است/.test(r.text), 'test connection succeeds against local WebDAV');

  // ارسال دستی یک پشتیبان JSON
  r = await a.post('/system/backup/create', { type: 'json' }); assert(r.status === 302, 'create json backup');
  r = await a.get('/system/backup'); assert(/data-post="\/system\/backup\/offsite\//.test(r.text), 'send button shown per file');
  const names = [...r.text.matchAll(/data-post="\/system\/backup\/offsite\/([^"]+\.json)"/g)].map((m) => m[1]);
  assert(names.length >= 1, 'found backup file: ' + names[0]);
  const name = names[0];
  r = await a.post('/system/backup/offsite/' + name, {}); assert(r.status === 302, 'manual send redirects');
  assert(received.length === 1 && received[0].url === '/dav/backups/' + encodeURIComponent(name + '.gz'), 'WebDAV received PUT with gz name: ' + (received[0] && received[0].url));
  let json = null; try { json = JSON.parse(zlib.gunzipSync(received[0].body).toString('utf8')); } catch (e) { /* ignore */ }
  assert(json && json.tables && json.tables.students && json.tables.students.length >= 100 && !json.tables.sessions, 'payload gunzips to a full JSON backup without sessions');
  r = await a.get('/system/backup'); assert(/آخرین ارسال/.test(r.text) && /موفق: WebDAV/.test(r.text) && /WebDAV \(Nextcloud/.test(r.text), 'backup page shows last successful send');
  r = await a.get('/system/activity?action=backup_offsite'); assert(r.status === 200 && /ارسال پشتیبان به بیرون/.test(r.text), 'activity logged');

  // بازیابی از همان فایل فشرده (.json.gz) که به مقصد بیرونی رفته است
  {
    r = await a.get('/system/backup');
    const studentsBefore = Number(/<div class="k">students<\/div><div class="v">([^<]+)<\/div>/.exec(r.text) ? String(/<div class="k">students<\/div><div class="v">([^<]+)<\/div>/.exec(r.text)[1]).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)) : '0');
    const fd = new FormData(); fd.append('_csrf', a.csrf); fd.append('file', new Blob([received[0].body], { type: 'application/gzip' }), name + '.gz');
    const res = await fetch(BASE + '/system/backup/restore', { method: 'POST', headers: { cookie: a.cookieHeader() }, body: fd, redirect: 'manual' });
    assert(res.status === 302, 'restore from .json.gz accepted: ' + res.status);
    r = await a.get('/system/backup'); assert(/بازیابی با موفقیت انجام شد/.test(r.text) && /سطر/.test(r.text), 'restore success flash with row count');
    const studentsAfter = Number(String(/<div class="k">students<\/div><div class="v">([^<]+)<\/div>/.exec(r.text)[1]).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
    assert(studentsAfter === studentsBefore && studentsAfter >= 100, `students count preserved after restore (${studentsBefore} → ${studentsAfter})`);
    r = await a.get('/dashboard'); assert(r.status === 200, 'session still valid after restore');
    const t = new Client(); r = await t.login('teacher1', '123456'); assert(r.status === 302, 'teacher login works after restore');
    const bad = new FormData(); bad.append('_csrf', a.csrf); bad.append('file', new Blob(['{"nope":1}'], { type: 'application/json' }), 'x.json');
    await fetch(BASE + '/system/backup/restore', { method: 'POST', headers: { cookie: a.cookieHeader() }, body: bad, redirect: 'manual' });
    r = await a.get('/system/backup'); assert(/بازیابی ناموفق/.test(r.text) && /نامعتبر/.test(r.text), 'invalid backup rejected');
  }

  // سقف حجم
  await a.post('/system/settings/offsite', { backup_offsite_max_mb: '0' });
  r = await a.post('/system/backup/offsite/' + name, {}); r = await a.get('/system/backup'); assert(/ناموفق: حجم فایل/.test(r.text) && received.length === 1, 'size cap blocks sending');
  await a.post('/system/settings/offsite', { backup_offsite_max_mb: '50' });

  // مقصد خراب (پورت بسته)
  await a.post('/system/settings/offsite', { backup_webdav_url: 'http://127.0.0.1:9/dav' });
  r = await a.post('/system/backup/offsite/' + name, {}); assert(r.status === 302, 'send to dead destination handled');
  r = await a.get('/system/backup'); assert(/ناموفق/.test(r.text) && received.length === 1, 'failure recorded, nothing received');
  r = await a.post('/system/backup/offsite/nope.json', {}); assert(r.status === 404, 'unknown file 404');

  // کار شبانه: پشتیبان خودکار + ارسال
  await a.post('/system/settings/offsite', { backup_webdav_url: davUrl });
  r = await a.post('/system/jobs/backup_auto', { action: 'run' }); assert(r.status === 302, 'run backup_auto job');
  r = await a.get('/system/jobs'); assert(/ارسال به بیرون: WebDAV/.test(r.text), 'job result mentions offsite send');
  assert(received.length === 2 && /auto-.*\.gz$/.test(decodeURIComponent(received[1].url)), 'auto backup uploaded: ' + decodeURIComponent((received[1] || {}).url || ''));

  // کار شبانه با مقصد خراب → اعلان به مدیر
  await a.post('/system/settings/offsite', { backup_webdav_url: 'http://127.0.0.1:9/dav' });
  r = await a.post('/system/jobs/backup_auto', { action: 'run' }); r = await a.get('/system/jobs'); assert(/ارسال به بیرون ناموفق/.test(r.text), 'job reports failed offsite send');
  r = await a.get('/notifications'); assert(/ارسال پشتیبان به بیرون ناموفق بود/.test(r.text), 'admin notified about failed offsite send');

  // پاک‌سازی: حذف فایل‌های ساخته‌شده در این تست و بازگشت تنظیمات
  r = await a.get('/system/backup');
  for (const n of [...r.text.matchAll(/data-post="\/system\/backup\/delete\/([^"]+)"/g)].map((m) => m[1])) if (n === name || /^auto-/.test(n)) await a.post('/system/backup/delete/' + n, {});
  await a.post('/system/settings/offsite', { backup_offsite_mode: 'none', backup_webdav_url: '', backup_webdav_user: '', backup_webdav_pass: '' });

  // خاموش‌کردن قابلیت
  await a.post('/system/modules/toggle', { key: 'system.backup_offsite', enabled: '0' });
  r = await a.get('/system/settings?tab=offsite'); assert(r.status === 200 && !/st_backup_offsite_mode/.test(r.text), 'tab hidden when feature off');
  r = await a.post('/system/backup/offsite/' + name, {}); assert(r.status === 404, 'send route 404 when feature off');
  r = await a.get('/system/backup'); assert(r.status === 200 && !/ارسال پشتیبان به بیرون/.test(r.text), 'backup page hides offsite card when off');
  await a.post('/system/modules/toggle', { key: 'system.backup_offsite', enabled: '1' });

  dav.close();
  console.log('done');
})().catch((e) => { console.error(e); process.exitCode = 2; dav.close(); });
