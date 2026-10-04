'use strict';
/** جریان زمان‌بند: صفحهٔ کارها، اجرای دستی هر کار، تغییر ساعت/توگل، cron با توکن، لاگ پیامک، اسکریپت cron */
const { Client } = require('./client');
const { execSync } = require('child_process');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 2; } else console.log('ok:', m); };
(async () => {
  const a = new Client(); let r = await a.login('admin', 'admin123'); assert(r.status === 302, 'admin login');
  r = await a.get('/system/jobs'); assert(r.status === 200 && /attendance_sms/.test(r.text) && /backup_auto/.test(r.text) && /cleanup/.test(r.text), 'jobs page lists jobs');
  const token = (r.text.match(/\/cron\?token=([a-f0-9]+)/) || [])[1]; assert(token, 'cron token shown');
  // فعال‌سازی پیامک در حالت لاگ تا کار پیامک غیبت چیزی ثبت کند
  r = await a.post('/system/settings/sms', { sms_enabled: '1', sms_provider: 'log', sms_api_key: '', sms_sender: '', sms_webhook_url: '', sms_template_absent: 'ولی گرامی، {name} در تاریخ {date} غایب بود.', site_url: 'http://localhost:3000' }); assert(r.status === 302, 'enable sms (log provider)');
  // ثبت یک غیبت امروز برای کلاس ۱ تا پیامک غیبت موضوع داشته باشد
  const t = new Client(); await t.login('teacher1', '123456');
  r = await t.get('/attendance/take?class_id=1'); const sids = [...r.text.matchAll(/name="status_(\d+)"/g)].map((m) => m[1]).filter((v, i, arr) => arr.indexOf(v) === i);
  assert(sids.length > 3, 'take form has students');
  { const date = r.text.match(/name="date" value="([^"]+)"/)[1];
    const body0 = { class_id: '1', date, session_key: 'daily' }; sids.forEach((id) => { body0['status_' + id] = 'present'; }); await t.post('/attendance/take', body0);
    const body = { class_id: '1', date, session_key: 'daily' }; sids.forEach((id, i) => { body['status_' + id] = i < 3 ? 'absent' : 'present'; }); r = await t.post('/attendance/take', body); assert(r.status === 302, 'teacher records absences today'); }
  for (const key of ['attendance_sms', 'homework_reminder', 'finance_overdue', 'library_overdue', 'tickets_autoclose', 'cleanup', 'admin_digest', 'backup_auto']) {
    r = await a.post(`/system/jobs/${key}`, { action: 'run' }); assert(r.status === 302, `run job ${key}`);
  }
  r = await a.get('/system/jobs'); assert(/>موفق</.test(r.text) && !/>ناموفق</.test(r.text), 'all jobs succeeded (no failed badge)');
  assert(/manual|دستی/.test(r.text), 'run log shows manual trigger');
  r = await a.get('/system/sms-log?context=attendance'); assert(r.status === 200 && /attendance/.test(r.text) && /غایب بود/.test(r.text), 'sms log has attendance SMS (log provider)'); // فیلتر context: کارهای بعدی (شهریه/کتابخانه) ممکن است ده‌ها پیامک دیگر بفرستند
  r = await a.get('/system/backup'); assert(/auto-/.test(r.text), 'auto backup file listed');
  // تغییر ساعت و توگل
  r = await a.post('/system/jobs/cleanup', { action: 'time', run_at: '04:15' }); r = await a.get('/system/jobs'); assert(/value="04:15"/.test(r.text), 'run_at updated');
  r = await a.post('/system/jobs/cleanup', { action: 'toggle' }); r = await a.get('/system/jobs'); assert(r.status === 200, 'toggle job');
  r = await a.post('/system/jobs/cleanup', { action: 'toggle' });
  // cron با توکن
  const bad = await fetch('http://localhost:3000/cron?token=wrong'); assert(bad.status === 403, 'cron rejects wrong token');
  const ok = await fetch('http://localhost:3000/cron?token=' + token); const j = await ok.json(); assert(ok.status === 200 && j.ok === true && typeof j.ran === 'number', 'cron endpoint runs due jobs: ran=' + j.ran);
  // تنظیمات
  r = await a.post('/system/jobs/settings', { scheduler_mode: 'internal', backup_keep: '5' }); assert(r.status === 302, 'save scheduler settings');
  // اسکریپت cron
  try { const out = execSync('node scripts/cron.js --list', { cwd: process.cwd() + '', encoding: 'utf8', timeout: 60000 }); assert(/backup_auto/.test(out), 'scripts/cron.js --list works'); } catch (e) { assert(false, 'scripts/cron.js --list: ' + (e.stdout || e.message).slice(0, 200)); }
  // دسترسی: معلم ۴۰۳
  r = await t.get('/system/jobs'); assert(r.status === 403, 'teacher cannot open jobs');
  // زمان آخرین اجرا باید به وقت محلی (نه UTC) نمایش داده شود — رگرسیون ناسازگاری منطقهٔ زمانی
  const J = require('../src/core/jalali'); const db = require('../src/core/db');
  r = await a.post('/system/jobs/cleanup', { action: 'run' }); r = await a.get('/system/jobs');
  const txt = r.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const shown = (/cleanup[^۰-۹]*([۰-۹\/]+ [۰-۹:]+)/.exec(txt) || [])[1] || '';
  const expect = J.formatDateTime(db.now()).slice(0, -1); // تا دقیقه (بدون آخرین رقم برای تحمل اختلاف یک دقیقه)
  assert(shown.startsWith(expect.slice(0, 11)) && Math.abs(Number(J.toEnglishDigits(shown.slice(-5)).replace(':', '')) - Number(J.toEnglishDigits(J.formatDateTime(db.now()).slice(-5)).replace(':', ''))) <= 2, 'last run shown in local time: ' + shown);
  console.log(process.exitCode ? 'SOME FAILED' : 'ALL PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
