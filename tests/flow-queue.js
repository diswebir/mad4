'use strict';
/** جریان: صف تلاش مجدد پیامک/ایمیل (notifications.retry_queue) — صف شدن خطای گذرا، پردازش دستی/اجباری، تلاش مجدد تکی، سقف تلاش + اعلان مدیر، لغو، کار زمان‌بندی، خطای پیکربندی صف نمی‌شود */
const http = require('http');
const { Client } = require('./client');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 2; } else console.log('ok:', m); };
const en = (s) => String(s).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));

(async () => {
  // درگاه پیامک ساختگی (وب‌هوک) با حالت قابل تغییر
  const mock = { mode: 'fail', calls: [] };
  const server = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { mock.calls.push({ url: req.url, body: b }); if (mock.mode === 'fail') { res.statusCode = 503; res.end('down'); } else { res.statusCode = 200; res.end('{"ok":true}'); } }); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const a = new Client(); let r = await a.login('admin', 'admin123'); assert(r.status === 302, 'admin login');
  for (const k of ['notifications.retry_queue', 'notifications.sms', 'system.sms_log', 'system.scheduler']) await a.post('/system/modules/toggle', { key: k, enabled: '1' });
  // ذخیرهٔ تنظیمات قبلی پیامک
  r = await a.get('/system/settings?tab=sms');
  const prevProvider = (/name="sms_provider"[\s\S]*?<option value="([a-z]+)" selected/.exec(r.text) || [, 'log'])[1];
  const prevEnabled = /name="sms_enabled"[^>]*value="1"[^>]*checked|checked[^>]*name="sms_enabled"/.test(r.text) || /<option value="1" selected/.test((/name="sms_enabled"[\s\S]*?<\/select>/.exec(r.text) || [''])[0]);
  await a.post('/system/settings/sms', { sms_enabled: '1', sms_provider: 'webhook', sms_api_key: 'test-key', sms_sender: '1000', sms_webhook_url: `http://127.0.0.1:${port}/sms`, notify_retry_max: '2' });
  r = await a.get('/system/settings?tab=sms'); assert(/name="notify_retry_max" value="2"/.test(r.text) && r.text.includes(`127.0.0.1:${port}/sms`), 'webhook + retry settings saved');

  // ۱) خطای گذرا → صف
  const phone = '0935' + String(Math.floor(1000000 + Math.random() * 8999999));
  r = await a.post('/system/settings/test/sms', { to: phone }); assert(r.status === 302, 'test sms posted (gateway down)');
  r = await a.get('/system/settings?tab=sms'); assert(/صف تلاش مجدد/.test(r.text) && /HTTP 503/.test(r.text), 'flash says queued with HTTP 503');
  assert(mock.calls.length >= 1 && mock.calls[mock.calls.length - 1].body.includes(phone), 'gateway received the attempt');
  r = await a.get('/system/notify-queue?q=' + phone); assert(r.status === 200 && /در انتظار/.test(r.text) && en(r.text).includes(phone), 'queue page lists pending item');
  const id1 = Number((new RegExp('/system/notify-queue/(\\d+)/retry').exec(r.text) || [])[1]); assert(id1 > 0, 'queue id found: ' + id1);
  assert(/۱\/۲/.test(r.text), 'attempts shown 1/2');
  r = await a.get('/system/sms-log?q=' + phone); assert(/در صف تلاش مجدد/.test(r.text), 'sms log marks row as queued');

  // ۲) پردازش عادی: هنوز سررسید نشده → چیزی ارسال نمی‌شود؛ اجباری → ارسال می‌شود
  mock.mode = 'ok';
  r = await a.post('/system/notify-queue/process', {}); assert(r.status === 302, 'process (due only)');
  r = await a.get('/system/notify-queue?q=' + phone); assert(/در انتظار/.test(r.text) && /موردی برای پردازش نبود/.test(r.text), 'not due yet → still pending');
  r = await a.post('/system/notify-queue/process', { force: '1' }); assert(r.status === 302, 'process forced');
  r = await a.get('/system/notify-queue?q=' + phone); assert(/ارسال شد/.test(r.text) && !/در انتظار<\/span>/.test(r.text), 'item sent after forced processing');
  r = await a.get('/system/sms-log?q=' + phone); assert(/>ارسال</.test(r.text) && !/در صف تلاش مجدد/.test(r.text), 'sms log updated to sent');
  const sentCall = mock.calls[mock.calls.length - 1]; assert(sentCall && sentCall.body.includes(phone) && /test-key/.test(sentCall.body), 'retry delivered to gateway with same payload');

  // ۳) سقف تلاش: دوباره خراب → صف → تلاش تکی ناموفق → ناموفق نهایی + اعلان مدیر
  mock.mode = 'fail';
  const phone2 = '0936' + String(Math.floor(1000000 + Math.random() * 8999999));
  await a.post('/system/settings/test/sms', { to: phone2 });
  r = await a.get('/system/notify-queue?q=' + phone2); const id2 = Number((new RegExp('/system/notify-queue/(\\d+)/retry').exec(r.text) || [])[1]); assert(id2 > id1, 'second item queued ' + id2);
  r = await a.post(`/system/notify-queue/${id2}/retry`, {}); assert(r.status === 302, 'single retry');
  r = await a.get('/system/notify-queue?q=' + phone2); assert(/ناموفق/.test(r.text) && /۲\/۲/.test(r.text) && /از صف خارج شد|ناموفق نهایی|ارسال دوباره ناموفق/.test(r.text), 'max attempts reached → failed');
  r = await a.get('/notifications'); assert(/پیام پس از چند تلاش ارسال نشد/.test(r.text), 'admin notified about final failure');
  r = await a.get('/system/sms-log?q=' + phone2); assert(/ناموفق/.test(r.text), 'sms log marks failed');
  // تلاش دوباره برای ناموفق‌ها وقتی درگاه برگشت
  mock.mode = 'ok';
  r = await a.post('/system/notify-queue/retry-failed', {}); assert(r.status === 302, 'retry-failed');
  r = await a.get('/system/notify-queue?q=' + phone2); assert(/ارسال شد/.test(r.text), 'failed item sent after retry-failed');

  // ۴) لغو
  mock.mode = 'fail';
  const phone3 = '0937' + String(Math.floor(1000000 + Math.random() * 8999999));
  await a.post('/system/settings/test/sms', { to: phone3 });
  r = await a.get('/system/notify-queue?q=' + phone3); const id3 = Number((new RegExp('/system/notify-queue/(\\d+)/cancel').exec(r.text) || [])[1]); assert(id3 > 0, 'third item queued');
  r = await a.post(`/system/notify-queue/${id3}/cancel`, {}); r = await a.get('/system/notify-queue?q=' + phone3); assert(/لغو شده/.test(r.text), 'item cancelled');
  r = await a.get('/system/notify-queue?status=cancelled'); assert(en(r.text).includes(phone3), 'status filter works');
  r = await a.get('/system/notify-queue?channel=email'); assert(r.status === 200 && !en(r.text).includes(phone3), 'channel filter works');

  // ۵) کار زمان‌بندی‌شده
  r = await a.post('/system/jobs/notify_retry', { action: 'run' }); assert(r.status === 302, 'run notify_retry job');
  r = await a.get('/system/jobs'); assert(/تلاش مجدد ارسال پیامک\/ایمیل/.test(r.text) && /(مورد پردازش شد|موردی برای ارسال مجدد نبود)/.test(r.text), 'job listed with result');

  // ۶) خطای پیکربندی صف نمی‌شود
  const before = (await a.get('/system/notify-queue')).text; const cntBefore = (/<div class="value">([۰-۹]+)<\/div><div class="label">در انتظار/.exec(before) || [, '0'])[1];
  await a.post('/system/settings/sms', { sms_enabled: '1', sms_provider: 'webhook', sms_api_key: '', sms_webhook_url: `http://127.0.0.1:${port}/sms`, notify_retry_max: '2' });
  r = await a.post('/system/settings/test/sms', { to: phone3 }); r = await a.get('/system/settings?tab=sms'); assert(/کلید API تنظیم نشده/.test(r.text) && !/صف تلاش مجدد/.test(r.text), 'config error reported, not queued');
  const after = (await a.get('/system/notify-queue')).text; const cntAfter = (/<div class="value">([۰-۹]+)<\/div><div class="label">در انتظار/.exec(after) || [, '0'])[1];
  assert(cntBefore === cntAfter, 'pending count unchanged (' + cntBefore + ')');

  // ۷) غیرفعال‌کردن قابلیت → صفحه مخفی و ارسال ناموفق صف نمی‌شود
  await a.post('/system/modules/toggle', { key: 'notifications.retry_queue', enabled: '0' });
  r = await a.get('/system/notify-queue'); assert(r.status === 404 || r.status === 403, 'queue page hidden when disabled');
  await a.post('/system/modules/toggle', { key: 'notifications.retry_queue', enabled: '1' });

  // بازگردانی تنظیمات
  await a.post('/system/settings/sms', { sms_enabled: prevEnabled ? '1' : '0', sms_provider: prevProvider, sms_api_key: '', sms_webhook_url: '', notify_retry_max: '5' });
  server.close();
  console.log('flow-queue done');
})().catch((e) => { console.error(e); process.exit(1); });
