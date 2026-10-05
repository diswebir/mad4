'use strict';
/** جریان: بهبودهای تجربهٔ کاربری — زبانه‌های واقعی پروندهٔ دانش‌آموز، ویرایش سریع، جستجوی دانش‌آموز، افزودن دانش‌آموز موجود به کلاس */
const { Client, superPost } = require('./client');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 2; } else console.log('ok:', m); };
const en = (s) => String(s).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));

(async () => {
  const a = new Client(); let r = await a.login('admin', 'admin123'); assert(r.status === 302, 'admin login');
  for (const k of ['students.manage', 'students.parents', 'students.emergency', 'students.transfer', 'academic.class_subjects']) await superPost('/system/modules/toggle', { key: k, enabled: '1' });

  // ---------- زبانه‌های واقعی ----------
  r = await a.get('/students/1');
  assert(r.status === 200 && /id="studentTabs"/.test(r.text) && /data-bs-toggle="tab"/.test(r.text) && /id="pane-overview"[^>]*role="tabpanel"/.test(r.text) && /id="pane-info"/.test(r.text) && /id="pane-attendance"/.test(r.text), 'student page renders real tab panes');
  assert(/id="pane-overview" role="tabpanel"/.test(r.text) && /tab-pane fade show active" id="pane-overview"/.test(r.text), 'overview active by default');
  r = await a.get('/students/1?tab=docs'); assert(/tab-pane fade show active" id="pane-docs"/.test(r.text) && /nav-link text-nowrap active" href="\?tab=docs"/.test(r.text), '?tab=docs deep link still works');
  assert(/id="quickEditModal"/.test(r.text) && /ویرایش سریع/.test(r.text) && /data-focus="mobile"/.test(r.text) && /name="father_phone"/.test(r.text), 'quick edit modal with grouped fields and focus buttons');

  // ---------- ویرایش سریع ----------
  r = await a.get('/students/1'); const orig = { mobile: (/name="mobile"[^>]*value="([^"]*)"/.exec(r.text) || [, ''])[1], address: (/name="address"[^>]*>([^<]*)</.exec(r.text) || [, ''])[1] };
  const newMobile = '0912' + String(Math.floor(1000000 + Math.random() * 8999999));
  r = await a.post('/students/1/quick', { mobile: '۰۹۱۲' + newMobile.slice(4), address: 'تهران، خیابان آزمایش ' + newMobile.slice(-3), _tab: 'info' });
  assert(r.status === 302 && /\/students\/1\?tab=info$/.test(r.location || ''), 'quick save redirects back to info tab');
  r = await a.get('/students/1?tab=info'); assert(/ذخیره شد \(موبایل دانش‌آموز، نشانی منزل\)/.test(r.text) && en(r.text).includes(newMobile) && /خیابان آزمایش/.test(r.text), 'flash lists changed labels; new values shown');
  r = await a.get('/users?q=40001'); assert(en(r.text).includes(newMobile), 'user phone synced');
  r = await a.post('/students/1/quick', { mobile: '۰۹۱۲' + newMobile.slice(4) }); r = await a.get('/students/1'); assert(/تغییری ثبت نشد/.test(r.text), 'no-op save detected');
  r = await a.post('/students/1/quick', { national_id: '1234567890' }); r = await a.get('/students/1'); assert(/کد ملی معتبر نیست/.test(r.text), 'validation error shown (invalid national id)');
  r = await a.post('/students/1/quick', { first_name: '' }); r = await a.get('/students/1'); assert(/نام الزامی است/.test(r.text), 'required check');
  r = await a.post('/students/1/quick', { status: 'inactive', class_id: '2' }); r = await a.get('/students/1'); assert(/فیلدی برای ذخیره ارسال نشد/.test(r.text) && !/غیرفعال<\/span>/.test((r.text.match(/statusModal[\s\S]{0,200}/) || [''])[0]), 'non-whitelisted fields ignored');
  r = await a.post('/students/1/quick', { mobile: orig.mobile, address: orig.address }); assert(r.status === 302, 'restored original values');
  // معلم: دکمهٔ ویرایش سریع ندارد
  const t = new Client(); await t.login('teacher1', '123456');
  r = await t.get('/students/1'); assert(r.status === 200 && !/id="quickEditModal"/.test(r.text) && /id="studentTabs"/.test(r.text), 'teacher sees tabs but no quick edit');
  r = await t.post('/students/1/quick', { mobile: '09120000000' }); assert(r.status === 403, 'teacher cannot quick-edit');

  // ---------- جستجوی دانش‌آموز ----------
  r = await a.get('/students/api/search?q=' + encodeURIComponent('سارا')); let list = r.json();
  assert(r.status === 200 && Array.isArray(list) && list.some((x) => x.id === 1 && /سارا/.test(x.name) && x.student_number === '40001'), 'api search by name');
  r = await a.get('/students/api/search?q=۴۰۰۰۱'); list = r.json(); assert(list.length >= 1 && list[0].id === 1, 'api search by persian-digit number');
  r = await a.get('/students/api/search?q=&exclude_class=1&limit=10'); list = r.json(); assert(list.length === 10 && !list.some((x) => x.class_id === 1), 'exclude_class + limit');
  r = await t.get('/students/api/search?q=40001'); assert(r.status === 200, 'teacher may search');
  const st = new Client(); await st.login('40001', '123456'); r = await st.get('/students/api/search?q=a'); assert(r.status === 403, 'student forbidden');

  // ---------- افزودن دانش‌آموز موجود به کلاس ----------
  r = await a.get('/academic/classes/1'); assert(/id="addStudentsModal"/.test(r.text) && /افزودن دانش‌آموز موجود/.test(r.text) && /students\/api\/search\?exclude_class=1/.test(r.text), 'class page has add-students modal');
  // دانش‌آموز بدون کلاس می‌سازیم
  const tag = String(Math.floor(Math.random() * 1e6));
  r = await a.post('/students', { first_name: 'نوید', last_name: 'آزمایشی' + tag, gender: 'male', status: 'active', student_number: '77' + tag.padStart(6, '0') });
  assert(r.status === 302 && /\/students\/\d+$/.test(r.location || ''), 'student without class created');
  const sid = Number((r.location || '').split('/').pop());
  r = await a.get('/students/api/search?no_class=1&q=' + encodeURIComponent('آزمایشی' + tag)); list = r.json(); assert(list.length === 1 && list[0].id === sid && !list[0].class_id, 'no_class filter finds the new student');
  r = await a.post('/academic/classes/1/students', { student_ids: `${sid},2`, ignore_capacity: '1' }); assert(r.status === 302 && /\/academic\/classes\/1$/.test(r.location || ''), 'add posted');
  r = await a.get('/academic/classes/1'); assert(/۱ دانش‌آموز به کلاس افزوده شد/.test(r.text) && /۱ مورد رد شد/.test(r.text) && /قبلاً در این کلاس/.test(r.text) && r.text.includes('آزمایشی' + tag), 'one added, one skipped (already in class); student listed');
  r = await a.get(`/students/${sid}?tab=history`); assert(/هفتم الف/.test(r.text) && /تعیین کلاس/.test(r.text), 'transfer history records class assignment');
  // ظرفیت
  r = await a.post('/academic/classes/1/students', { student_ids: '3' }); r = await a.get('/academic/classes/1');
  const capMsg = /ظرفیت کلاس/.test(r.text) || /دانش‌آموز به کلاس افزوده شد/.test(r.text); assert(capMsg, 'capacity check or add (depending on class capacity) handled');
  if (/ظرفیت کلاس/.test(r.text)) { assert(!/۱ دانش‌آموز به کلاس افزوده شد/.test(r.text), 'blocked by capacity without ignore flag'); }
  else { r = await a.post('/students/3/transfer', { class_id: '2', reason: 'بازگشت' }); }
  r = await a.post('/academic/classes/1/students', { student_ids: '' }); r = await a.get('/academic/classes/1'); assert(/دانش‌آموزی انتخاب نشده است/.test(r.text), 'empty selection rejected');
  r = await t.post('/academic/classes/1/students', { student_ids: '5' }); assert(r.status === 403, 'teacher cannot add students');
  // ---------- تخصیص درس از صفحهٔ معلم ----------
  r = await a.get('/academic/classes/1'); const m = /data-subject="(\d+)" data-teacher="(\d+)" data-hours="(\d+)"/.exec(r.text);
  r = await a.get('/teachers/' + m[2]); assert(r.status === 200 && /id="assignModal"/.test(r.text) && /تخصیص درس جدید/.test(r.text) && /name="back" value="\/teachers\//.test(r.text), 'teacher page has assign modal');
  r = await a.post('/academic/classes/1/subjects', { subject_id: m[1], teacher_id: m[2], weekly_hours: m[3], back: '/teachers/' + m[2] }); assert(r.status === 302 && (r.location || '') === '/teachers/' + m[2], 'assign redirects back to teacher page');
  r = await a.post('/academic/classes/1/subjects', { subject_id: m[1], teacher_id: m[2], weekly_hours: m[3], back: 'https://evil.example' }); assert(r.status === 302 && /\/academic\/classes\/1/.test(r.location || ''), 'open redirect blocked');
  r = await t.get('/teachers/' + m[2]); assert(!/id="assignModal"/.test(r.text) || r.status !== 200, 'teacher does not get assign modal');
  // انتخاب‌گر جستجوپذیر در اسکریپت عمومی
  r = await new Client().get('/assets/js/app.js'); assert(r.status === 200 && /enhanceSelects/.test(r.text) && /ssel-search/.test(r.text), 'searchable select shipped in app.js');

  // پاک‌سازی
  r = await a.post(`/students/${sid}/delete`, {}); assert(r.status === 302, 'test student removed');
  console.log(process.exitCode ? 'flow-ux: FAILED' : 'flow-ux: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
