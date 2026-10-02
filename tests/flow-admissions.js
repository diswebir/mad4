'use strict';
/** جریان پیش‌ثبت‌نام: فرم عمومی، اعتبارسنجی، کد رهگیری، پیگیری، بررسی/پذیرش توسط مدیر، ثبت‌نام قطعی و ساخت پرونده، بستن ثبت‌نام و محدودیت پایه‌ها، دسترسی نقش‌ها */
const { Client } = require('./client');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 2; } else console.log('ok:', m); };
const fa = '۰۱۲۳۴۵۶۷۸۹';
const en = (s) => String(s).replace(/[۰-۹]/g, (d) => fa.indexOf(d));
const captchaOf = (html) => { const cm = /<strong class="text-brand">([^<]*)<\/strong>/.exec(html); const nums = en(cm ? cm[1] : '').match(/\d+/g) || [0, 0]; return String(Number(nums[0]) + Number(nums[1])); };
const validNid = () => { const d = []; for (let i = 0; i < 9; i++) d.push(Math.floor(Math.random() * 10)); let s = 0; for (let i = 0; i < 9; i++) s += d[i] * (10 - i); const r = s % 11; d.push(r < 2 ? r : 11 - r); return d.join(''); };
const stamp = Date.now().toString().slice(-5);
(async () => {
  const a = new Client(); let r = await a.login('admin', 'admin123'); assert(r.status === 302, 'admin login');
  const t = new Client(); r = await t.login('teacher1', '123456'); assert(r.status === 302, 'teacher login');
  const s = new Client(); r = await s.login('40001', '123456'); assert(r.status === 302, 'student login');
  for (const key of ['admissions', 'admissions.public_form', 'admissions.tracking', 'admissions.review', 'admissions.enroll', 'admissions.export', 'admissions.login_link']) { r = await a.post('/system/modules/toggle', { key, enabled: '1' }); }
  r = await a.post('/system/settings/admissions', { admissions_open: '1', admissions_year: '', admissions_text: 'متن راهنمای تست', admissions_docs: 'شناسنامه و کارنامه' }); assert(r.status === 302, 'open admissions via settings');

  // --- عمومی ---
  const g = new Client();
  r = await g.get('/apply'); assert(r.status === 302 && /\/admissions\/apply$/.test(r.location || ''), 'short url /apply redirects');
  r = await g.get('/admissions/apply'); assert(r.status === 200 && /name="national_id"/.test(r.text) && /متن راهنمای تست/.test(r.text) && /شناسنامه و کارنامه/.test(r.text), 'public apply form (no login) with intro + docs');
  assert(!/sidebar|داشبورد/.test(r.text) && /ورود به سامانه/.test(r.text), 'public layout (no app chrome)');
  const gradeIds = [...r.text.matchAll(/name="grade_level_id"[\s\S]*?<\/select>/g)][0][0].match(/value="(\d+)"/g).map((x) => x.match(/\d+/)[0]);
  assert(gradeIds.length >= 2, 'grade options listed: ' + gradeIds.join(','));
  r = await g.get('/auth/login'); assert(/href="\/apply"/.test(r.text) && /پیش‌ثبت‌نام آنلاین/.test(r.text), 'login page shows apply link when open');

  // اعتبارسنجی
  r = await g.get('/admissions/apply');
  r = await g.post('/admissions/apply', { first_name: 'تست', last_name: 'پذیرش', national_id: '0012345678', birth_date: '1392/03/10', gender: 'male', grade_level_id: gradeIds[0], father_name: 'پدر تست', father_phone: '0912', captcha: '0', accept: '1' });
  assert(r.status === 422 && /کد ملی دانش‌آموز نامعتبر/.test(r.text) && /موبایل پدر/.test(r.text) && /سؤال امنیتی/.test(r.text), 'validation errors (nid, mobile, captcha) → 422');
  assert(/value="تست"/.test(r.text) && /value="پدر تست"/.test(r.text), 'form keeps entered values');

  // ثبت موفق
  const nid = validNid();
  r = await g.post('/admissions/apply', { first_name: 'آرش', last_name: 'تستی' + stamp, national_id: nid, birth_date: '۱۳۹۲/۰۳/۱۰', birth_place: 'تهران', gender: 'male', grade_level_id: gradeIds[0], previous_school: 'دبستان تست', previous_average: '۱۸.۵', father_name: 'بهرام تستی', father_phone: '۰۹۱۲۱۲۳۴۵۶۷', father_job: 'کارمند', father_education: 'bachelor', mother_name: 'مینا', mother_phone: '09351234567', address: 'تهران، خیابان تست', postal_code: '1234567890', email: 'parent@example.com', notes: 'یادداشت', captcha: captchaOf(r.text), accept: '1' });
  assert(r.status === 302 && /\/admissions\/apply\/done\?code=AP-/.test(r.location || ''), 'apply submitted → done page: ' + r.location);
  const code = decodeURIComponent((r.location.match(/code=([^&]+)/) || [])[1] || '');
  assert(/^AP-\d{4}-\d{5}$/.test(code), 'tracking code format AP-سال-شماره: ' + code);
  r = await g.get('/admissions/apply/done?code=' + code); assert(r.status === 200 && r.text.includes(code) && /شناسنامه و کارنامه/.test(r.text), 'done page shows code + docs');

  // پیگیری
  r = await g.get('/admissions/track?code=' + code + '&national_id=' + nid); assert(r.status === 200 && /در انتظار بررسی/.test(r.text) && /آرش/.test(r.text), 'track: pending');
  r = await g.get('/apply/track?code=' + code + '&national_id=' + nid); assert(r.status === 302 && r.location.includes('/admissions/track?code=' + code), 'short url /apply/track keeps query');
  r = await g.get('/admissions/track?code=' + code + '&national_id=1111111111'); assert(r.status === 200 && /یافت نشد/.test(r.text) && !/آرش/.test(r.text), 'track: wrong national id → not found');
  r = await g.get('/admissions/track?code=' + code.toLowerCase() + '&national_id=' + en(nid)); assert(/در انتظار بررسی/.test(r.text), 'track: lowercase code accepted');

  // تکراری
  r = await g.get('/admissions/apply');
  r = await g.post('/admissions/apply', { first_name: 'آرش', last_name: 'تکراری', national_id: nid, birth_date: '1392/03/10', gender: 'male', grade_level_id: gradeIds[0], father_name: 'بهرام', father_phone: '09121234567', captcha: captchaOf(r.text), accept: '1' });
  assert(r.status === 422 && r.text.includes(code), 'duplicate national id rejected with existing code');
  r = await g.get('/admissions/apply');
  r = await g.post('/admissions/apply', { first_name: 'علی', last_name: 'موجود', national_id: '', birth_date: '1392/03/10', gender: 'male', grade_level_id: gradeIds[0], father_name: 'بهرام', father_phone: '09121234567', captcha: captchaOf(r.text), accept: '1' });
  assert(r.status === 422 && /کد ملی دانش‌آموز نامعتبر/.test(r.text), 'empty national id rejected');

  // --- دسترسی ---
  r = await t.get('/admissions'); assert(r.status === 403, 'teacher cannot access admissions admin (403)');
  r = await s.get('/admissions'); assert(r.status === 403, 'student cannot access admissions admin (403)');
  r = await g.get('/admissions'); assert(r.status === 302 && /\/auth\/login/.test(r.location || ''), 'guest redirected to login for admin list');

  // --- مدیریت ---
  r = await a.get('/admissions'); assert(r.status === 200 && r.text.includes(code) && /پذیرفته‌شده/.test(r.text), 'admin list shows new application + status cards');
  r = await a.get('/admissions?q=' + encodeURIComponent('تستی' + stamp)); assert(r.text.includes(code) && !/AP-\d{4}-00001</.test(r.text), 'search by last name filters');
  r = await a.get('/admissions?status=pending&q=' + code); assert(r.text.includes(code), 'filter by status+code');
  r = await a.get('/admissions?status=rejected&q=' + code); assert(!r.text.includes('>' + code + '<'), 'status filter excludes');
  const appId = (r.text.match(new RegExp('/admissions/(\\d+)"[^>]*>' + code)) || (await a.get('/admissions?q=' + code)).text.match(new RegExp('/admissions/(\\d+)"[^>]*>' + code)) || [])[1];
  assert(appId, 'application id resolved: ' + appId);
  r = await a.get('/admissions/' + appId); assert(r.status === 200 && /بهرام تستی/.test(r.text) && /دبستان تست/.test(r.text) && /۱۸\.۵/.test(r.text) && /09121234567/.test(r.text), 'detail page shows parent/school/average/phone');
  assert(/name="review_note"/.test(r.text) && /\/enroll"/.test(r.text) && /disabled/.test(r.text), 'detail has review form + enroll form (disabled until accepted)');
  r = await a.get('/admissions/export.csv?q=' + code); assert(r.status === 200 && r.text.includes(code) && /کد رهگیری/.test(r.text), 'CSV export filtered');

  // تلاش ثبت‌نام قبل از پذیرش
  r = await a.post('/admissions/' + appId + '/enroll', { class_id: '1' }); assert(r.status === 302, 'enroll before accept redirects');
  r = await a.get('/admissions/' + appId); assert(/فقط درخواست‌های «پذیرفته‌شده»/.test(r.text), 'enroll before accept → error flash');
  // بررسی: نیازمند مدارک با پیام
  r = await a.post('/admissions/' + appId + '/status', { status: 'docs_requested', review_note: 'کارنامهٔ سال قبل ارسال شود', notify: '1' }); assert(r.status === 302, 'status → docs_requested');
  r = await g.get('/admissions/track?code=' + code + '&national_id=' + nid); assert(/نیازمند مدارک/.test(r.text) && /کارنامهٔ سال قبل ارسال شود/.test(r.text), 'track shows docs_requested + public note');
  r = await a.post('/admissions/' + appId + '/status', { status: 'bogus' }); r = await a.get('/admissions/' + appId); assert(/وضعیت نامعتبر/.test(r.text) && /نیازمند مدارک/.test(r.text), 'invalid status rejected');
  r = await a.post('/admissions/' + appId + '/status', { status: 'enrolled' }); r = await a.get('/admissions/' + appId); assert(/وضعیت نامعتبر/.test(r.text), 'enrolled cannot be set via status form');
  // پذیرش
  r = await a.post('/admissions/' + appId + '/status', { status: 'accepted', review_note: 'با مدارک مراجعه کنید' }); assert(r.status === 302, 'status → accepted');
  r = await a.get('/admissions/' + appId); assert(/پذیرفته‌شده/.test(r.text) && !/name="class_id" disabled/.test(r.text), 'enroll form enabled after accept');
  const classId = (r.text.match(/name="class_id"[\s\S]*?<option value="(\d+)"/) || [])[1]; assert(classId, 'class option available for grade: ' + classId);
  r = await a.get('/admissions?status=accepted'); assert(r.text.includes(code), 'list filter accepted includes it');
  // ثبت‌نام قطعی
  r = await a.post('/admissions/' + appId + '/enroll', { class_id: classId, password: 'secret123' }); assert(r.status === 302 && /\/students\/\d+$/.test(r.location || ''), 'enroll → student profile: ' + r.location);
  const sid = (r.location.match(/\/students\/(\d+)/) || [])[1];
  r = await a.get('/students/' + sid); assert(r.status === 200 && /آرش/.test(r.text) && /بهرام تستی/.test(r.text) && /شمارهٔ دانش‌آموزی|شماره دانش‌آموزی/.test(r.text) && /secret123/.test(r.text), 'student profile created with parent info + credentials flash');
  const sn = (r.text.match(/<code class="ltr">(\d+)<\/code>/) || [])[1]; assert(sn, 'student number assigned: ' + sn);
  const n = new Client(); r = await n.login(sn, 'secret123'); assert(r.status === 302 && !/auth\/login/.test(r.location || ''), 'new student can log in with chosen password');
  r = await n.get('/students/me'); if (r.status === 302) r = await n.get(r.location.replace(/^https?:\/\/[^/]+/, '')); assert(r.status === 200 && /آرش/.test(r.text), 'new student sees own profile');
  r = await a.get('/admissions/' + appId); assert(/ثبت‌نام قطعی شده/.test(r.text) && new RegExp('/students/' + sid).test(r.text), 'application marked enrolled with link to student');
  r = await g.get('/admissions/track?code=' + code + '&national_id=' + nid); assert(/ثبت‌نام قطعی/.test(r.text), 'track: enrolled');
  r = await a.post('/admissions/' + appId + '/status', { status: 'rejected' }); r = await a.get('/admissions/' + appId); assert(/قابل تغییر نیست/.test(r.text) && /ثبت‌نام قطعی شده/.test(r.text), 'enrolled application is immutable');
  r = await a.post('/admissions/' + appId + '/enroll', { class_id: classId }); r = await a.get('/admissions/' + appId); assert(/قبلاً ثبت‌نام قطعی/.test(r.text), 'double enroll prevented');
  r = await a.post('/admissions/' + appId + '/delete', {}); r = await a.get('/admissions/' + appId); assert(r.status === 200 && /قابل حذف نیست/.test(r.text), 'enrolled application cannot be deleted');
  r = await a.get('/admissions/apply'); r = await g.get('/admissions/apply');
  r = await g.post('/admissions/apply', { first_name: 'آرش', last_name: 'دوباره', national_id: nid, birth_date: '1392/03/10', gender: 'male', grade_level_id: gradeIds[0], father_name: 'بهرام', father_phone: '09121234567', captcha: captchaOf(r.text), accept: '1' });
  assert(r.status === 422 && /هم‌اکنون در این مدرسه ثبت‌نام شده/.test(r.text), 'existing student national id rejected on apply');

  // --- بستن ثبت‌نام و محدودکردن پایه‌ها ---
  r = await a.post('/system/settings/admissions', { admissions_open: '0', admissions_year: '', admissions_text: '', admissions_docs: 'شناسنامه' });
  r = await g.get('/admissions/apply'); assert(r.status === 403 && /فعال نیست/.test(r.text), 'closed admissions → 403 page');
  r = await g.get('/auth/login'); assert(!/پیش‌ثبت‌نام آنلاین/.test(r.text), 'login link hidden when closed');
  r = await g.get('/admissions/track?code=' + code + '&national_id=' + nid); assert(r.status === 200 && /ثبت‌نام قطعی/.test(r.text), 'tracking still works when closed');
  r = await a.get('/admissions'); assert(/ثبت‌نام بسته است/.test(r.text), 'admin list warns closed');
  r = await a.post('/system/settings/admissions', { admissions_open: '1', admissions_year: '', admissions_text: '', admissions_docs: 'شناسنامه', admissions_grades: gradeIds[1] });
  r = await g.get('/admissions/apply'); const opts = (r.text.match(/name="grade_level_id"[\s\S]*?<\/select>/) || [''])[0]; assert(r.status === 200 && opts.includes('value="' + gradeIds[1] + '"') && !opts.includes('value="' + gradeIds[0] + '"'), 'only allowed grades offered');
  r = await g.post('/admissions/apply', { first_name: 'سارا', last_name: 'پایه', national_id: validNid(), birth_date: '1392/03/10', gender: 'female', grade_level_id: gradeIds[0], father_name: 'پدر', father_phone: '09121234567', captcha: captchaOf(r.text), accept: '1' });
  assert(r.status === 422 && /پایهٔ درخواستی نامعتبر/.test(r.text), 'disallowed grade rejected');
  r = await a.post('/system/settings/admissions', { admissions_open: '1', admissions_year: '', admissions_text: '', admissions_docs: 'شناسنامه، کارت ملی، کارنامهٔ سال قبل، عکس ۳×۴' });
  r = await a.get('/system/settings?tab=admissions'); assert(r.status === 200 && /name="admissions_open"[^>]*checked/.test(r.text) && /name="admissions_grades"/.test(r.text), 'settings tab renders with state');

  // غیرفعال‌کردن ویژگی پیگیری
  r = await a.post('/system/modules/toggle', { key: 'admissions.tracking', enabled: '0' });
  r = await g.get('/admissions/track?code=' + code + '&national_id=' + nid); assert(r.status === 404 || r.status === 403, 'tracking disabled → blocked (' + r.status + ')');
  r = await g.get('/admissions/apply'); assert(r.status === 200 && !/\/admissions\/track/.test(r.text), 'apply page hides tracking link when feature off');
  r = await a.post('/system/modules/toggle', { key: 'admissions.tracking', enabled: '1' });

  // پاک‌سازی: حذف دانش‌آموز تستی (درخواست به‌صورت enrolled باقی می‌ماند و حذف نمی‌شود → حذف از طریق تغییر وضعیت ممکن نیست؛ پس فقط دانش‌آموز حذف می‌شود)
  r = await a.post('/students/' + sid + '/delete', {}); assert(r.status === 302, 'cleanup: test student deleted');
  console.log(process.exitCode ? 'SOME FAILED' : 'ALL PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
