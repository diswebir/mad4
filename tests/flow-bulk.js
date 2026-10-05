'use strict';
/** جریان عملیات گروهی دانش‌آموزان: انتخاب، انتقال، تغییر وضعیت، اعلان، پیامک، CSV، کارت، بازنشانی رمز، «همهٔ نتایج فیلتر»، دسترسی و غیرفعال‌سازی */
const { Client, superPost, superClient } = require('./client');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 2; } else console.log('ok:', m); };
const fa = '۰۱۲۳۴۵۶۷۸۹';
const en = (s) => String(s).replace(/[۰-۹]/g, (d) => fa.indexOf(d));
const pd = (s) => String(s).replace(/\d/g, (d) => fa[d]);
const strip = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const enrollTable = (html) => { const i = html.indexOf('سوابق تحصیلی (سال به سال)'); if (i < 0) return ''; return strip(html.slice(i, html.indexOf('</table>', i))); };
(async () => {
  const a = new Client(); let r = await a.login('admin', 'admin123'); assert(r.status === 302, 'admin login');
  const sa = await superClient();
  const t = new Client(); r = await t.login('teacher1', '123456'); assert(r.status === 302, 'teacher login');
  for (const key of ['students.bulk', 'students.transfer', 'students.status', 'students.export', 'students.id_card', 'students.user_account', 'notifications.inapp', 'notifications.sms', 'enrollments']) { r = await superPost('/system/modules/toggle', { key, enabled: '1' }); }

  // --- نمایش ---
  r = await a.get('/students'); assert(r.status === 200 && /id="bulkForm"/.test(r.text) && (r.text.match(/class="form-check-input bulk-cb"/g) || []).length >= 10, 'admin list has bulk checkboxes + bar');
  assert(/value="transfer"/.test(r.text) && /value="reset_password"/.test(r.text) && /value="cards"/.test(r.text), 'bulk actions listed');
  r = await t.get('/students'); assert(r.status === 200 && !/id="bulkForm"/.test(r.text), 'teacher list has no bulk bar');

  // کلاس‌ها و دانش‌آموزان آزمایشی (کلاس آخر، تا با تست‌های دیگر تداخل نکند)
  r = await a.get('/academic/api/classes'); const classes = r.json(); assert(classes.length >= 3, 'classes api');
  const src = classes[classes.length - 1], dst = classes[classes.length - 2];
  r = await a.get('/academic/promote/students/' + src.id); const list = r.json(); assert(list.length >= 4, 'source class students: ' + list.length);
  const A = list[list.length - 1], B = list[list.length - 2];

  // --- بدون انتخاب / عملیات نامعتبر ---
  r = await a.post('/students/bulk', { action: 'transfer', class_id: String(dst.id) }); assert(r.status === 302, 'no ids → redirect');
  r = await a.get('/students'); assert(/هیچ دانش‌آموزی انتخاب نشده/.test(strip(r.text)), 'flash: nothing selected');
  r = await a.post('/students/bulk', { action: 'hack', ids: [String(A.id)] }); r = await a.get('/students'); assert(/عملیات نامعتبر/.test(strip(r.text)), 'invalid action rejected');

  // --- انتقال گروهی ---
  r = await a.post('/students/bulk', { action: 'transfer', ids: [String(A.id), String(B.id)], class_id: String(dst.id), note: 'انتقال گروهی تست', filter_qs: 'class_id=' + src.id });
  assert(r.status === 302 && /class_id=/.test(r.location || ''), 'bulk transfer redirects back to filtered list');
  r = await a.get(r.location); assert(new RegExp('۲ دانش‌آموز به کلاس «' + dst.title + '» منتقل شدند').test(strip(r.text)), 'flash: 2 transferred');
  r = await a.get('/students/' + A.id); assert(strip(r.text).includes(dst.title), 'student A now in destination class');
  r = await a.get('/students/' + A.id + '?tab=enrollments'); assert(enrollTable(r.text).includes(dst.title) && /در حال تحصیل/.test(enrollTable(r.text)), 'enrollment row updated');
  r = await a.get('/students/' + A.id + '?tab=history'); assert(/انتقال گروهی تست/.test(strip(r.text)), 'transfer history has the note');
  r = await a.post('/students/bulk', { action: 'transfer', ids: [String(A.id), String(B.id)], class_id: String(dst.id) }); r = await a.get('/students'); assert(/۰ دانش‌آموز به کلاس/.test(strip(r.text)) && /۲ نفر از قبل در این کلاس بودند/.test(strip(r.text)), 're-transfer skips students already there');
  r = await a.post('/students/bulk', { action: 'transfer', ids: [String(A.id), String(B.id)], class_id: String(src.id), note: 'بازگشت' }); assert(r.status === 302, 'moved back');
  r = await a.get('/academic/promote/students/' + src.id); assert(r.json().some((s) => s.id === A.id) && r.json().some((s) => s.id === B.id), 'both back in source class');

  // --- تغییر وضعیت گروهی ---
  r = await a.post('/students/bulk', { action: 'status', ids: [String(A.id)], status: 'suspended', note: 'تعلیق آزمایشی' }); assert(r.status === 302, 'bulk status → suspended');
  r = await a.get('/students/' + A.id + '?tab=enrollments'); assert(/تعلیق/.test(strip(r.text).split('مشخصات')[0] || strip(r.text)), 'student A suspended');
  const sA = new Client(); r = await sA.login(A.student_number, '123456'); assert(r.status !== 302 || /auth/.test(r.location || ''), 'suspended student cannot log in (' + r.status + ')');
  r = await a.post('/students/bulk', { action: 'status', ids: [String(A.id)], status: 'active' }); r = await a.get('/students'); assert(/وضعیت ۱ دانش‌آموز به «فعال» تغییر کرد/.test(strip(r.text)), 'bulk status → active');
  r = await a.get('/students/' + A.id + '?tab=enrollments'); assert(/در حال تحصیل/.test(enrollTable(r.text)), 'enrollment active again');

  // --- اعلان گروهی ---
  const title = 'اعلان گروهی ' + Date.now().toString().slice(-5);
  r = await a.post('/students/bulk', { action: 'notify', ids: [String(A.id), String(B.id)], title, message: 'متن اعلان گروهی', to_parents: '1' }); r = await a.get('/students'); assert(/اعلان برای [۰-۹]+ کاربر ارسال شد/.test(strip(r.text)), 'bulk notify flash');
  const sB = new Client(); r = await sB.login(B.student_number, '123456'); assert(r.status === 302, 'student B login');
  if (/auth\/password/.test(r.location || '')) { await sB.get('/auth/password?force=1'); await sB.post('/auth/password', { current: '123456', password: '123456', password2: '123456' }); }
  r = await sB.get('/notifications'); assert(strip(r.text).includes(title), 'student B received the notification');
  r = await a.post('/students/bulk', { action: 'notify', ids: [String(A.id)], title: '', message: 'x' }); r = await a.get('/students'); assert(/عنوان اعلان الزامی/.test(strip(r.text)), 'notify requires title');

  // --- پیامک گروهی به اولیا (درگاه log) ---
  r = await sa.post('/system/settings/sms', { sms_enabled: '1', sms_provider: 'log', sms_sender: '1000' }); assert(r.status === 302, 'sms log provider on');
  const smsText = 'پیامک گروهی تست ' + Date.now().toString().slice(-4);
  r = await a.post('/students/bulk', { action: 'sms', ids: [String(A.id), String(B.id)], message: smsText }); r = await a.get('/students'); assert(/پیامک برای [۰-۹]+ شماره ارسال شد/.test(strip(r.text)), 'bulk sms flash');
  r = await a.get('/system/sms-log?q=' + encodeURIComponent('گروهی تست')); assert(r.status === 200 && strip(r.text).includes(smsText.replace(/\d/g, (d) => fa[d])) || strip(r.text).includes(smsText), 'sms log has the message');
  r = await sa.post('/system/settings/sms', { sms_enabled: '0' });
  r = await a.post('/students/bulk', { action: 'sms', ids: [String(A.id)], message: 'x' }); r = await a.get('/students'); assert(/ارسال پیامک در تنظیمات فعال نیست/.test(strip(r.text)), 'sms disabled → clear error');
  r = await sa.post('/system/settings/sms', { sms_enabled: '1' });

  // --- CSV منتخب و همهٔ نتایج فیلتر ---
  r = await a.post('/students/bulk', { action: 'export', ids: [String(A.id), String(B.id)] }); assert(r.status === 200 && r.text.includes(A.student_number) && r.text.includes(B.student_number) && r.text.trim().split('\n').length === 3, 'CSV of 2 selected');
  r = await a.post('/students/bulk', { action: 'export', select_all: '1', filter_qs: 'class_id=' + src.id }); assert(r.status === 200 && r.text.trim().split('\n').length === list.length + 1, 'select_all + filter → CSV of whole class (' + list.length + ')');
  r = await a.post('/students/bulk', { action: 'export', select_all: '1', filter_qs: 'class_id=' + src.id + '&gender=male' }); const males = r.text.trim().split('\n').length - 1; assert(r.status === 200 && males >= 0 && males <= list.length, 'select_all respects extra filters (' + males + ' males)');

  // --- کارت‌ها ---
  r = await a.post('/students/bulk', { action: 'cards', ids: [String(A.id), String(B.id)] }); assert(r.status === 200 && strip(r.text).includes(A.last_name) && strip(r.text).includes(B.last_name) && /کارت/.test(r.text), 'cards print page for selected');

  // --- دسترسی ---
  r = await t.post('/students/bulk', { action: 'export', ids: [String(A.id)] }); assert(r.status === 403, 'teacher cannot run bulk');
  r = await sB.post('/students/bulk', { action: 'export', ids: [String(A.id)] }); assert(r.status === 403, 'student cannot run bulk');

  // --- بازنشانی رمز ---
  r = await a.post('/students/bulk', { action: 'reset_password', ids: [String(B.id)], pw_mode: 'custom', password: '123' }); r = await a.get('/students'); assert(/حداقل ۶ کاراکتر/.test(strip(r.text)), 'short custom password rejected');
  r = await a.post('/students/bulk', { action: 'reset_password', ids: [String(B.id)], pw_mode: 'custom', password: 'bulkpass1' }); r = await a.get('/students'); assert(/رمز عبور ۱ دانش‌آموز بازنشانی شد/.test(strip(r.text)), 'bulk password reset flash');
  const sB2 = new Client(); r = await sB2.login(B.student_number, 'bulkpass1'); assert(r.status === 302, 'student B logs in with new password');
  // بازگرداندن رمز و پاک‌کردن اجبار تغییر (از طریق فرم تغییر رمز)
  r = await sB2.get('/auth/password?force=1'); assert(r.status === 200 && /تغییر رمز عبور/.test(r.text), 'forced password-change page renders (no redirect loop)');
  r = await sB2.get('/dashboard'); assert(r.status === 302 && /\/auth\/password\?force=1/.test(r.location || ''), 'other pages redirect to forced change');
  r = await sB2.post('/auth/password', { current: 'bulkpass1', password: '123456', password2: '123456' }); assert(r.status === 302 && /dashboard/.test(r.location || ''), 'student B restored password');
  r = await sB2.get('/dashboard'); assert(r.status === 200, 'student B dashboard after change');
  r = await a.post('/students/bulk', { action: 'reset_password', ids: [String(A.id)], pw_mode: 'student_number' }); r = await a.get('/students'); assert(/شماره دانش‌آموزی/.test(strip(r.text)), 'reset to student number');
  const sA2 = new Client(); r = await sA2.login(A.student_number, A.student_number); assert(r.status === 302, 'student A logs in with student number');
  r = await sA2.post('/auth/password', { current: A.student_number, password: '123456', password2: '123456' }); assert(r.status === 302, 'student A restored password');

  // --- غیرفعال‌سازی ---
  r = await superPost('/system/modules/toggle', { key: 'students.bulk', enabled: '0' });
  r = await a.get('/students'); assert(r.status === 200 && !/id="bulkForm"/.test(r.text), 'feature off: no bulk UI');
  r = await a.post('/students/bulk', { action: 'export', ids: [String(A.id)] }); assert(r.status === 404, 'feature off: route disabled');
  r = await superPost('/system/modules/toggle', { key: 'students.bulk', enabled: '1' });
  console.log('done');
})().catch((e) => { console.error(e); process.exitCode = 2; });
