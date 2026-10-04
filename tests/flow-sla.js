'use strict';
/** جریان SLA تیکت‌ها: نشان مهلت در فهرست/تیکت، فیلتر خارج از مهلت، گزارش رعایت، تنظیمات، اعلان خودکار (job)، خروجی CSV، داشبورد، و رفتار پاسخ ولی */
const { Client } = require('./client');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 2; } else console.log('ok:', m); };
const fa = '۰۱۲۳۴۵۶۷۸۹';
const en = (s) => String(s).replace(/[۰-۹]/g, (d) => fa.indexOf(d));
const strip = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
(async () => {
  const a = new Client(); let r = await a.login('admin', 'admin123'); assert(r.status === 302, 'admin login');
  const s = new Client(); r = await s.login('40002', '123456'); assert(r.status === 302, 'student login');
  for (const key of ['tickets.sla', 'tickets.priority', 'tickets.stats', 'tickets.export', 'tickets.notify', 'notifications.inapp', 'system.scheduler']) { r = await a.post('/system/modules/toggle', { key, enabled: '1' }); }

  // --- تنظیمات SLA ---
  r = await a.get('/system/settings?tab=communication'); assert(r.status === 200 && /name="ticket_sla_urgent_hours"/.test(r.text) && /name="ticket_sla_notify"/.test(r.text), 'SLA settings fields present');
  const keep = {}; ['ticket_sla_hours', 'ticket_sla_urgent_hours', 'ticket_sla_high_hours', 'ticket_sla_low_hours', 'ticket_sla_resolve_days', 'ticket_sla_warn_percent', 'ticket_sla_notify'].forEach((k) => { keep[k] = (new RegExp('name="' + k + '"[^>]*value="([^"]*)"').exec(r.text) || [])[1]; });
  r = await a.post('/system/settings/communication', Object.assign({}, keep, { ticket_sla_hours: '48', ticket_sla_urgent_hours: '4', ticket_sla_high_hours: '24', ticket_sla_low_hours: '96', ticket_sla_resolve_days: '7', ticket_sla_warn_percent: '75', ticket_sla_notify: '1' }));
  assert(r.status === 302, 'SLA settings saved');

  // --- فهرست مدیر: نشان‌ها و فیلتر ---
  r = await a.get('/tickets'); assert(r.status === 200, 'admin tickets list');
  assert(/مهلت پاسخ/.test(r.text) && /\?sla=overdue/.test(r.text) && /\?sla=warning/.test(r.text), 'SLA pills + column present');
  const overdueN = Number(en((/خارج از مهلت\s*([۰-۹\d]+)/.exec(strip(r.text)) || [])[1] || '0'));
  const okN = Number(en((/در مهلت\s*([۰-۹\d]+)/.exec(strip(r.text)) || [])[1] || '0'));
  assert(overdueN + okN > 0, 'SLA counters: overdue=' + overdueN + ' ok=' + okN);
  r = await a.get('/tickets?sla=overdue'); const rows = (r.text.match(/<tr class="/g) || []).length - 0;
  assert(r.status === 200, 'overdue filter page');
  const overdueRows = (r.text.match(/badge badge-soft-danger"[^>]*title="مهلت/g) || []).length;
  assert(overdueN === 0 ? overdueRows === 0 : overdueRows > 0 && !/badge-soft-success"[^>]*title="مهلت/.test(r.text), 'overdue filter lists only overdue tickets (' + overdueRows + ')');
  if (overdueN > 0) {
    const firstOverdue = (/href="\/tickets\/(\d+)" class="ltr/.exec(r.text) || [])[1];
    r = await a.get('/tickets/' + firstOverdue); assert(r.status === 200 && /مهلت پاسخ \(SLA\)/.test(r.text) && /خارج از مهلت/.test(strip(r.text)) && /سررسید/.test(r.text), 'overdue ticket page shows SLA card with overdue state');
    r = await a.get('/tickets'); assert(/تیکت از مهلت پاسخ \(SLA\) خارج شده است/.test(strip(r.text)), 'overdue alert on tickets index');
    r = await a.get('/dashboard'); assert(/تیکت خارج از مهلت پاسخ/.test(strip(r.text)), 'dashboard pending widget shows overdue tickets');
  }

  // --- تیکت تازه: در مهلت؛ تغییر اولویت مهلت را عوض می‌کند ---
  r = await s.get('/tickets/new'); assert(r.status === 200, 'student new ticket form');
  const subj = 'تست SLA ' + Date.now().toString().slice(-5);
  r = await s.post('/tickets', { subject: subj, message: 'متن تست SLA', department: 'admin', category: 'technical' }); assert(r.status === 302 && /\/tickets\/\d+/.test(r.location || ''), 'student created ticket');
  const tid = (r.location.match(/\/tickets\/(\d+)/) || [])[1];
  r = await a.get('/tickets/' + tid); let txt = strip(r.text);
  assert(/مهلت پاسخ \(SLA\)/.test(txt) && /در مهلت/.test(txt) && /مهلت پاسخ اول \(عادی\)\s*۴۸ ساعت/.test(txt.replace(/\s+/g, ' ')), 'fresh ticket: within SLA, 48h target for normal');
  r = await a.post('/tickets/' + tid + '/priority', { priority: 'urgent' }); assert(r.status === 302, 'priority → urgent');
  r = await a.get('/tickets/' + tid); txt = strip(r.text); assert(/مهلت پاسخ اول \(فوری\)\s*۴ ساعت/.test(txt), 'urgent target = 4h');
  r = await a.post('/tickets/' + tid + '/priority', { priority: 'high' }); r = await a.get('/tickets/' + tid); txt = strip(r.text); assert(/مهلت پاسخ اول \(زیاد\)\s*۲۴ ساعت/.test(txt), 'high target = 24h');
  r = await a.post('/system/settings/communication', Object.assign({}, keep, { ticket_sla_high_hours: '12', ticket_sla_notify: '1' }));
  r = await a.get('/tickets/' + tid); txt = strip(r.text); assert(/مهلت پاسخ اول \(زیاد\)\s*۱۲ ساعت/.test(txt), 'settings change applied (high = 12h)');
  // دانش‌آموز کارت SLA را نمی‌بیند
  r = await s.get('/tickets/' + tid); assert(r.status === 200 && !/مهلت پاسخ \(SLA\)/.test(r.text), 'student does not see SLA card');
  r = await s.get('/tickets'); assert(!/\?sla=overdue/.test(r.text), 'student list has no SLA pills');
  // پاسخ مدیر → اولین پاسخ در مهلت
  r = await a.post('/tickets/' + tid + '/reply', { message: 'پاسخ مدیر برای تست SLA' }); assert(r.status === 302, 'admin replied');
  r = await a.get('/tickets/' + tid); txt = strip(r.text); assert(/اولین پاسخ کارکنان/.test(txt) && /در مهلت/.test(txt) && /پاسخ داده شده/.test(txt), 'after reply: first-response recorded within SLA');

  // --- آمار ---
  r = await a.get('/tickets/stats'); txt = strip(r.text);
  assert(r.status === 200 && /رعایت مهلت پاسخ \(SLA\)/.test(txt) && /پاسخ اول در مهلت/.test(txt) && /باز و خارج از مهلت/.test(txt) && /حل‌نشده بیش از/.test(txt), 'stats page has SLA report');
  assert(/خارج از مهلت/.test((r.text.split('عملکرد پاسخ‌دهندگان')[1] || '')), 'per-assignee overdue column');

  // --- خروجی CSV ---
  r = await a.get('/tickets/export'); assert(r.status === 200 && /SLA/.test(r.text.split('\n')[0]), 'CSV export has SLA column');

  // --- کار زمان‌بندی‌شده: اعلان خارج از مهلت ---
  r = await a.get('/system/jobs'); assert(r.status === 200 && /tickets_sla_alert/.test(r.text), 'SLA job listed');
  r = await a.post('/system/jobs/tickets_sla_alert', { action: 'run' }); assert(r.status === 302, 'SLA job run');
  r = await a.get('/system/jobs'); txt = strip(r.text);
  const m = /هشدار تیکت‌های خارج از مهلت پاسخ \(SLA\): ([^(]+)/.exec(txt);
  assert(!!m, 'job flash: ' + (m ? m[1].trim() : '?'));
  if (overdueN > 0) {
    const sent = Number(en((/([۰-۹\d]+) اعلان ارسال شد/.exec(m[1]) || [])[1] || '0'));
    assert(/اعلان ارسال شد/.test(m[1]) || /اطلاع‌رسانی شده‌اند/.test(m[1]), 'job handled overdue tickets (sent=' + sent + ')');
    if (sent > 0) { r = await a.get('/notifications'); assert(/تیکت خارج از مهلت پاسخ/.test(strip(r.text)), 'admin received SLA notification'); }
    else console.log('skip: alerts already sent within 24h');
    r = await a.post('/system/jobs/tickets_sla_alert', { action: 'run' }); r = await a.get('/system/jobs'); txt = strip(r.text);
    assert(/اطلاع‌رسانی شده‌اند|تیکت خارج از مهلت وجود ندارد/.test(txt), 'second run: no duplicate alerts within 24h');
  }
  // خاموش‌کردن اعلان در تنظیمات
  r = await a.post('/system/settings/communication', Object.assign({}, keep, { ticket_sla_notify: '0' }));
  r = await a.post('/system/jobs/tickets_sla_alert', { action: 'run' }); r = await a.get('/system/jobs'); assert(/هشدار SLA در تنظیمات خاموش است/.test(strip(r.text)), 'job respects ticket_sla_notify=0');

  // --- ولی: پاسخ ولی تیکت را «پاسخ داده شده» نمی‌کند ---
  const lp = await new Client().get('/auth/login'); const parentUser = (lp.text.match(/data-u="(09\d{9})"/) || [])[1];
  if (parentUser) {
    const p = new Client(); r = await p.login(parentUser, '123456');
    if (r.status === 302) {
      r = await p.get('/tickets/new'); const kid = (/name="student_id"[\s\S]*?value="(\d+)"/.exec(r.text) || [])[1];
      r = await p.post('/tickets', { subject: 'تیکت ولی ' + Date.now().toString().slice(-4), message: 'سؤال ولی', department: 'admin', category: 'academic', student_id: kid || '' }); assert(r.status === 302, 'parent created ticket');
      const pid = (String(r.location).match(/\/tickets\/(\d+)/) || [])[1];
      r = await p.post('/tickets/' + pid + '/reply', { message: 'پیگیری ولی' }); assert(r.status === 302, 'parent replied');
      r = await a.get('/tickets/' + pid); txt = strip(r.text); assert(/وضعیت\s*باز/.test(txt) && !/وضعیت\s*پاسخ داده شده/.test(txt), 'parent reply keeps ticket OPEN (not answered)');
      r = await a.post('/tickets/' + pid + '/status', { status: 'closed' });
    } else console.log('skip: parent login failed');
  } else console.log('skip: no demo parent');

  // --- غیرفعال‌سازی قابلیت ---
  r = await a.post('/system/modules/toggle', { key: 'tickets.sla', enabled: '0' });
  r = await a.get('/tickets?sla=overdue'); assert(r.status === 200 && !/\?sla=warning/.test(r.text) && !/<th>مهلت پاسخ<\/th>/.test(r.text), 'feature off: no SLA UI');
  r = await a.get('/tickets/' + tid); assert(!/مهلت پاسخ \(SLA\)/.test(r.text), 'feature off: no SLA card');
  r = await a.get('/tickets/stats'); assert(r.status === 200 && !/رعایت مهلت پاسخ/.test(r.text), 'feature off: no SLA report');
  r = await a.post('/system/modules/toggle', { key: 'tickets.sla', enabled: '1' });
  // بازگرداندن تنظیمات
  r = await a.post('/system/settings/communication', keep);
  r = await a.post('/tickets/' + tid + '/status', { status: 'closed' });
  console.log('done');
})().catch((e) => { console.error(e); process.exitCode = 2; });
