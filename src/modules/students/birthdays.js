'use strict';
/**
 * سرویس تولد دانش‌آموزان
 *  - تولد بر اساس «تقویم شمسی» محاسبه می‌شود (تاریخ تولد به‌صورت ISO میلادی ذخیره شده است؛ ماه/روز شمسی آن استخراج و روی سال جاری تصویر می‌شود).
 *  - ۳۰ اسفند در سال‌های غیرکبیسه به ۲۹ اسفند منتقل می‌شود.
 *  - ارسال پیام‌ها با الگوی جداگانه برای هر گیرنده (مدیر/معلم/دانش‌آموز/اولیا) و جلوگیری از ارسال تکراری در یک روز.
 */
const jalaali = require('jalaali-js');
const db = require('../../core/db');
const J = require('../../core/jalali');
const settings = require('../../core/settings');
const notify = require('../../core/notify');
const modules = require('../../core/modules');

const pad = (n) => String(n).padStart(2, '0');
const COLOR = '#db2777';

/** تولد بعدی یک تاریخ تولد نسبت به امروز: { date, days, turning, jm, jd, isToday } */
function nextBirthday(birthIso, todayIso) {
  const b = J.toJalaliParts(birthIso); if (!b) return null;
  const today = todayIso || J.todayISO();
  const t = J.toJalaliParts(today); if (!t) return null;
  const build = (jy) => {
    const jd = Math.min(b.jd, jalaali.jalaaliMonthLength(jy, b.jm));
    const g = jalaali.toGregorian(jy, b.jm, jd);
    return `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`;
  };
  let date = build(t.jy);
  if (date < today) date = build(t.jy + 1);
  const days = J.diffDays(today, date);
  const turning = J.toJalaliParts(date).jy - b.jy;
  return { date, days, turning, jm: b.jm, jd: b.jd, isToday: days === 0, weekday: J.weekdayName(date) };
}

function fullName(s) { return `${s.first_name || ''} ${s.last_name || ''}`.trim(); }

/** پرس‌وجوی پایه: دانش‌آموزان فعال دارای تاریخ تولد به همراه کلاس */
function baseQuery() {
  return db.table('students as s').leftJoin('classes as c', 'c.id', 's.class_id').leftJoin('grade_levels as g', 'g.id', 's.grade_level_id')
    .select('s.id', 's.user_id', 's.first_name', 's.last_name', 's.student_number', 's.gender', 's.birth_date', 's.class_id', 's.photo', 's.mobile',
      's.father_phone', 's.mother_phone', 's.guardian_phone', 's.guardian_type', 'c.title as class_title', 'c.teacher_id as homeroom_id', 'g.title as grade_title')
    .where('s.status', 'active').whereNotNull('s.birth_date').where('s.birth_date', '!=', '');
}

function decorate(rows, todayIso) {
  const out = [];
  for (const r of rows) { const b = nextBirthday(r.birth_date, todayIso); if (b) { r.bday = b; r.name = fullName(r); out.push(r); } }
  return out;
}

/**
 * تولدهای آینده در بازهٔ `days` روز (امروز = ۰). فیلترها: classIds (آرایه)، studentId، studentIds
 * خروجی بر اساس روزهای مانده مرتب می‌شود.
 */
async function upcoming(opts) {
  opts = opts || {};
  const today = opts.today || J.todayISO();
  const days = opts.days == null ? 14 : Number(opts.days);
  const q = baseQuery();
  if (opts.classIds) { if (!opts.classIds.length) return []; q.whereIn('s.class_id', opts.classIds); }
  if (opts.studentId) q.where('s.id', opts.studentId);
  if (opts.studentIds) { if (!opts.studentIds.length) return []; q.whereIn('s.id', opts.studentIds); }
  const rows = decorate(await q.all(), today).filter((r) => r.bday.days <= days);
  rows.sort((a, b) => a.bday.days - b.bday.days || a.name.localeCompare(b.name, 'fa'));
  return opts.limit ? rows.slice(0, opts.limit) : rows;
}

/** تولدهای یک ماه شمسی (بدون توجه به سال) مرتب‌شده بر اساس روز */
async function inMonth(jm, opts) {
  opts = opts || {};
  const today = opts.today || J.todayISO();
  const q = baseQuery();
  if (opts.classIds) { if (!opts.classIds.length) return []; q.whereIn('s.class_id', opts.classIds); }
  const rows = decorate(await q.all(), today).filter((r) => r.bday.jm === Number(jm));
  rows.sort((a, b) => a.bday.jd - b.bday.jd || a.name.localeCompare(b.name, 'fa'));
  return rows;
}

/** بازهٔ «این هفته» و «هفتهٔ آینده» (شنبه تا جمعه) نسبت به امروز */
function weekRanges(todayIso) {
  const today = todayIso || J.todayISO();
  const wd = J.weekdayIndex(today) || 0; // ۰ = شنبه
  const start = J.addDays(today, -wd);
  return { thisWeek: { start, end: J.addDays(start, 6) }, nextWeek: { start: J.addDays(start, 7), end: J.addDays(start, 13) } };
}

/** تولدهای این هفته و هفتهٔ آینده (برای تقویم مدیر/معلم) */
async function forWeeks(opts) {
  opts = opts || {};
  const today = opts.today || J.todayISO();
  const r = weekRanges(today);
  const all = await upcoming(Object.assign({}, opts, { today, days: 14, limit: null }));
  const inRange = (x, range) => x.bday.date >= range.start && x.bday.date <= range.end;
  return { ranges: r, thisWeek: all.filter((x) => inRange(x, r.thisWeek)), nextWeek: all.filter((x) => inRange(x, r.nextWeek)) };
}

function whenLabel(days) {
  if (days === 0) return 'امروز';
  if (days === 1) return 'فردا';
  if (days === 2) return 'پس‌فردا';
  return `${J.toPersianDigits(days)} روز دیگر`;
}

function joinFa(list) {
  if (list.length <= 1) return list.join('');
  return list.slice(0, -1).join('، ') + ' و ' + list[list.length - 1];
}

const DEFAULT_TPL = {
  birthday_tpl_admin_upcoming: '🎂 تولد {list} {when} است ({date}). برای تبریک آماده شوید.',
  birthday_tpl_admin_today: '🎂 امروز تولد {name} ({class}) است و {age} ساله می‌شود.',
  birthday_tpl_teacher: '🎂 امروز تولد {name} از کلاس {class} است؛ تبریک یادتان نرود.',
  birthday_tpl_student: '{first_name} عزیز، تولدت مبارک! 🎉 خانوادهٔ {school} برایت سالی سرشار از شادی، سلامتی و موفقیت آرزو می‌کند.',
  birthday_tpl_parent: 'اولیای گرامی، {age} سالگی {name} عزیز را به شما تبریک می‌گوییم. 🎂 برای فرزندتان سالی پربار آرزومندیم. — {school}'
};
const tpl = (key) => settings.get(key) || DEFAULT_TPL[key] || '';

function vars(s, extra) {
  return Object.assign({
    name: s.name || fullName(s), first_name: s.first_name || '', last_name: s.last_name || '', class: s.class_title || 'بدون کلاس',
    age: J.toPersianDigits(s.bday ? s.bday.turning : ''), date: s.bday ? J.formatDate(s.bday.date) : '', school: settings.get('school_name', 'مدرسه'),
    when: s.bday ? whenLabel(s.bday.days) : '', weekday: s.bday ? s.bday.weekday : ''
  }, extra || {});
}

/** آیا امروز اعلانی با این عنوان برای این کاربر ثبت شده؟ (جلوگیری از تکرار در اجرای مجدد کار) */
// یکتا در روز: همان عنوان + همان متن (اگر فهرست دانش‌آموزان یا قالب تغییر کند، اعلان تازه با متن جدید می‌رود)
async function alreadyNotified(userIds, title, body) {
  if (!userIds.length) return false;
  const since = J.localToUtc(`${J.todayISO()} 00:00:00`) || `${J.todayISO()} 00:00:00`;
  const q = db.table('notifications').whereIn('user_id', userIds).where('type', 'birthday').where('title', title.slice(0, 200)).where('created_at', '>=', since);
  if (body) q.where('body', body);
  return q.exists();
}

async function pushOnce(userIds, payload) {
  const ids = [...new Set((Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean))];
  if (!ids.length || await alreadyNotified(ids, payload.title, payload.body)) return 0;
  return notify.push(ids, Object.assign({ type: 'birthday' }, payload));
}

/**
 * اجرای روزانهٔ اطلاع‌رسانی تولد. خروجی: خلاصهٔ متنی برای ثبت در «کارهای زمان‌بندی‌شده».
 */
async function runDaily(todayIso) {
  const today = todayIso || J.todayISO();
  const daysBefore = Math.max(0, Math.min(30, Number(settings.get('birthday_days_before', '3')) || 0));
  const all = await upcoming({ today, days: Math.max(daysBefore, 0) });
  const todays = all.filter((s) => s.bday.days === 0);
  const soon = daysBefore > 0 ? all.filter((s) => s.bday.days === daysBefore) : [];
  const stats = { today: todays.length, soon: soon.length, admin: 0, teacher: 0, student: 0, parent: 0, sms: 0 };
  const parentsSvc = modules.isEnabled('parents') ? require('../parents/service') : null;
  const adminIds = settings.getBool('birthday_notify_admin', true) ? await db.table('users').where({ role: 'admin', status: 'active' }).pluck('id') : [];
  const smsOn = modules.isEnabled('notifications.sms') && settings.getBool('sms_enabled');

  // ۱) یادآوری چند روز قبل برای مدیر (یک اعلان تجمیعی)
  if (soon.length && adminIds.length) {
    const list = joinFa(soon.map((s) => `${s.name} (${s.class_title || 'بدون کلاس'})`));
    const first = soon[0];
    const body = notify.template(tpl('birthday_tpl_admin_upcoming'), vars(first, { list, name: list }));
    const title = (soon.length === 1 ? `تولد ${first.name} نزدیک است` : `تولد ${J.toPersianDigits(soon.length)} دانش‌آموز نزدیک است`) + ` (${J.formatDate(first.bday.date)})`;
    stats.admin += await pushOnce(adminIds, { title, body, link: `/students/birthdays?range=upcoming` });
  }

  // ۲) روز تولد
  for (const s of todays) {
    const v = vars(s);
    if (adminIds.length) stats.admin += await pushOnce(adminIds, { title: `امروز تولد ${s.name} است`, body: notify.template(tpl('birthday_tpl_admin_today'), v), link: `/students/${s.id}` });
    if (settings.getBool('birthday_notify_teacher', true) && s.homeroom_id) {
      const t = await db.table('teachers').where('id', s.homeroom_id).first();
      if (t && t.user_id) stats.teacher += await pushOnce([t.user_id], { title: `تولد ${s.name} (${s.class_title || ''})`, body: notify.template(tpl('birthday_tpl_teacher'), v), link: `/students/${s.id}` });
    }
    if (settings.getBool('birthday_notify_student', true) && s.user_id) {
      const text = notify.template(tpl('birthday_tpl_student'), v);
      stats.student += await pushOnce([s.user_id], { title: 'تولدت مبارک! 🎉', body: text, link: '/dashboard' });
      if (smsOn && settings.getBool('birthday_sms_student') && s.mobile) { const r = await notify.sms(s.mobile, text, 'students_birthday'); if (r && r.ok !== false) stats.sms++; }
    }
    if (settings.getBool('birthday_notify_parents', true)) {
      const text = notify.template(tpl('birthday_tpl_parent'), v);
      const targets = parentsSvc ? await parentsSvc.parentPhonesOfStudent(s.id) : [{ phone: s.guardian_type === 'mother' ? s.mother_phone : (s.guardian_type === 'other' ? s.guardian_phone : s.father_phone) || s.father_phone || s.mother_phone, user_id: null }];
      const userIds = targets.map((t) => t.user_id).filter(Boolean);
      if (userIds.length) stats.parent += await pushOnce(userIds, { title: `تولد ${s.first_name} مبارک 🎂`, body: text, link: '/parents/panel' });
      if (smsOn && settings.getBool('birthday_sms_parents')) {
        const seen = new Set();
        for (const t of targets) if (t.phone && !seen.has(t.phone)) { seen.add(t.phone); const r = await notify.sms(t.phone, text, 'students_birthday'); if (r && r.ok !== false) stats.sms++; }
      }
    }
  }
  return `${stats.today} تولد امروز، ${stats.soon} تولد نزدیک — اعلان: مدیر ${stats.admin}، معلم ${stats.teacher}، دانش‌آموز ${stats.student}، اولیا ${stats.parent}، پیامک ${stats.sms}`;
}

/** ارسال دستی تبریک برای یک دانش‌آموز (از صفحهٔ تولدها) — به دانش‌آموز و اولیا با همان الگوها */
async function greet(studentId, opts) {
  opts = opts || {};
  const s = decorate(await baseQuery().where('s.id', studentId).all())[0];
  if (!s) return { ok: false, error: 'دانش‌آموز یافت نشد یا تاریخ تولد ندارد' };
  const v = vars(s);
  const out = { ok: true, student: 0, parent: 0, sms: 0 };
  if (opts.student !== false && s.user_id) out.student += await notify.push([s.user_id], { title: 'تولدت مبارک! 🎉', body: notify.template(tpl('birthday_tpl_student'), v), link: '/dashboard', type: 'birthday' });
  if (opts.parents !== false) {
    const text = notify.template(tpl('birthday_tpl_parent'), v);
    const parentsSvc = modules.isEnabled('parents') ? require('../parents/service') : null;
    const targets = parentsSvc ? await parentsSvc.parentPhonesOfStudent(s.id) : [{ phone: s.father_phone || s.mother_phone || s.guardian_phone, user_id: null }];
    const userIds = targets.map((t) => t.user_id).filter(Boolean);
    if (userIds.length) out.parent += await notify.push(userIds, { title: `تولد ${s.first_name} مبارک 🎂`, body: text, link: '/parents/panel', type: 'birthday' });
    if (opts.sms && modules.isEnabled('notifications.sms') && settings.getBool('sms_enabled')) {
      const seen = new Set();
      for (const t of targets) if (t.phone && !seen.has(t.phone)) { seen.add(t.phone); const r = await notify.sms(t.phone, text, 'students_birthday'); if (r && r.ok !== false) out.sms++; }
    }
  }
  return out;
}

/** پیش‌نمایش الگوها با دادهٔ نمونه (برای صفحهٔ تنظیمات) */
function preview(templates) {
  const sample = { first_name: 'سارا', last_name: 'محمدی', name: 'سارا محمدی', class_title: 'هفتم الف', bday: { turning: 13, date: J.todayISO(), days: 3, weekday: J.weekdayName(J.todayISO()) } };
  const v = vars(sample, { list: 'سارا محمدی (هفتم الف) و علی رضایی (نهم ب)' });
  const out = {};
  for (const k of Object.keys(DEFAULT_TPL)) out[k] = notify.template((templates && templates[k]) || tpl(k), v);
  return out;
}

module.exports = { nextBirthday, upcoming, inMonth, forWeeks, weekRanges, runDaily, greet, preview, whenLabel, joinFa, DEFAULT_TPL, COLOR, MONTHS: J.MONTHS };
