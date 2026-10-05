'use strict';
/** جریان: تنظیمات جامع مدیر — زبانه‌های جدید، اثر تنظیمات در ماژول‌ها، ویرایشگر «همهٔ تنظیمات» (جستجو/ویرایش/بازگشت/خروجی/ورودی JSON)، سقف پیوست کاربران */
const fs = require('fs');
const path = require('path');
const { Client, BASE, superPost, superClient } = require('./client');
const J = require('../src/core/jalali');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 2; } else console.log('ok:', m); };
const ROOT = path.join(__dirname, '..');
const en = (s) => String(s).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));

async function multipart(a, urlPath, fields, file) {
  const fd = new FormData(); fd.set('_csrf', a.csrf);
  for (const [k, v] of Object.entries(fields || {})) fd.set(k, v);
  if (file) fd.set(file.field, new Blob([file.data], { type: file.type || 'application/octet-stream' }), file.name);
  const res = await fetch(BASE + urlPath, { method: 'POST', headers: { cookie: a.cookieHeader() }, body: fd, redirect: 'manual' });
  const text = await res.text();
  return { status: res.status, location: res.headers.get('location'), text };
}

(async () => {
  const a = new Client(); let r = await a.login('admin', 'admin123'); assert(r.status === 302, 'admin login');
  const sa = await superClient();
  for (const k of ['system.advanced_settings', 'tickets', 'attendance.edit_window', 'finance.invoices']) await superPost('/system/modules/toggle', { key: k, enabled: '1' });

  // ---------- زبانه‌ها ----------
  const expect = { school: ['school_short_name', 'site_url'], academic: ['attendance_edit_days', 'max_weekly_hours', 'homework_reminder_days'], communication: ['ticket_categories', 'allow_student_tickets_to_admin', 'dashboard_events_days', 'reminder_interval_days'], services: ['library_loan_days', 'leave_days_per_year', 'discipline_report_days'], finance: ['currency_unit', 'invoice_due_days'], users: ['student_default_password', 'force_password_change', 'password_min_length'], security: ['upload_max_mb', 'login_max_attempts'], maintenance: ['disk_alert_percent', 'cleanup_notifications_days'], advanced: ['advSearch'] };
  for (const [tab, names] of Object.entries(expect)) {
    r = await (['maintenance', 'advanced', 'sms', 'email', 'offsite'].includes(tab) ? sa : a).get('/system/settings?tab=' + tab);
    assert(r.status === 200 && names.every((n) => r.text.includes('name="' + n + '"') || r.text.includes('id="' + n + '"')), `tab ${tab} renders with ${names.join(',')}`);
  }
  r = await a.get('/system/settings?tab=academic'); assert(!/name="ticket_categories"/.test(r.text) && !/name="library_loan_days"/.test(r.text), 'academic tab no longer mixes tickets/library');

  // ---------- اثر تنظیمات: تیکت دانش‌آموز به مدیر ----------
  const s = new Client(); r = await s.login('40001', '123456'); assert(r.status === 302, 'student login');
  r = await s.get('/tickets/new'); assert(/<option value="admin">مدیریت مدرسه<\/option>/.test(r.text), 'student sees «مدیریت مدرسه» by default');
  r = await a.post('/system/settings/communication', { allow_student_tickets_to_admin: '0', ticket_categories: 'آموزشی,مالی,فنی,سایر' }); assert(r.status === 302, 'save communication tab');
  r = await s.get('/tickets/new'); assert(!/<option value="admin">مدیریت مدرسه<\/option>/.test(r.text), 'option hidden when disallowed');
  const subj = 'تیکت آزمایش تنظیمات ' + Date.now();
  r = await multipart(s, '/tickets', { subject: subj, message: 'متن آزمایشی', department: 'admin', category: 'سایر', priority: 'normal' });
  assert(r.status === 302, 'student ticket created with forced department');
  r = await a.get('/tickets?q=' + encodeURIComponent(subj)); const tid = ((r.text.match(new RegExp('href="/tickets/(\\d+)"[^>]*>[^<]*' + subj)) || r.text.slice(r.text.indexOf(subj) - 400, r.text.indexOf(subj) + 400).match(/href="\/tickets\/(\d+)"/)) || [])[1]; assert(r.status === 200 && r.text.includes(subj) && tid, 'ticket listed for admin');
  r = await a.get('/tickets/' + tid); assert(r.status === 200 && /گیرنده<\/span><span>دفتر \/ امور اداری</.test(r.text), 'ticket routed to staff instead of admin');
  await a.post('/system/settings/communication', { allow_student_tickets_to_admin: '1' });
  r = await s.get('/tickets/new'); assert(/<option value="admin">مدیریت مدرسه<\/option>/.test(r.text), 'option back after restore');

  // ---------- اثر تنظیمات: مهلت ویرایش حضور و غیاب ----------
  const t = new Client(); r = await t.login('teacher1', '123456'); assert(r.status === 302, 'teacher login');
  r = await a.post('/system/settings/academic', { attendance_edit_days: '0' }); assert(r.status === 302, 'attendance_edit_days=0 saved');
  const past = J.toJalali(J.addDays(J.todayISO(), -2));
  r = await t.post('/attendance/take', { class_id: '1', date: past, session_key: 'daily' }); r = await t.get('/attendance'); assert(/مهلت ویرایش این تاریخ به پایان رسیده است/.test(r.text), 'teacher blocked for 2-day-old date when window=0');
  await a.post('/system/settings/academic', { attendance_edit_days: '3' });

  // ---------- اثر تنظیمات: سررسید پیش‌فرض صورت‌حساب ----------
  await a.post('/system/settings/finance', { invoice_due_days: '45' });
  r = await a.get('/finance/invoices/new'); const dueJ = J.toJalali(J.addDays(J.todayISO(), 45));
  assert(r.status === 200 && en(r.text).includes(en(dueJ)), 'invoice form default due date = today + 45 (' + dueJ + ')');
  await a.post('/system/settings/finance', { invoice_due_days: '30' });

  // ---------- اثر تنظیمات: حداقل طول رمز در ایجاد کاربر ----------
  await a.post('/system/settings/users', { password_min_length: '8', force_password_change: '1' });
  const uname = 'stf' + Date.now().toString(36);
  r = await a.post('/users', { username: uname, name: 'کاربر آزمایشی', role: 'staff', status: 'active', password: '123456', must_change_password: '0' });
  r = await a.get('/users/new'); assert(/رمز عبور باید حداقل ۸ کاراکتر باشد/.test(r.text), 'user with 6-char password rejected when min=8');
  r = await a.get('/users?q=' + uname); assert(!new RegExp('>' + uname + '<').test(r.text), 'rejected user not created');
  r = await a.get('/users/new'); assert(/name="must_change_password"[^>]*value="1"[^>]*checked/.test(r.text), 'new-user form pre-checks «اجبار تغییر رمز» from setting');
  await a.post('/system/settings/users', { password_min_length: '6', force_password_change: '0' });
  r = await a.get('/users/new'); assert(!/name="must_change_password"[^>]*value="1"[^>]*checked/.test(r.text), 'pre-check off after restore');

  // ---------- سقف پیوست کاربران ----------
  await a.post('/system/settings/security', { upload_max_mb: '1' });
  const big = Buffer.alloc(1300 * 1024, 65);
  r = await multipart(s, '/tickets', { subject: 'پیوست بزرگ ' + Date.now(), message: 'x', department: 'staff', category: 'سایر', priority: 'normal' }, { field: 'file', data: big, name: 'big.pdf', type: 'application/pdf' });
  r = await s.get('/tickets/new'); assert(/حجم فایل بیش از حد مجاز است/.test(r.text), '1.3MB attachment rejected when upload_max_mb=1');
  await a.post('/system/settings/security', { upload_max_mb: '0' });
  r = await multipart(s, '/tickets', { subject: 'پیوست عادی ' + Date.now(), message: 'x', department: 'staff', category: 'سایر', priority: 'normal' }, { field: 'file', data: big, name: 'big.pdf', type: 'application/pdf' });
  assert(r.status === 302 && /\/tickets\/\d+/.test(r.location || ''), '1.3MB accepted again under the form default (5MB)');

  // ---------- همهٔ تنظیمات ----------
  r = await sa.get('/system/settings?tab=advanced');
  const total = Number(en((r.text.match(/id="advCount">([^<]+) کلید/) || [, '0'])[1]));
  assert(r.status === 200 && total >= 150 && /data-hay="/.test(r.text) && /export\.json/.test(r.text) && /importSettingsModal/.test(r.text), 'advanced tab lists all keys (' + total + ') with export/import');
  r = await sa.get('/system/settings?tab=advanced&q=disk_alert'); const visible = (r.text.match(/<tr data-hay="[^"]*" class="">/g) || []).length; assert(visible === 3, 'server-side search narrows to 3 rows (' + visible + ')');
  r = await sa.post('/system/settings/advanced/set', { key: 'dashboard_events_days', value: '۴۵', q: 'dashboard' }); assert(r.status === 302 && /tab=advanced&q=dashboard/.test(r.location || ''), 'set via advanced → redirect keeps query');
  r = await sa.get('/system/settings?tab=advanced&q=dashboard_events'); assert(/value="45"/.test(r.text) && /تغییریافته/.test(r.text) && /پیش‌فرض: 30/.test(r.text), 'value stored (Persian digits normalised), marked changed with default shown');
  r = await sa.post('/system/settings/advanced/set', { key: 'dashboard_events_days', value: 'abc' }); r = await sa.get('/system/settings?tab=advanced&q=dashboard_events'); assert(/مقدار باید عددی باشد/.test(r.text) && /value="45"/.test(r.text), 'non-numeric rejected for number type');
  r = await sa.post('/system/settings/advanced/set', { key: 'dashboard_events_days', reset: '1' }); r = await sa.get('/system/settings?tab=advanced&q=dashboard_events'); { const row = (r.text.match(/<tr data-hay="[^"]*dashboard_events_days[\s\S]*?<\/tr>/) || [''])[0]; assert(/value="30"/.test(row) && !/تغییریافته/.test(row) && /inputmode="numeric"/.test(row), 'reset restores default (row clean, numeric input)'); }
  r = await sa.post('/system/settings/advanced/set', { key: 'app_version', value: '9.9.9' }); r = await sa.get('/system/settings?tab=advanced'); assert(/این کلید قابل ویرایش نیست/.test(r.text), 'internal key not editable');
  r = await sa.post('/system/settings/advanced/set', { key: '../etc', value: 'x' }); r = await sa.get('/system/settings?tab=advanced'); assert(/این کلید قابل ویرایش نیست/.test(r.text), 'invalid key name rejected');
  r = await sa.post('/system/settings/advanced/set', { key: 'disk_alert_percent', value: '5' }); r = await sa.get('/system/settings?tab=advanced&q=disk_alert_percent'); assert(/value="50"/.test(r.text), 'clamping applied in advanced editor');
  r = await sa.post('/system/settings/advanced/set', { key: 'disk_alert_percent', reset: '1' });
  // محرمانه
  await sa.post('/system/settings/sms', { sms_api_key: 'SECRET-KEY-123' });
  r = await sa.get('/system/settings?tab=advanced&q=sms_api_key'); assert(/value="••••••"/.test(r.text) && !/SECRET-KEY-123/.test(r.text), 'secret masked in advanced list');
  r = await sa.post('/system/settings/advanced/set', { key: 'sms_api_key', value: '••••••' }); r = await sa.get('/system/settings?tab=sms'); assert(/SECRET-KEY-123/.test(r.text), 'submitting the mask does not overwrite the secret');
  // خروجی JSON
  r = await sa.get('/system/settings/export.json'); const exp = JSON.parse(r.text);
  assert(r.status === 200 && exp.settings && exp.settings.school_name && exp.settings.sms_api_key === undefined && exp.settings.cron_token === undefined && exp.settings.app_version === undefined && /attachment/.test(r.headers['content-disposition'] || ''), 'export JSON has settings, excludes secrets/internal');
  await sa.post('/system/settings/sms', { sms_api_key: '' });
  // ورودی JSON
  const tmp = path.join(ROOT, 'storage', 'tmp'); fs.mkdirSync(tmp, { recursive: true });
  const payload = JSON.stringify({ settings: { dashboard_events_days: '21', sms_api_key: 'HACK', app_version: '0.0.0', custom_module_key: 'x', school_name: exp.settings.school_name } });
  r = await multipart(sa, '/system/settings/import', {}, { field: 'file', data: Buffer.from(payload), name: 'settings.json', type: 'application/json' });
  r = await sa.get('/system/settings?tab=advanced&q=dashboard_events_days'); assert(/۲ تنظیم اعمال شد/.test(r.text) && /۳ مورد/.test(r.text) && /value="21"/.test(r.text), 'import applies known keys, skips secret/internal/unknown');
  r = await sa.get('/system/settings?tab=sms'); assert(!/HACK/.test(r.text), 'secret not imported');
  r = await multipart(sa, '/system/settings/import', { allow_unknown: '1' }, { field: 'file', data: Buffer.from(JSON.stringify({ custom_module_key: 'x' })), name: 'flat.json', type: 'application/json' });
  r = await sa.get('/system/settings?tab=advanced&q=custom_module_key'); assert(/custom_module_key/.test(r.text) && /value="x"/.test(r.text), 'flat JSON + allow_unknown imports custom key');
  r = await sa.post('/system/settings/advanced/set', { key: 'custom_module_key', reset: '1' }); r = await sa.post('/system/settings/advanced/set', { key: 'dashboard_events_days', reset: '1' });
  r = await multipart(sa, '/system/settings/import', {}, { field: 'file', data: Buffer.from('not json'), name: 'bad.json', type: 'application/json' }); r = await sa.get('/system/settings?tab=advanced'); assert(/فایل JSON معتبر نیست/.test(r.text), 'invalid JSON rejected');
  r = await sa.get('/system/activity?q=تنظیم'); assert(/ویرایش تنظیم «dashboard_events_days»/.test(r.text) && /ورود ۲ تنظیم|ورود 2 تنظیم/.test(r.text), 'activity log records advanced edits and import');
  // قابلیت خاموش
  await superPost('/system/modules/toggle', { key: 'system.advanced_settings', enabled: '0' });
  r = await sa.get('/system/settings?tab=advanced'); assert(!/id="advSearch"/.test(r.text), 'advanced tab hidden when feature disabled');
  r = await sa.get('/system/settings/export.json'); assert(r.status !== 200 || !/"settings"/.test(r.text), 'export blocked when disabled');
  await superPost('/system/modules/toggle', { key: 'system.advanced_settings', enabled: '1' });
  // دانش‌آموز
  r = await s.get('/system/settings/export.json'); assert(r.status === 403 || r.status === 302 || r.status === 404, 'student cannot export settings');
  console.log(process.exitCode ? 'flow-settings: FAILED' : 'flow-settings: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
