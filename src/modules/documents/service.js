'use strict';
/** اسناد رسمی: شماره‌گذاری (سریال)، کد استعلام، قالب متن، صدور و بازخوانی */
const crypto = require('crypto');
const db = require('../../core/db');
const settings = require('../../core/settings');
const J = require('../../core/jalali');
const utils = require('../../core/utils');

const TYPES = {
  certificate: { title: 'گواهی اشتغال به تحصیل', prefix: 'گ', icon: 'bi-patch-check', feature: 'documents.certificates' },
  letter: { title: 'نامه / معرفی‌نامه', prefix: 'ن', icon: 'bi-envelope-paper', feature: 'documents.letters' },
  report_card: { title: 'کارنامهٔ رسمی', prefix: 'ک', icon: 'bi-file-earmark-text', feature: 'documents.report_card' },
  grade_sheet: { title: 'ریزنمرات رسمی', prefix: 'ر', icon: 'bi-table', feature: 'documents.grade_sheet' },
  roster: { title: 'دفتر حضور و غیاب', prefix: 'ل', icon: 'bi-calendar-check', feature: 'documents.roster' }
};

/** سریال یکتا به شکل «گ-1405-0001» (شمارنده به ازای نوع و سال شمسی) */
async function nextSerial(type) {
  const t = TYPES[type] || { prefix: 'س' };
  const jy = J.toJalaliParts(J.todayISO()).jy;
  const base = `${t.prefix}-${jy}-`;
  const last = await db.table('documents').where('serial', 'like', base + '%').orderBy('id', 'desc').first();
  let n = last ? (parseInt(String(last.serial).slice(base.length), 10) || 0) : 0;
  for (let i = 0; i < 50; i++) {
    n++;
    const serial = base + String(n).padStart(4, '0');
    if (!(await db.table('documents').where('serial', serial).first())) return serial;
  }
  return base + Date.now();
}
async function newVerifyCode() {
  for (let i = 0; i < 20; i++) {
    const code = crypto.randomBytes(5).toString('hex').toUpperCase();
    if (!(await db.table('documents').where('verify_code', code).first())) return code;
  }
  return crypto.randomBytes(8).toString('hex').toUpperCase();
}
/** جایگزینی {متغیر}ها در قالب */
function fill(template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] == null || vars[k] === '' ? '—' : String(vars[k])));
}
/** دانش‌آموز + متغیرهای قالب */
async function studentContext(studentId, extra) {
  const s = await db.table('students as s').leftJoin('classes as c', 'c.id', 's.class_id').leftJoin('grade_levels as g', 'g.id', 's.grade_level_id')
    .select('s.*', 'c.title as class_title', 'g.title as grade_title').where('s.id', studentId).first();
  if (!s) return null;
  const year = await db.table('academic_years').where('is_current', 1).first();
  const vars = Object.assign({
    student: `${s.first_name} ${s.last_name}`, first_name: s.first_name, last_name: s.last_name,
    father: s.father_name || '—', student_number: J.toPersianDigits(s.student_number || ''), national_id: J.toPersianDigits(s.national_id || ''),
    birth_date: s.birth_date ? J.formatDate(s.birth_date) : '—', class: s.class_title || '—', grade: s.grade_title || '—',
    year: year ? J.toPersianDigits(year.title) : '—', school: settings.get('school_name', ''), date: J.formatDate(J.todayISO()),
    principal: settings.get('principal_name', ''), recipient: '—'
  }, extra || {});
  return { student: s, vars };
}
/** صدور سند و بازگرداندن رکورد */
async function issue({ type, studentId, title, recipient, body, purpose, data, userId, termId, classId }) {
  const serial = await nextSerial(type);
  const verify_code = await newVerifyCode();
  const id = await db.insert('documents', {
    type, serial, student_id: studentId || null, title: String(title || TYPES[type].title).slice(0, 200), recipient: recipient ? String(recipient).slice(0, 200) : null,
    body: body || null, purpose: purpose ? String(purpose).slice(0, 200) : null, issued_at: J.todayISO(), issued_by: userId || null, verify_code,
    data: data ? JSON.stringify(data) : null, term_id: termId || null, class_id: classId || null, status: 'valid', created_at: db.now()
  });
  return { id, serial, verify_code };
}
function baseQuery() {
  return db.table('documents as d').leftJoin('students as s', 's.id', 'd.student_id').leftJoin('users as u', 'u.id', 'd.issued_by')
    .select('d.*', 's.first_name', 's.last_name', 's.student_number', 'u.name as issuer_name');
}
function parseData(doc) { try { return doc && doc.data ? JSON.parse(doc.data) : null; } catch (e) { return null; } }
function verifyUrl(code) { const base = (settings.get('site_url', '') || '').replace(/\/+$/, ''); return `${base}/documents/verify/${code}`; }
/** اطلاعات سربرگ برای قالب‌ها */
function letterhead() {
  return {
    header: String(settings.get('letterhead_header', '') || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean),
    footer: settings.get('letterhead_footer', '') || [settings.get('school_address', ''), settings.get('school_phone', '') ? 'تلفن: ' + J.toPersianDigits(settings.get('school_phone', '')) : ''].filter(Boolean).join(' · '),
    district: settings.get('school_district', ''), logo: settings.get('school_logo', ''), signature: settings.get('signature_image', ''), stamp: settings.get('stamp_image', ''),
    signatory: settings.get('principal_name', ''), signatoryTitle: settings.get('signatory_title', 'مدیر مدرسه'), school: settings.get('school_name', '')
  };
}
module.exports = { TYPES, nextSerial, newVerifyCode, fill, studentContext, issue, baseQuery, parseData, verifyUrl, letterhead, utils };
