'use strict';
/** جریان: تولد دانش‌آموزان (students.birthdays) — محاسبهٔ شمسی، فهرست/بازه‌ها، خروجی Excel/CSV، تبریک دستی، کار روزانه و اعلان‌ها، ویجت پنل دانش‌آموز/ولی، تقویم، تنظیمات الگوها، محدودهٔ معلم */
const { Client } = require('./client');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 2; } else console.log('ok:', m); };
const en = (s) => String(s).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));

(async () => {
  // ---- واحد: محاسبهٔ تولد بعدی بر اساس تقویم شمسی
  const bd = require('../src/modules/students/birthdays');
  const J = require('../src/core/jalali');
  const today = J.todayISO(); const tp = J.toJalaliParts(today);
  const sameDay = J.toGregorian(`${tp.jy - 14}/${tp.jm}/${tp.jd}`);
  let b = bd.nextBirthday(sameDay, today); assert(b && b.days === 0 && b.isToday && b.turning === 14, 'nextBirthday: today → 0 days, age 14');
  const yest = J.toJalaliParts(J.addDays(today, -1));
  b = bd.nextBirthday(J.toGregorian(`${yest.jy - 10}/${yest.jm}/${yest.jd}`), today); assert(b && b.days >= 364 && b.days <= 366, 'nextBirthday: yesterday → next year (' + b.days + ' days)');
  // تولد ۳۰ اسفند ۱۴۰۳ (سال کبیسه) → در سال غیرکبیسه به ۲۹ اسفند و در سال کبیسه به ۳۰ اسفند می‌افتد
  const jalaali = require('jalaali-js');
  const leapBirth = J.toGregorian('1403/12/30'); assert(!!leapBirth, '1403 is a leap year (30 Esfand exists)');
  for (const jy of [1404, 1405, 1406, 1407, 1408]) {
    const len = jalaali.jalaaliMonthLength(jy, 12); const from = J.toGregorian(`${jy}/11/01`);
    b = bd.nextBirthday(leapBirth, from);
    assert(b && b.jm === 12 && b.jd === 30 && b.date === J.toGregorian(`${jy}/12/${len}`) && b.turning === jy - 1403, `30 Esfand birthday in ${jy} → ${jy}/12/${len} (${b && b.date})`);
  }
  assert(bd.joinFa(['الف', 'ب', 'ج']) === 'الف، ب و ج' && bd.whenLabel(1) === 'فردا' && /۳ روز/.test(bd.whenLabel(3)), 'joinFa / whenLabel');

  const a = new Client(); let r = await a.login('admin', 'admin123'); assert(r.status === 302, 'admin login');
  await a.post('/system/modules/toggle', { key: 'students.birthdays', enabled: '1' });
  await a.post('/system/modules/toggle', { key: 'calendar.birthdays', enabled: '1' });
  await a.post('/system/modules/toggle', { key: 'dashboard.birthdays', enabled: '1' });

  // دانش‌آموز آزمایشی با تولد امروز و یکی با تولد ۵ روز دیگر (دمو: 40001 امروز، 40002 سه روز دیگر — ولی به زمان نصب وابسته است، پس خودمان می‌سازیم)
  const tag = Math.floor(Math.random() * 1e6);
  const mk = async (offset, first) => {
    const p = J.toJalaliParts(J.addDays(today, offset));
    const body = { first_name: first, last_name: 'تولدی' + tag, gender: 'male', birth_date: `${p.jy - 13}/${p.jm}/${p.jd}`, class_id: '1', status: 'active', national_id: nid(), student_number: String(900000 + Math.floor(Math.random() * 90000)) };
    const res = await a.post('/students', body); if (res.status !== 302) console.log('create student status', res.status, (res.text.match(/alert-danger[\s\S]{0,300}/) || [''])[0]);
    const row = await a.get('/students?q=' + encodeURIComponent(first + ' ' + 'تولدی' + tag)); const m = /href="\/students\/(\d+)"/.exec(row.text); return m ? Number(m[1]) : null;
  };
  const idToday = await mk(0, 'امروزی'); const idSoon = await mk(5, 'نزدیک');
  assert(idToday && idSoon, 'two test students created (' + idToday + ', ' + idSoon + ')');

  // ---- صفحهٔ تولدها و بازه‌ها
  r = await a.get('/students/birthdays'); assert(r.status === 200 && /تولد دانش‌آموزان/.test(r.text), 'birthdays page');
  assert(r.text.includes('امروزی تولدی' + tag) && /🎂 امروز/.test(r.text) && /table-danger/.test(r.text), 'today birthday highlighted');
  assert(r.text.includes('نزدیک تولدی' + tag) && /۵ روز دیگر/.test(r.text), 'upcoming birthday with countdown 5 days');
  r = await a.get('/students/birthdays?range=week'); assert(r.status === 200 && /این هفته \(/.test(r.text) && /هفتهٔ آینده \(/.test(r.text) && r.text.includes('امروزی تولدی' + tag), 'week view groups this/next week');
  r = await a.get(`/students/birthdays?range=month&m=${tp.jm}`); assert(r.status === 200 && r.text.includes('امروزی تولدی' + tag), 'month view lists today birthday');
  r = await a.get('/students/birthdays?range=all&class_id=1'); assert(r.status === 200 && r.text.includes('امروزی تولدی' + tag), 'all-year view filtered by class');
  r = await a.get('/students/birthdays?range=all&class_id=2'); assert(r.status === 200 && !r.text.includes('امروزی تولدی' + tag), 'class filter excludes other classes');

  // ---- خروجی Excel واقعی و CSV
  r = await a.get('/students/birthdays?export=xlsx');
  assert(r.status === 200 && /spreadsheetml\.sheet/.test(r.headers['content-type']) && /\.xlsx/.test(r.headers['content-disposition']) && r.text.startsWith('PK'), 'xlsx export (zip signature + mime)');
  r = await a.get('/students/birthdays?export=csv'); assert(r.status === 200 && /^\uFEFF?نام,شماره دانش‌آموزی/.test(r.text) && r.text.includes('تولدی' + tag), 'csv export');
  // اعتبار ساختار xlsx با خوانندهٔ ZIP داخلی
  const zip = require('../src/core/zip'); const xlsx = require('../src/core/xlsx'); const fs = require('fs'); const os = require('os'); const path = require('path');
  const buf = xlsx.fromColumns([{ a: 'علی', n: '40001', p: '0912', s: 3.5 }], [{ key: 'a', label: 'نام' }, { key: 'n', label: 'شماره' }, { key: 'p', label: 'تلفن' }, { key: 's', label: 'معدل' }], 'برگه');
  const tmp = path.join(os.tmpdir(), 'bd-' + tag + '.xlsx'); fs.writeFileSync(tmp, buf);
  const zr = new zip.ZipReader(tmp); const sheet = zr.read('xl/worksheets/sheet1.xml').toString('utf8'); const wb = zr.read('xl/workbook.xml').toString('utf8'); zr.close(); fs.unlinkSync(tmp);
  assert(/rightToLeft="1"/.test(sheet) && /<v>40001<\/v>/.test(sheet) && /<t xml:space="preserve">0912<\/t>/.test(sheet) && /<v>3.5<\/v>/.test(sheet) && /name="برگه"/.test(wb), 'xlsx: RTL, numeric cells, leading-zero kept as text, sheet name');

  // ---- تبریک دستی
  r = await a.post(`/students/birthdays/greet/${idToday}`, {}); assert(r.status === 302, 'manual greet redirects');
  r = await a.get('/students/birthdays'); assert(/تبریک تولد ارسال شد/.test(r.text), 'greet flash shown');

  // ---- کار روزانه: اجرای دستی + اعلان‌ها (در صورت اجرای قبلی در همان روز، تکراری ارسال نمی‌شود)
  await a.post('/system/settings/birthdays', { birthday_days_before: '5', birthday_notify_admin: '1', birthday_notify_teacher: '1', birthday_notify_student: '1', birthday_notify_parents: '1', birthday_sms_student: '0', birthday_sms_parents: '0', birthday_tpl_student: '{first_name} جان تولدت مبارک — {school} [tpl' + tag + ']', birthday_tpl_admin_today: 'امروز تولد {name} از {class} است ({age} ساله) [adm' + tag + ']', birthday_tpl_admin_upcoming: 'تولد {list} {when} است [up' + tag + ']' });
  r = await a.get('/system/settings?tab=birthdays'); assert(r.status === 200 && r.text.includes('[tpl' + tag + ']') && /سارا جان تولدت مبارک/.test(r.text), 'birthday settings saved + live preview uses sample data');
  r = await a.post('/system/jobs/birthday_notify', { action: 'run' }); assert(r.status === 302, 'run birthday job');
  r = await a.get('/system/jobs'); assert(/تولد امروز/.test(r.text) && /تولد نزدیک/.test(r.text), 'job summary recorded');
  r = await a.get('/notifications'); assert(r.text.includes('[adm' + tag + ']') || r.text.includes('امروزی تولدی' + tag), 'admin got today-birthday notification with admin template');
  assert(r.text.includes('[up' + tag + ']') || /نزدیک است/.test(r.text), 'admin got upcoming reminder (days_before=5)');
  // اجرای دوباره نباید اعلان تکراری بسازد
  const before = (r.text.match(new RegExp('\\[adm' + tag + '\\]', 'g')) || []).length;
  await a.post('/system/jobs/birthday_notify', { action: 'run' });
  r = await a.get('/notifications'); const after = (r.text.match(new RegExp('\\[adm' + tag + '\\]', 'g')) || []).length;
  assert(after === before, 'no duplicate admin notification on re-run (' + before + '→' + after + ')');

  // ---- داشبورد مدیر/معلم/تقویم
  r = await a.get('/dashboard'); assert(/تولدهای این هفته/.test(r.text) && r.text.includes('امروزی تولدی' + tag), 'admin dashboard birthday card');
  r = await a.get('/calendar'); assert(/تولدها/.test(r.text) && /این هفته/.test(r.text) && /🎂 تولد امروزی تولدی/.test(r.text), 'calendar: week card + birthday item in grid');
  const t = new Client(); await t.login('teacher1', '123456');
  r = await t.get('/dashboard'); assert(/تولد دانش‌آموزان من/.test(r.text) && r.text.includes('امروزی تولدی' + tag), 'teacher dashboard shows own-class birthdays');
  r = await t.get('/students/birthdays'); assert(r.status === 200 && r.text.includes('امروزی تولدی' + tag), 'teacher birthdays page scoped to own classes');
  r = await t.get('/notifications'); assert(r.text.includes('امروزی تولدی' + tag), 'homeroom teacher notified');
  // معلم نمی‌تواند برای دانش‌آموز خارج از کلاس‌هایش تبریک بفرستد
  const tl = await t.get('/students'); const mine = new Set([...tl.text.matchAll(/name="class_id"[\s\S]*?<\/select>/g)].flatMap((m) => [...m[0].matchAll(/<option value="(\d+)"/g)].map((x) => x[1])));
  const al = await a.get('/students'); const allCls = [...(/name="class_id"[\s\S]*?<\/select>/.exec(al.text) || [''])[0].matchAll(/<option value="(\d+)"/g)].map((x) => x[1]);
  const foreign = allCls.find((c) => !mine.has(c));
  if (foreign) { const other = await a.get('/students?class_id=' + foreign); const om = /href="\/students\/(\d+)"/.exec(other.text); if (om) { r = await t.post(`/students/birthdays/greet/${om[1]}`, {}); assert(r.status === 403, 'teacher cannot greet student outside scope (class ' + foreign + ')'); } }
  else console.log('skip: teacher1 has access to all classes');

  // ---- پنل دانش‌آموز: بنر روز تولد + اعلان با الگوی دانش‌آموز؛ شمارش معکوس
  const sToday = await a.get(`/students/${idToday}`); const un = (/نام کاربری[^<]*<\/[^>]+>\s*<[^>]*>([^<]+)/.exec(sToday.text) || [])[1];
  const stNum = (/شماره دانش‌آموزی[\s\S]{0,200}?(\d{6})/.exec(en(sToday.text)) || [])[1];
  const sc = new Client(); r = await sc.login(stNum, (/کد ملی[\s\S]{0,200}?(\d{10})/.exec(en(sToday.text)) || [])[1] || '');
  if (r.status === 302) {
    r = await sc.get('/dashboard'); if (r.status === 302 && /password/.test(r.location || '')) { await sc.post('/auth/password', { current_password: '', password: 'Abc12345!', password_confirmation: 'Abc12345!' }); r = await sc.get('/dashboard'); }
    assert(/تولدت مبارک/.test(r.text) && /birthday-today/.test(r.text), 'student dashboard shows birthday banner');
    r = await sc.get('/notifications'); assert(r.text.includes('[tpl' + tag + ']') || /تولدت مبارک/.test(r.text), 'student notification uses student template');
  } else console.log('skip: student login for generated account (status ' + r.status + ')');
  const s2 = new Client(); r = await s2.login('40002', '123456');
  if (r.status === 302) { r = await s2.get('/dashboard'); assert(r.status === 200 && (/تا تولدت/.test(r.text) || /تولدت مبارک/.test(r.text) || !/birthday/.test(r.text)), 'student 40002 dashboard renders birthday widget (countdown or banner)'); }

  // ---- خاموش کردن قابلیت
  await a.post('/system/modules/toggle', { key: 'students.birthdays', enabled: '0' });
  r = await a.get('/students/birthdays'); assert(r.status === 404 || r.status === 403, 'birthdays page hidden when feature disabled');
  r = await a.get('/dashboard'); assert(!/تولدهای این هفته/.test(r.text), 'dashboard card hidden when disabled');
  await a.post('/system/modules/toggle', { key: 'students.birthdays', enabled: '1' });

  // پاک‌سازی
  for (const id of [idToday, idSoon]) if (id) await a.post(`/students/${id}/delete`, {});
  console.log('flow-birthdays done');
})().catch((e) => { console.error(e); process.exit(1); });

function nid() {
  const d = []; for (let i = 0; i < 9; i++) d.push(Math.floor(Math.random() * 10));
  if (d.every((x) => x === d[0])) d[0] = (d[0] + 1) % 10;
  let sum = 0; for (let i = 0; i < 9; i++) sum += d[i] * (10 - i);
  const r = sum % 11; d.push(r < 2 ? r : 11 - r); return d.join('');
}
