'use strict';
/** جریان: گزارش مصرف پیامک (system.sms_report) — آمار بازه، تفکیک نوع/درگاه/شماره، بخش‌ها و برآورد هزینه، CSV، تاریخ نامعتبر، خاموش‌کردن */
const { Client } = require('./client');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 2; } else console.log('ok:', m); };
const en = (s) => String(s).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));

(async () => {
  const a = new Client(); let r = await a.login('admin', 'admin123'); assert(r.status === 302, 'admin login');
  await a.post('/system/modules/toggle', { key: 'system.sms_report', enabled: '1' });
  await a.post('/system/modules/toggle', { key: 'system.sms_log', enabled: '1' });

  // درگاه لاگ + ارسال آزمایشی (یک پیامک کوتاه و یک پیامک بلند چندبخشی)
  r = await a.get('/system/settings?tab=sms');
  const prev = { enabled: /name="sms_enabled"[^>]*value="1"[^>]*checked/.test(r.text) || /checked[^>]*name="sms_enabled"/.test(r.text), provider: (/name="sms_provider"[\s\S]*?<option value="([a-z]+)" selected/.exec(r.text) || [])[1] || 'log' };
  await a.post('/system/settings/sms', { sms_enabled: '1', sms_provider: 'log', sms_price: '۱۲۰۰' });
  r = await a.get('/system/settings?tab=sms'); assert(/name="sms_price" value="1200"/.test(r.text), 'sms_price saved with english digits');
  const phone = '0912' + String(Math.floor(1000000 + Math.random() * 8999999));
  r = await a.post('/system/settings/test/sms', { to: phone }); assert(r.status === 302, 'send test sms (log provider)');
  r = await a.get('/system/sms-log?context=test'); assert(r.status === 200 && /test/.test(r.text) && en(r.text).includes(phone), 'test sms logged with context test');

  // گزارش پیش‌فرض (ماه جاری)
  r = await a.get('/system/sms-log/report'); assert(r.status === 200 && /گزارش مصرف پیامک/.test(r.text), 'report page opens');
  assert(/آزمایشی/.test(r.text) && /کل پیامک‌ها/.test(r.text) && /chDays/.test(r.text), 'report shows context breakdown and daily chart');
  assert(/پرمصرف‌ترین شماره‌ها/.test(r.text) && /به تفکیک درگاه/.test(r.text) && /log/.test(r.text), 'recipients + providers sections');
  assert(/هزینهٔ تقریبی/.test(r.text) && /تومان|ریال/.test(r.text), 'cost estimate shown when price set');
  const total = Number(en((/<div class="value">([۰-۹\d,]+)<\/div><div class="label">کل پیامک‌ها/.exec(r.text) || [])[1] || '0').replace(/,/g, ''));
  assert(total >= 1, 'total count >= 1: ' + total);

  // CSV
  r = await a.get('/system/sms-log/report?export=csv'); assert(r.status === 200 && /text\/csv/.test(r.headers['content-type']) && /^\uFEFF?تاریخ,تعداد,موفق,ناموفق,/.test(r.text) && /بخش‌های ارسال‌شده/.test(r.text), 'csv export with BOM + headers');

  // بازهٔ دلخواه + تاریخ نامعتبر
  r = await a.get('/system/sms-log/report?from=1400/01/01&to=1400/01/31'); assert(r.status === 200 && /در این بازه پیامکی ارسال نشده است/.test(r.text), 'empty range shows empty state');
  r = await a.get('/system/sms-log/report?from=garbage&to=99/99/99'); assert(r.status === 200 && /گزارش مصرف پیامک/.test(r.text), 'invalid dates fall back to defaults');
  r = await a.get('/system/sms-log/report?from=1405/01/01'); assert(r.status === 200 && /ماه جاری/.test(r.text) && /ماه قبل/.test(r.text) && /۹۰ روز اخیر/.test(r.text), 'quick ranges');

  // بدون نرخ → بدون ستون هزینه
  await a.post('/system/settings/sms', { sms_price: '0' });
  r = await a.get('/system/sms-log/report'); assert(!/هزینهٔ تقریبی/.test(r.text) && /نرخ هر بخش را در/.test(r.text), 'no cost column without price, hint shown');

  // لینک از صفحهٔ لاگ
  r = await a.get('/system/sms-log'); assert(/href="\/system\/sms-log\/report"/.test(r.text), 'sms-log links to report');

  // دسترسی: معلم ۴۰۳/ریدایرکت
  const t = new Client(); await t.login('teacher1', '123456'); r = await t.get('/system/sms-log/report'); assert(r.status === 403 || r.status === 302, 'teacher cannot open report: ' + r.status);

  // خاموش‌کردن
  await a.post('/system/modules/toggle', { key: 'system.sms_report', enabled: '0' });
  r = await a.get('/system/sms-log/report'); assert(r.status === 404, 'report 404 when feature off');
  r = await a.get('/system/sms-log'); assert(!/href="\/system\/sms-log\/report"/.test(r.text), 'link hidden when off');
  await a.post('/system/modules/toggle', { key: 'system.sms_report', enabled: '1' });

  // بازگرداندن تنظیمات درگاه
  await a.post('/system/settings/sms', { sms_enabled: prev.enabled ? '1' : '0', sms_provider: prev.provider });
  console.log('done');
})().catch((e) => { console.error(e); process.exitCode = 2; });
