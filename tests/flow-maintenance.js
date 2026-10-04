'use strict';
/** جریان: حالت تعمیر و نگهداری، پایش فضای دیسک و سازوکار به‌روزرسانی (صفحهٔ وب، اجرای پس‌زمینه، بارگذاری بسته، اعتبارسنجی بسته) */
const fs = require('fs');
const path = require('path');
const { Client, BASE, superPost, superClient } = require('./client');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 2; } else console.log('ok:', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ROOT = path.join(__dirname, '..');

async function uploadZip(a, zipPath, extra) {
  const fd = new FormData();
  fd.set('_csrf', a.csrf);
  for (const [k, v] of Object.entries(extra || {})) fd.set(k, v);
  fd.set('package', new Blob([fs.readFileSync(zipPath)], { type: 'application/zip' }), path.basename(zipPath));
  const res = await fetch(BASE + '/system/update/upload', { method: 'POST', headers: { cookie: a.cookieHeader() }, body: fd, redirect: 'manual' });
  await res.text();
  return res;
}
async function waitRunner(a, maxSec) {
  for (let i = 0; i < (maxSec || 30); i++) { const l = JSON.parse((await a.get('/system/update/log')).text); if (!l.running) return l; await sleep(1000); }
  return null;
}

(async () => {
  const a = new Client(); let r = await a.login('admin', 'admin123'); assert(r.status === 302, 'admin login');
  const sa = await superClient();
  for (const k of ['system.maintenance', 'system.disk_alert', 'system.updates', 'system.scheduler', 'notifications.inapp']) await superPost('/system/modules/toggle', { key: k, enabled: '1' });
  const s = new Client(); r = await s.login('40001', '123456'); assert(r.status === 302, 'student login');

  // ---------- حالت نگهداری ----------
  r = await sa.get('/system/settings?tab=maintenance');
  assert(r.status === 200 && /name="maintenance_mode"/.test(r.text) && /name="disk_alert_min_mb"/.test(r.text) && /فضای دیسک/.test(r.text), 'settings tab «نگهداری و دیسک» renders with disk gauge');
  r = await sa.post('/system/maintenance/toggle', { enabled: '1', message: 'آزمایش نگهداری ' + Date.now(), until: 'ساعت ۱۸' });
  assert(r.status === 302 && /tab=maintenance/.test(r.location || ''), 'quick toggle on → redirect to settings tab');
  r = await s.get('/dashboard'); assert(r.status === 503 && /در حال تعمیر و نگهداری/.test(r.text) && /آزمایش نگهداری/.test(r.text) && /ساعت ۱۸/.test(r.text), 'student gets 503 page with custom message + until');
  r = await s.get('/students/me', { headers: { accept: 'application/json' } }); assert(r.status === 503 && /"maintenance":true/.test(r.text), 'JSON request gets 503 JSON');
  r = await a.get('/dashboard'); assert(r.status === 200 && /حالت تعمیر و نگهداری فعال است/.test(r.text) && !/data-post="\/system\/maintenance\/toggle"/.test(r.text), 'admin still has access + banner (no exit button for admin)');
  r = await sa.get('/dashboard'); assert(r.status === 200 && /data-post="\/system\/maintenance\/toggle"/.test(r.text), 'super sees exit button in banner');
  const anon = new Client();
  r = await anon.get('/auth/login'); assert(r.status === 200, 'login page stays open during maintenance');
  r = await anon.get('/healthz'); assert(/"maintenance":true/.test(r.text), 'healthz reports maintenance:true');
  r = await anon.get('/assets/css/app.css'); assert(r.status === 200, 'static assets still served');
  r = await s.get('/auth/logout'); assert(r.status === 302 || r.status === 200, 'logout allowed during maintenance');
  r = await sa.post('/system/maintenance/toggle', { enabled: '0', back: '/system/info' }); assert(r.status === 302 && r.location === '/system/info', 'toggle off honors safe back');
  r = await sa.post('/system/maintenance/toggle', { enabled: '0', back: 'https://evil.example' }); assert(r.status === 302 && r.location !== 'https://evil.example', 'open redirect blocked on back');
  r = await s.login('40001', '123456'); r = await s.get('/dashboard'); assert(r.status === 200, 'student access restored after toggle off');
  r = await anon.get('/healthz'); assert(/"maintenance":false/.test(r.text), 'healthz maintenance:false');
  r = await sa.get('/system/activity?q=نگهداری'); assert(r.status === 200 && /حالت تعمیر و نگهداری/.test(r.text), 'activity log records toggle');
  // پرچم فایل (برای اسکریپت‌ها)
  const flag = path.join(ROOT, 'storage', 'maintenance.flag');
  fs.writeFileSync(flag, JSON.stringify({ reason: 'پرچم فایل آزمایشی' }));
  await sleep(3200);
  r = await s.get('/dashboard'); assert(r.status === 503 && /پرچم فایل آزمایشی/.test(r.text), 'file flag enables maintenance with its reason');
  fs.unlinkSync(flag); await sleep(3200);
  r = await s.get('/dashboard'); assert(r.status === 200, 'removing flag restores access');
  // تنظیمات: ذخیره با محدودسازی آستانه‌ها
  r = await sa.post('/system/settings/maintenance', { maintenance_mode: '0', maintenance_message: 'پیام آزمایشی', maintenance_until: '', maintenance_allow_ips: '', disk_alert_enabled: '1', disk_alert_min_mb: '10', disk_alert_percent: '30' });
  r = await sa.get('/system/settings?tab=maintenance'); assert(/name="disk_alert_percent" value="50"/.test(r.text) && /name="disk_alert_min_mb" value="50"/.test(r.text) && /پیام آزمایشی/.test(r.text), 'thresholds clamped (min 50MB / 50%) and message saved');
  // IP مجاز
  await sa.post('/system/settings/maintenance', { maintenance_mode: '1', maintenance_allow_ips: '10.99.*', disk_alert_enabled: '1', disk_alert_min_mb: '500', disk_alert_percent: '90' });
  r = await s.get('/dashboard'); assert(r.status === 503, 'maintenance_mode setting blocks student');
  r = await s.get('/dashboard', { headers: { 'x-forwarded-for': '10.99.1.7' } }); assert(r.status === 200, 'allowed IP prefix passes');
  await sa.post('/system/settings/maintenance', { maintenance_mode: '0', maintenance_message: '', maintenance_until: '', maintenance_allow_ips: '', disk_alert_enabled: '1', disk_alert_min_mb: '500', disk_alert_percent: '90' });
  r = await s.get('/dashboard'); assert(r.status === 200, 'settings restored');

  // ---------- پایش دیسک ----------
  r = await sa.get('/system/info'); assert(r.status === 200 && /فضای دیسک و حجم داده‌ها/.test(r.text) && /progress-bar/.test(r.text), 'system info shows disk gauge');
  r = await sa.post('/system/update/disk-check', {}, { headers: { accept: 'application/json' } }); const dc = JSON.parse(r.text);
  assert(dc.ok && dc.disk && dc.disk.total > 0 && dc.usage && typeof dc.usage.backups.bytes === 'number', 'disk-check JSON returns disk + usage');
  const tag = Date.now();
  await sa.post('/system/settings/maintenance', { maintenance_mode: '0', disk_alert_enabled: '1', disk_alert_min_mb: '99999999', disk_alert_percent: '99' });
  r = await a.post('/system/jobs/disk_check', { action: 'run' }); assert(r.status === 302, 'disk_check job run');
  r = await a.get('/system/jobs'); const m = r.text.match(/disk_check[\s\S]{0,2000}?(وضعیت عادی[^<"]*|هشدار[^<"]*|بحرانی[^<"]*)/);
  assert(m && /بحرانی/.test(m[1]) && /(اعلان برای|اعلان امروز قبلاً)/.test(m[1]), 'job reports critical + notification (' + (m ? m[1].slice(0, 60) : '-') + ')');
  r = await a.get('/dashboard'); assert(/فضای دیسک سرور (رو به اتمام است|تقریباً پر شده است)/.test(r.text) && /href="\/system\/backup"/.test(r.text) && !/href="\/system\/info"/.test(r.text), 'admin banner shows disk warning (backup link, no super-only info link)');
  r = await sa.get('/dashboard'); assert(/فضای دیسک سرور/.test(r.text) && /href="\/system\/info"/.test(r.text), 'super banner links to system info');
  r = await s.get('/dashboard'); assert(!/فضای دیسک سرور/.test(r.text), 'student never sees disk banner');
  r = await a.get('/notifications'); assert(/فضای دیسک سرور/.test(r.text), 'admin notification created');
  await sa.post('/system/settings/maintenance', { maintenance_mode: '0', disk_alert_enabled: '1', disk_alert_min_mb: '500', disk_alert_percent: '90' });
  r = await a.get('/dashboard'); assert(!/فضای دیسک سرور (رو به اتمام است|تقریباً پر شده است)/.test(r.text), 'banner disappears after thresholds restored (cache invalidated)');
  await sa.post('/system/settings/maintenance', { maintenance_mode: '0', disk_alert_enabled: '0', disk_alert_min_mb: '500', disk_alert_percent: '90' });
  r = await a.post('/system/jobs/disk_check', { action: 'run' }); r = await a.get('/system/jobs'); assert(/هشدار دیسک در تنظیمات خاموش است/.test(r.text), 'job respects disk_alert_enabled=0');
  await sa.post('/system/settings/maintenance', { maintenance_mode: '0', disk_alert_enabled: '1', disk_alert_min_mb: '500', disk_alert_percent: '90' });
  void tag;

  // ---------- به‌روزرسانی ----------
  r = await sa.get('/system/update');
  assert(r.status === 200 && /وضعیت نسخه/.test(r.text) && /action="\/system\/update\/upload"/.test(r.text) && /action="\/system\/update\/run"/.test(r.text) && /id="updLog"/.test(r.text), 'update page renders');
  r = await sa.get('/system/update/log'); const lg = JSON.parse(r.text); assert(lg.ok && Array.isArray(lg.lines) && typeof lg.running === 'boolean', 'update log endpoint JSON');
  r = await s.get('/system/update'); assert(r.status === 403 || r.status === 302 || r.status === 404, 'student cannot open update page');
  const restartFile = path.join(ROOT, 'tmp', 'restart.txt');
  try { fs.unlinkSync(restartFile); } catch (e) { /* none */ }
  r = await sa.post('/system/update/run', { backup_first: '1' }); assert(r.status === 302 && r.location === '/system/update', 'run → background runner started');
  let done = await waitRunner(sa, 40);
  assert(done && done.status === 'ok' && done.lines.some((l) => /پشتیبان پیش از به‌روزرسانی/.test(l)) && done.lines.some((l) => /npm install لازم نیست|npm install با موفقیت/.test(l)) && done.lines.some((l) => /پایان: موفق/.test(l)), 'runner finished ok with backup + npm + schema steps');
  assert(fs.existsSync(restartFile), 'restart.txt touched by runner');
  r = await a.get('/healthz'); assert(/"maintenance":false/.test(r.text), 'maintenance flag cleared after runner');
  r = await sa.get('/system/update'); assert(/آخرین به‌روزرسانی موفق/.test(r.text) && /درخواست ری‌استارت در انتظار/.test(r.text), 'page shows success + pending restart');
  // بستهٔ نامعتبر (نام دیگر)
  const { ZipWriter } = require('../src/core/zip');
  const tmpDir = path.join(ROOT, 'storage', 'tmp'); fs.mkdirSync(tmpDir, { recursive: true });
  const bad = path.join(tmpDir, 'bad-pkg.zip'); let w = new ZipWriter(bad); w.add('other-1.0/package.json', JSON.stringify({ name: 'other-app', version: '9.9.9' })); w.add('other-1.0/app.js', '//'); w.add('other-1.0/src/x.js', '//'); w.close();
  let res = await uploadZip(sa, bad); r = await sa.get('/system/update'); assert(res.status === 302 && /متعلق به برنامهٔ دیگری/.test(r.text), 'foreign package rejected');
  // بستهٔ قدیمی‌تر
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const old = path.join(tmpDir, 'old-pkg.zip'); w = new ZipWriter(old); w.add('mad-0/package.json', JSON.stringify({ name: pkg.name, version: '0.0.1' })); w.add('mad-0/app.js', '//'); w.add('mad-0/src/x.js', '//'); w.close();
  res = await uploadZip(sa, old); r = await sa.get('/system/update'); assert(/قدیمی‌تر است/.test(r.text), 'older package rejected');
  // بستهٔ معتبر (نسخهٔ مساوی + فایل‌های یکسان + یک فایل جدید + تلاش برای نوشتن در storage/.env که باید نادیده گرفته شود)
  const good = path.join(tmpDir, 'good-pkg.zip'); w = new ZipWriter(good);
  w.add('mad4-main/package.json', fs.readFileSync(path.join(ROOT, 'package.json')));
  w.add('mad4-main/app.js', fs.readFileSync(path.join(ROOT, 'app.js')));
  w.add('mad4-main/src/_update_probe.txt', 'probe ' + tag);
  w.add('mad4-main/storage/_should_not_exist.txt', 'x'); w.add('mad4-main/.env', 'HACK=1'); w.add('mad4-main/../escape.txt', 'x'); w.add('mad4-main/node_modules/x/index.js', 'x');
  w.close();
  res = await uploadZip(sa, good);
  done = await waitRunner(sa, 40);
  const probe = path.join(ROOT, 'src', '_update_probe.txt');
  assert(res.status === 302 && fs.existsSync(probe) && fs.readFileSync(probe, 'utf8') === 'probe ' + tag, 'valid package applied (new file written)');
  assert(!fs.existsSync(path.join(ROOT, 'storage', '_should_not_exist.txt')) && !fs.existsSync(path.join(ROOT, 'escape.txt')) && !fs.existsSync(path.join(ROOT, 'node_modules', 'x')) && !(fs.existsSync(path.join(ROOT, '.env')) && /HACK=1/.test(fs.readFileSync(path.join(ROOT, '.env'), 'utf8'))), 'storage/.env/node_modules/path-escape entries skipped');
  assert(done && done.status === 'ok' && done.lines.some((l) => /بسته: /.test(l)) && done.lines.some((l) => /نادیده گرفته شد/.test(l)), 'post-upload runner finished ok with skip report');
  r = await sa.get('/system/update'); assert(/بارگذاری بستهٔ نسخهٔ/.test(r.text), 'update history lists the upload');
  r = await sa.get('/system/activity?q=بسته'); assert(/بارگذاری بستهٔ نسخهٔ/.test(r.text), 'activity log has upload entry');
  try { fs.unlinkSync(probe); } catch (e) { /* ignore */ }
  for (const f of [bad, old, good]) { try { fs.unlinkSync(f); } catch (e) { /* ignore */ } }
  try { fs.unlinkSync(restartFile); } catch (e) { /* ignore */ }
  // ری‌استارت دستی
  r = await sa.post('/system/update/restart', {}, { headers: { accept: 'application/json' } }); assert(r.status === 200 && /"ok":true/.test(r.text) && fs.existsSync(restartFile), 'restart request writes tmp/restart.txt');
  try { fs.unlinkSync(restartFile); } catch (e) { /* ignore */ }
  // CLI --check
  const { execFileSync } = require('child_process');
  const out = JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'update.js'), '--check'], { cwd: ROOT, encoding: 'utf8' }));
  assert(out.version === pkg.version && Array.isArray(out.missingDeps) && out.missingDeps.length === 0, 'scripts/update.js --check reports version + complete deps');
  // غیرفعال‌کردن قابلیت → منو و مسیر بسته می‌شود
  await superPost('/system/modules/toggle', { key: 'system.updates', enabled: '0' });
  r = await sa.get('/system/update'); assert(r.status !== 200 || /غیرفعال/.test(r.text), 'updates feature disabled → route blocked');
  r = await a.get('/dashboard'); assert(!/href="\/system\/update"/.test(r.text), 'menu entry hidden when disabled');
  await superPost('/system/modules/toggle', { key: 'system.updates', enabled: '1' });
  await superPost('/system/modules/toggle', { key: 'system.maintenance', enabled: '0' });
  r = await sa.post('/system/maintenance/toggle', { enabled: '1' }); assert(!(r.status === 302 && /tab=maintenance/.test(r.location || '')), 'toggle blocked when feature disabled (status ' + r.status + ')');
  r = await s.get('/dashboard'); assert(r.status === 200, 'student still has access (maintenance feature disabled → toggle had no effect)');
  await superPost('/system/modules/toggle', { key: 'system.maintenance', enabled: '1' });
  await sa.post('/system/maintenance/toggle', { enabled: '1' }); r = await s.get('/dashboard'); assert(r.status === 503, 'mode on again with feature enabled');
  await superPost('/system/modules/toggle', { key: 'system.maintenance', enabled: '0' }); r = await s.get('/dashboard'); assert(r.status === 200, 'disabling the feature neutralises maintenance_mode setting');
  await superPost('/system/modules/toggle', { key: 'system.maintenance', enabled: '1' }); await sa.post('/system/maintenance/toggle', { enabled: '0' });
  await superPost('/system/modules/toggle', { key: 'system.maintenance', enabled: '1' });
  await sa.post('/system/settings/maintenance', { maintenance_mode: '0', maintenance_message: '', maintenance_until: '', maintenance_allow_ips: '', disk_alert_enabled: '1', disk_alert_min_mb: '500', disk_alert_percent: '90' });
  console.log(process.exitCode ? 'flow-maintenance: FAILED' : 'flow-maintenance: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
