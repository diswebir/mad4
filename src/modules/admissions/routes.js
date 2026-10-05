'use strict';
const path = require('path');
const express = require('express');
const db = require('../../core/db');
const auth = require('../../core/auth');
const modules = require('../../core/modules');
const activity = require('../../core/activity');
const utils = require('../../core/utils');
const J = require('../../core/jalali');
const settings = require('../../core/settings');
const notify = require('../../core/notify');
const upload = require('../../core/upload');
const studentsSvc = require('../students/service');
const enrollments = require('../enrollments/service');

const router = express.Router();
const v = (n) => path.join(__dirname, 'views', n + '.ejs');
const E = modules.isEnabled;

const STATUSES = { pending: 'در انتظار بررسی', reviewing: 'در حال بررسی', docs_requested: 'نیازمند مدارک', accepted: 'پذیرفته‌شده', rejected: 'رد شده', enrolled: 'ثبت‌نام قطعی' };
const STATUS_COLORS = { pending: 'secondary', reviewing: 'info', docs_requested: 'warning', accepted: 'success', rejected: 'danger', enrolled: 'primary' };
const PUBLIC_FIELDS = ['first_name', 'last_name', 'national_id', 'birth_date', 'birth_place', 'gender', 'grade_level_id', 'previous_school', 'previous_average', 'father_name', 'father_phone', 'father_national_id', 'father_job', 'father_education', 'mother_name', 'mother_phone', 'mother_job', 'mother_education', 'address', 'postal_code', 'home_phone', 'email', 'notes'];

const isOpen = () => settings.getBool('admissions_open');
async function openGrades() {
  const ids = settings.getList('admissions_grades').map(Number).filter(Boolean);
  const q = db.table('grade_levels').orderBy('sort_order');
  if (ids.length) q.whereIn('id', ids);
  return q.all();
}
async function admissionYear() {
  const id = settings.getInt('admissions_year', 0);
  return (id && await db.findById('academic_years', id)) || (await db.table('academic_years').where('is_current', 1).first()) || null;
}
async function nextCode() {
  const jy = J.toJalaliParts(J.todayISO()).jy;
  const base = `AP-${jy}-`;
  const last = await db.table('applications').where('code', 'like', base + '%').orderBy('id', 'desc').first();
  let n = last ? (parseInt(String(last.code).slice(base.length), 10) || 0) : 0;
  for (let i = 0; i < 50; i++) { n++; const code = base + String(n).padStart(5, '0'); if (!(await db.exists('applications', { code }))) return code; }
  return base + Date.now();
}
function makeCaptcha(req) { const a = Math.floor(Math.random() * 9) + 1, b = Math.floor(Math.random() * 9) + 1; req.session.applyCaptcha = a + b; return { a, b }; }
async function publicCtx(req) { return { grades: await openGrades(), year: await admissionYear(), docs: settings.get('admissions_docs', ''), intro: settings.get('admissions_text', ''), EDUCATIONS: utils.EDUCATIONS, GENDERS: utils.GENDERS }; }

// ---------- عمومی: فرم پیش‌ثبت‌نام ----------
const closedPage = (req, res) => res.status(403).render(v('closed'), { layout: 'layouts/public', title: 'پیش‌ثبت‌نام', wide: false });
router.get('/apply', modules.requireEnabled('admissions.public_form'), async (req, res) => {
  if (!isOpen()) return closedPage(req, res);
  res.render(v('apply'), Object.assign({ layout: 'layouts/public', title: 'پیش‌ثبت‌نام', wide: true, captcha: makeCaptcha(req), errors: [], data: {} }, await publicCtx(req)));
});
router.post('/apply', modules.requireEnabled('admissions.public_form'), ...upload.form('applications', 'single', 'file', { userContent: true, maxMb: 5, maxFiles: 1 }), async (req, res) => {
  if (!isOpen()) return closedPage(req, res);
  const ip = auth.clientIp(req);
  const data = utils.cleanBody(req.body, { fields: PUBLIC_FIELDS, dates: ['birth_date'], numbers: ['grade_level_id', 'previous_average'] });
  for (const k of ['father_phone', 'mother_phone', 'home_phone']) if (data[k]) data[k] = utils.normalizePhone(data[k]);
  for (const k of ['national_id', 'father_national_id', 'postal_code']) if (data[k]) data[k] = J.toEnglishDigits(String(data[k])).replace(/\D/g, '');
  const errors = [];
  const grades = await openGrades();
  const ans = parseInt(J.toEnglishDigits(req.body.captcha || ''), 10);
  if (req.session.applyCaptcha == null || ans !== req.session.applyCaptcha) errors.push('پاسخ سؤال امنیتی نادرست است.');
  if (!data.first_name || !data.last_name) errors.push('نام و نام خانوادگی دانش‌آموز الزامی است.');
  if (!data.national_id || !utils.isValidNationalId(data.national_id)) errors.push('کد ملی دانش‌آموز نامعتبر است.');
  if (!data.birth_date) errors.push('تاریخ تولد (شمسی) الزامی است.');
  if (!data.gender || !utils.GENDERS[data.gender]) errors.push('جنسیت را انتخاب کنید.');
  if (!data.grade_level_id || !grades.find((g) => g.id === Number(data.grade_level_id))) errors.push('پایهٔ درخواستی نامعتبر است.');
  if (!data.father_name) errors.push('نام پدر/سرپرست الزامی است.');
  if (!data.father_phone || !utils.isValidMobile(data.father_phone)) errors.push('شمارهٔ موبایل پدر/سرپرست نامعتبر است (مانند 0912xxxxxxx).');
  if (data.mother_phone && !utils.isValidMobile(data.mother_phone)) errors.push('شمارهٔ موبایل مادر نامعتبر است.');
  if (data.father_national_id && !utils.isValidNationalId(data.father_national_id)) errors.push('کد ملی پدر نامعتبر است.');
  if (data.email && !utils.isValidEmail(data.email)) errors.push('ایمیل نامعتبر است.');
  if (data.previous_average != null && (data.previous_average < 0 || data.previous_average > 20)) errors.push('معدل سال قبل باید بین ۰ تا ۲۰ باشد.');
  if (!req.body.accept) errors.push('تأیید صحت اطلاعات الزامی است.');
  if (req.uploadError) errors.push(req.uploadError);
  if (!errors.length) {
    const since = new Date(Date.now() - 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    if ((await db.table('applications').where('ip', ip).where('created_at', '>=', since).count()) >= 5) errors.push('تعداد درخواست‌های ارسالی از این دستگاه بیش از حد مجاز است. یک ساعت بعد دوباره تلاش کنید.');
    const dup = await db.table('applications').where('national_id', data.national_id).whereNotIn('status', ['rejected']).first();
    if (dup) errors.push(`برای این کد ملی قبلاً درخواستی با کد ${dup.code} ثبت شده است. از بخش پیگیری استفاده کنید.`);
    if (await db.exists('students', { national_id: data.national_id })) errors.push('دانش‌آموزی با این کد ملی هم‌اکنون در این مدرسه ثبت‌نام شده است.');
  }
  if (errors.length) {
    if (req.file) upload.removeFile(upload.relPath(req.file));
    return res.status(422).render(v('apply'), Object.assign({ layout: 'layouts/public', title: 'پیش‌ثبت‌نام', wide: true, captcha: makeCaptcha(req), errors, data: Object.assign({}, req.body, data) }, await publicCtx(req)));
  }
  req.session.applyCaptcha = null;
  const year = await admissionYear();
  const code = await nextCode();
  const row = Object.assign({}, data, { code, academic_year_id: year ? year.id : null, status: 'pending', ip, created_at: db.now() });
  if (req.file && E('admissions.attachments')) { row.file_path = upload.relPath(req.file); row.file_name = (req.file.originalname || '').slice(0, 150); } else if (req.file) upload.removeFile(upload.relPath(req.file));
  const id = await db.insert('applications', row);
  await activity.log(null, 'apply', 'applications', id, `پیش‌ثبت‌نام ${data.first_name} ${data.last_name} (${code})`);
  let smsSent = false;
  if (E('admissions.notify')) { const r = await notify.sms(data.father_phone, `${settings.get('school_name', '')}\nپیش‌ثبت‌نام ${data.first_name} ${data.last_name} ثبت شد.\nکد رهگیری: ${code}\nپیگیری: ${(settings.get('site_url', '') || '').replace(/\/+$/, '')}/apply/track`, 'admissions'); smsSent = !!(r && r.ok); }
  if (E('notifications.inapp')) await notify.pushRole('admin', { title: 'درخواست پیش‌ثبت‌نام جدید', body: `${data.first_name} ${data.last_name} — ${(grades.find((g) => g.id === Number(data.grade_level_id)) || {}).title || ''}`, link: '/admissions/' + id, type: 'info' });
  req.session.lastApplication = { code, national_id: data.national_id };
  res.redirect('/admissions/apply/done?code=' + encodeURIComponent(code) + (smsSent ? '&sms=1' : ''));
});
router.get('/apply/done', modules.requireEnabled('admissions.public_form'), (req, res) => {
  const code = String(req.query.code || '');
  res.render(v('apply-done'), { layout: 'layouts/public', title: 'ثبت درخواست', wide: false, code, sms: req.query.sms === '1', docs: settings.get('admissions_docs', '') });
});
// ---------- عمومی: پیگیری ----------
router.get('/track', modules.requireEnabled('admissions.tracking'), async (req, res) => {
  const code = J.toEnglishDigits(String(req.query.code || '')).trim().toUpperCase();
  const nid = J.toEnglishDigits(String(req.query.national_id || '')).replace(/\D/g, '');
  let app = null, notFound = false;
  if (code && nid) {
    app = await db.table('applications as a').leftJoin('grade_levels as g', 'g.id', 'a.grade_level_id').leftJoin('classes as c', 'c.id', 'a.class_id').select('a.*', 'g.title as grade_title', 'c.title as class_title').where('a.code', code).where('a.national_id', nid).first();
    notFound = !app;
  }
  res.render(v('track'), { layout: 'layouts/public', title: 'پیگیری پیش‌ثبت‌نام', wide: false, code, nid, app, notFound, STATUSES, STATUS_COLORS, docs: settings.get('admissions_docs', '') });
});

// ---------- مدیریت ----------
router.use(auth.requireAuth);
router.use(auth.requireRoleOrPermission(['admin'], 'admissions.manage'));
function baseQuery() {
  return db.table('applications as a').leftJoin('grade_levels as g', 'g.id', 'a.grade_level_id').leftJoin('academic_years as y', 'y.id', 'a.academic_year_id').leftJoin('users as u', 'u.id', 'a.reviewed_by').leftJoin('classes as c', 'c.id', 'a.class_id')
    .select('a.*', 'g.title as grade_title', 'y.title as year_title', 'u.name as reviewer_name', 'c.title as class_title');
}
function applyFilters(q, f) {
  if (f.status) q.where('a.status', f.status);
  if (f.grade_level_id) q.where('a.grade_level_id', f.grade_level_id);
  if (f.q) { const qq = J.toEnglishDigits(f.q); q.where((b) => b.where('a.first_name', 'like', `%${f.q}%`).orWhere('a.last_name', 'like', `%${f.q}%`).orWhere('a.father_name', 'like', `%${f.q}%`).orWhere('a.code', 'like', `%${qq.toUpperCase()}%`).orWhere('a.national_id', 'like', `%${qq}%`).orWhere('a.father_phone', 'like', `%${qq}%`)); }
  return q;
}
router.get('/', async (req, res) => {
  const f = { status: STATUSES[req.query.status] ? req.query.status : '', grade_level_id: req.query.grade_level_id || '', q: utils.normalizePersian(req.query.q || '').trim() };
  const result = await applyFilters(baseQuery(), f).orderBy('a.id', 'desc').paginate(req.query.page, 25);
  const statRows = await db.table('applications').select('status', 'COUNT(*) as c').groupBy('status').all();
  const stats = {}; statRows.forEach((r) => { stats[r.status] = Number(r.c); });
  res.render(v('index'), { title: 'پیش‌ثبت‌نام و پذیرش', result, f, stats, STATUSES, STATUS_COLORS, grades: await db.table('grade_levels').orderBy('sort_order').all(), open: isOpen(), year: await admissionYear() });
});
router.get('/export.csv', modules.requireEnabled('admissions.export'), async (req, res) => {
  const f = { status: STATUSES[req.query.status] ? req.query.status : '', grade_level_id: req.query.grade_level_id || '', q: utils.normalizePersian(req.query.q || '').trim() };
  const rows = await applyFilters(baseQuery(), f).orderBy('a.id', 'desc').all();
  const cols = [
    { label: 'کد رهگیری', key: 'code' }, { label: 'وضعیت', value: (r) => STATUSES[r.status] || r.status }, { label: 'نام', key: 'first_name' }, { label: 'نام خانوادگی', key: 'last_name' }, { label: 'کد ملی', key: 'national_id' },
    { label: 'تاریخ تولد', value: (r) => (r.birth_date ? J.toJalali(r.birth_date) : '') }, { label: 'جنسیت', value: (r) => utils.GENDERS[r.gender] || '' }, { label: 'پایه', key: 'grade_title' }, { label: 'مدرسهٔ قبلی', key: 'previous_school' }, { label: 'معدل', key: 'previous_average' },
    { label: 'نام پدر', key: 'father_name' }, { label: 'موبایل پدر', key: 'father_phone' }, { label: 'نام مادر', key: 'mother_name' }, { label: 'موبایل مادر', key: 'mother_phone' }, { label: 'نشانی', key: 'address' }, { label: 'یادداشت بررسی', key: 'review_note' }, { label: 'تاریخ ثبت', value: (r) => J.formatDateTime(r.created_at) }
  ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="applications.csv"');
  res.send(utils.toCSV(rows, cols));
});
router.get('/:id', async (req, res) => {
  const app = await baseQuery().where('a.id', req.params.id).first();
  if (!app) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const classes = app.grade_level_id ? await db.table('classes').where('grade_level_id', app.grade_level_id).where('is_active', 1).orderBy('title').all() : [];
  const counts = {}; for (const c of classes) counts[c.id] = await db.table('students').where('class_id', c.id).where('status', 'active').count();
  const existing = app.national_id ? await db.table('students').where('national_id', app.national_id).first() : null;
  const logs = await db.table('activity_logs as l').leftJoin('users as u', 'u.id', 'l.user_id').select('l.*', 'u.name as user_name').where('l.entity', 'applications').where('l.entity_id', app.id).orderBy('l.id', 'desc').limit(20).all();
  res.render(v('show'), { title: `درخواست ${app.code}`, app, classes, counts, existing, logs, STATUSES, STATUS_COLORS, EDUCATIONS: utils.EDUCATIONS, GENDERS: utils.GENDERS });
});
router.post('/:id/status', modules.requireEnabled('admissions.review'), async (req, res) => {
  const app = await db.findById('applications', req.params.id);
  if (!app) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const status = STATUSES[req.body.status] && req.body.status !== 'enrolled' ? req.body.status : null;
  if (!status) { req.flash('danger', 'وضعیت نامعتبر است.'); return res.redirect('/admissions/' + app.id); }
  if (app.status === 'enrolled') { req.flash('warning', 'این درخواست ثبت‌نام قطعی شده و قابل تغییر نیست.'); return res.redirect('/admissions/' + app.id); }
  const note = utils.normalizePersian(req.body.review_note || '').trim() || null;
  await db.update('applications', { status, review_note: note, reviewed_by: req.user.id, reviewed_at: db.now(), updated_at: db.now() }, { id: app.id });
  await activity.log(req, 'review', 'applications', app.id, `تغییر وضعیت ${app.code} به «${STATUSES[status]}»` + (note ? ` — ${note}` : ''));
  if (E('admissions.notify') && req.body.notify === '1' && app.father_phone) {
    const msgs = { reviewing: 'درخواست شما در حال بررسی است.', docs_requested: 'لطفاً مدارک تکمیلی را به دفتر مدرسه تحویل دهید' + (note ? ': ' + note : '.'), accepted: 'درخواست شما پذیرفته شد. برای ثبت‌نام قطعی به مدرسه مراجعه کنید' + (note ? ' — ' + note : '.'), rejected: 'متأسفانه امکان پذیرش در این دوره وجود ندارد' + (note ? ' — ' + note : '.'), pending: 'درخواست شما ثبت شده است.' };
    await notify.sms(app.father_phone, `${settings.get('school_name', '')}\nپیش‌ثبت‌نام ${app.first_name} ${app.last_name} (${app.code}): ${msgs[status]}`, 'admissions');
  }
  req.flash('success', `وضعیت درخواست به «${STATUSES[status]}» تغییر کرد.`);
  res.redirect('/admissions/' + app.id);
});
router.post('/:id/enroll', modules.requireEnabled('admissions.enroll'), async (req, res) => {
  const app = await baseQuery().where('a.id', req.params.id).first();
  if (!app) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  if (app.status === 'enrolled') { req.flash('warning', 'این درخواست قبلاً ثبت‌نام قطعی شده است.'); return res.redirect('/admissions/' + app.id); }
  if (app.status !== 'accepted') { req.flash('danger', 'فقط درخواست‌های «پذیرفته‌شده» قابل ثبت‌نام قطعی هستند. ابتدا وضعیت را به پذیرفته‌شده تغییر دهید.'); return res.redirect('/admissions/' + app.id); }
  const classId = Number(req.body.class_id) || null;
  const cls = classId ? await db.findById('classes', classId) : null;
  if (!cls) { req.flash('danger', 'کلاس را انتخاب کنید.'); return res.redirect('/admissions/' + app.id); }
  if (app.national_id && await db.exists('students', { national_id: app.national_id })) { req.flash('danger', 'دانش‌آموزی با این کد ملی قبلاً ثبت شده است.'); return res.redirect('/admissions/' + app.id); }
  try {
    const data = {
      student_number: await studentsSvc.nextStudentNumber(), national_id: app.national_id, first_name: app.first_name, last_name: app.last_name, birth_date: app.birth_date, birth_place: app.birth_place, gender: app.gender,
      class_id: cls.id, grade_level_id: cls.grade_level_id, enrollment_date: J.todayISO(), status: 'active', address: app.address, postal_code: app.postal_code, home_phone: app.home_phone, email: app.email,
      father_name: app.father_name, father_national_id: app.father_national_id, father_phone: app.father_phone, father_job: app.father_job, father_education: app.father_education,
      mother_name: app.mother_name, mother_phone: app.mother_phone, mother_job: app.mother_job, mother_education: app.mother_education, notes: app.previous_school ? `مدرسهٔ قبلی: ${app.previous_school}${app.previous_average != null ? ' — معدل ' + app.previous_average : ''}` : null, created_at: db.now()
    };
    const acc = await studentsSvc.createUserFor(data, { password: req.body.password });
    data.user_id = acc.userId;
    const sid = await db.insert('students', data);
    await enrollments.ensureActive(sid, cls.id, { userId: req.user.id });
    await db.update('applications', { status: 'enrolled', student_id: sid, class_id: cls.id, reviewed_by: req.user.id, reviewed_at: db.now(), updated_at: db.now() }, { id: app.id });
    await activity.log(req, 'enroll', 'applications', app.id, `ثبت‌نام قطعی ${app.first_name} ${app.last_name} (${app.code}) در ${cls.title}`);
    await activity.log(req, 'create', 'students', sid, `ثبت‌نام ${data.first_name} ${data.last_name} (${data.student_number}) از پیش‌ثبت‌نام ${app.code}`);
    if (E('admissions.notify') && req.body.notify === '1' && app.father_phone) await notify.sms(app.father_phone, `${settings.get('school_name', '')}\nثبت‌نام ${app.first_name} ${app.last_name} در کلاس ${cls.title} قطعی شد.\nنام کاربری: ${acc.username}\nرمز: ${acc.password}`, 'admissions');
    req.flash('success', `ثبت‌نام قطعی انجام شد. شمارهٔ دانش‌آموزی: <code class="ltr">${utils.escapeHtml(data.student_number)}</code> رمز ورود: <code class="ltr">${utils.escapeHtml(acc.password)}</code>`);
    res.redirect('/students/' + sid);
  } catch (e) { req.flash('danger', e.message); res.redirect('/admissions/' + app.id); }
});
router.post('/:id/delete', async (req, res) => {
  const app = await db.findById('applications', req.params.id);
  if (!app) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  if (app.status === 'enrolled') { req.flash('warning', 'درخواست ثبت‌نام‌شده قابل حذف نیست.'); return res.redirect('/admissions/' + app.id); }
  if (app.file_path) upload.removeFile(app.file_path);
  await db.remove('applications', { id: app.id });
  await activity.log(req, 'delete', 'applications', app.id, `حذف درخواست ${app.code}`);
  req.flash('success', 'درخواست حذف شد.'); res.redirect('/admissions');
});

module.exports = router;
module.exports.STATUSES = STATUSES;
