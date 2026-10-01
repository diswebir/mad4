'use strict';
const path = require('path');
const express = require('express');
const db = require('../../core/db');
const auth = require('../../core/auth');
const modules = require('../../core/modules');
const activity = require('../../core/activity');
const utils = require('../../core/utils');
const J = require('../../core/jalali');
const validate = require('../../core/validate');
const upload = require('../../core/upload');
const settings = require('../../core/settings');
const notify = require('../../core/notify');
const fields = require('./fields');

const router = express.Router();
const v = (n) => path.join(__dirname, 'views', n + '.ejs');
router.use(auth.requireAuth);

const E = modules.isEnabled;
const canManage = (req) => req.user.role === 'admin';
const PER_PAGE = 25;

// ---------- کمکی ----------
async function teacherScope(req) {
  if (req.user.role !== 'teacher') return null;
  const t = await db.table('teachers').where('user_id', req.user.id).first();
  if (!t) return [];
  const ids = new Set();
  (await db.table('classes').select('id').where('teacher_id', t.id).all()).forEach((r) => ids.add(r.id));
  (await db.table('class_subjects').select('class_id').where('teacher_id', t.id).all()).forEach((r) => ids.add(r.class_id));
  return [...ids];
}
async function canView(req, student) {
  if (['admin', 'staff'].includes(req.user.role)) return true;
  if (req.user.role === 'student') return student.user_id === req.user.id && E('students.panel');
  const scope = await teacherScope(req);
  return scope && scope.includes(student.class_id);
}
async function nextStudentNumber() {
  const prefix = settings.get('student_number_prefix', '') || '';
  const start = settings.getInt('student_number_next', 1001) || 1001;
  const recent = await db.table('students').select('student_number').orderBy('id', 'desc').limit(50).all();
  let n = start;
  for (const r of recent) {
    const sn = String(r.student_number || '');
    if (prefix && !sn.startsWith(prefix)) continue;
    const num = parseInt(sn.slice(prefix.length), 10);
    if (!Number.isNaN(num) && num >= n) n = num + 1;
  }
  // اطمینان از یکتایی
  while (await db.exists('students', { student_number: prefix + n })) n++;
  await settings.set('student_number_next', String(n + 1));
  return prefix + n;
}
const baseQuery = () => db.table('students as s').leftJoin('classes as c', 'c.id', 's.class_id').leftJoin('grade_levels as g', 'g.id', 's.grade_level_id').leftJoin('users as u', 'u.id', 's.user_id')
  .select('s.*', 'c.title as class_title', 'g.title as grade_title', 'u.username', 'u.last_login_at', 'u.status as user_status');

function collect(req) {
  const names = fields.all.filter((f) => !f.virtual && f.type !== 'file' && f.type !== 'heading').map((f) => f.name);
  const data = utils.cleanBody(req.body, { fields: names, dates: fields.all.filter((f) => f.type === 'date').map((f) => f.name), numbers: fields.all.filter((f) => f.type === 'number').map((f) => f.name) });
  for (const k of ['father_phone', 'mother_phone', 'guardian_phone', 'emergency_phone', 'mobile', 'home_phone']) if (data[k]) data[k] = utils.normalizePhone(data[k]);
  if (!E('students.parents')) for (const k of Object.keys(data)) if (/^(father|mother|guardian)_/.test(k)) delete data[k];
  if (!E('students.emergency')) for (const k of Object.keys(data)) if (/^emergency_/.test(k)) delete data[k];
  if (!E('students.medical')) for (const k of ['blood_type', 'height', 'weight', 'allergies', 'medical_conditions', 'medications', 'insurance_number', 'special_needs']) delete data[k];
  return data;
}
function validateStudent(data, isNew) {
  const val = validate(data);
  val.required('first_name', 'نام').required('last_name', 'نام خانوادگی').required('gender', 'جنسیت');
  if (!isNew || !E('students.auto_number')) val.required('student_number', 'شماره دانش‌آموزی');
  val.nationalId('national_id', 'کد ملی').date('birth_date', 'تاریخ تولد').date('enrollment_date', 'تاریخ ثبت‌نام');
  val.nationalId('father_national_id', 'کد ملی پدر').nationalId('mother_national_id', 'کد ملی مادر');
  for (const [k, l] of [['father_phone', 'موبایل پدر'], ['mother_phone', 'موبایل مادر'], ['guardian_phone', 'موبایل سرپرست'], ['emergency_phone', 'تلفن اضطراری'], ['mobile', 'موبایل دانش‌آموز']]) val.mobile(k, l);
  val.email('email', 'ایمیل');
  return val;
}

// ---------- مسیرهای ثابت (قبل از :id) ----------
router.get('/me', auth.requireRole('student'), modules.requireEnabled('students.panel'), async (req, res) => {
  const s = await db.table('students').where('user_id', req.user.id).first();
  res.redirect(s ? '/students/' + s.id : '/dashboard');
});

router.get('/', auth.requireRole('admin', 'staff', 'teacher'), modules.requireEnabled('students.manage'), async (req, res) => {
  const q = baseQuery();
  const scope = await teacherScope(req);
  if (scope) q.whereIn('s.class_id', scope);
  const search = utils.normalizePersian(req.query.q || '');
  if (search) {
    const cols = E('students.search') ? ['s.first_name', 's.last_name', 's.student_number', 's.national_id', 's.father_name', 's.father_phone', 's.mother_phone', 's.mobile', 's.guardian_phone'] : ['s.first_name', 's.last_name', 's.student_number'];
    const parts = search.split(' ').filter(Boolean);
    if (parts.length > 1) q.where((b) => b.whereRaw("(s.first_name || ' ' || s.last_name) LIKE ?", ['%' + search + '%']).orWhereRaw("(s.last_name || ' ' || s.first_name) LIKE ?", ['%' + search + '%']));
    else q.search(J.toEnglishDigits(search), cols);
  }
  const f = { class_id: req.query.class_id, grade_level_id: req.query.grade_level_id, status: req.query.status || (req.query.all ? '' : 'active'), gender: req.query.gender };
  if (f.class_id) q.where('s.class_id', f.class_id);
  if (f.grade_level_id) q.where('s.grade_level_id', f.grade_level_id);
  if (f.status) q.where('s.status', f.status);
  if (f.gender) q.where('s.gender', f.gender);
  if (req.query.no_class) q.whereNull('s.class_id');
  const sort = ['last_name', 'student_number', 'class_title', 'birth_date', 'id'].includes(req.query.sort) ? req.query.sort : 'last_name';
  q.orderBy(sort === 'class_title' ? 'c.title' : 's.' + sort, req.query.dir === 'desc' ? 'desc' : 'asc').orderBy('s.first_name');
  if (req.query.export === '1' && E('students.export')) {
    const rows = await q.limit(10000).all();
    await activity.log(req, 'export', 'students', null, 'خروجی دانش‌آموزان');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="students-${J.todayISO()}.csv"`);
    return res.send(utils.toCSV(rows, fields.exportColumns()));
  }
  const result = await q.paginate(req.query.page, req.query.per || PER_PAGE);
  const classes = await db.table('classes as c').leftJoin('grade_levels as g', 'g.id', 'c.grade_level_id').select('c.id', 'c.title', 'g.title as grade_title').where('c.is_active', 1).when(scope, (qq) => qq.whereIn('c.id', scope)).orderBy('g.sort_order').orderBy('c.title').all();
  const grades = await db.table('grade_levels').orderBy('sort_order').all();
  res.render(v('index'), { title: 'دانش‌آموزان', result, classes, grades, f, search, sort, dir: req.query.dir || 'asc', canManage: canManage(req), query: req.query });
});

router.get('/new', auth.requireAdmin, modules.requireEnabled('students.manage'), async (req, res) => {
  const row = Object.assign({ enrollment_date: J.todayISO(), status: 'active', nationality: 'ایرانی', guardian_type: 'father' }, req.query);
  if (E('students.auto_number')) row.student_number = await nextStudentNumber();
  res.render(v('form'), { title: 'ثبت‌نام دانش‌آموز جدید', row, isNew: true, sections: await fields.sections(), action: '/students' });
});

router.post('/', auth.requireAdmin, modules.requireEnabled('students.manage'), ...upload.form('students', 'single', 'photo', { images: true, maxMb: 3 }), async (req, res) => {
  if (req.uploadError) { req.flash('danger', req.uploadError); req.keepInput(); return res.redirect('/students/new'); }
  const data = collect(req);
  const val = validateStudent(data, true);
  if (!val.ok) { req.flash('danger', val.message); req.keepInput(); return res.redirect('/students/new'); }
  try {
    if (!data.student_number) data.student_number = await nextStudentNumber();
    if (await db.exists('students', { student_number: data.student_number })) throw new Error('شماره دانش‌آموزی تکراری است');
    if (data.national_id && await db.exists('students', { national_id: data.national_id })) throw new Error('دانش‌آموزی با این کد ملی قبلاً ثبت شده است');
    if (data.class_id && !data.grade_level_id) { const c = await db.findById('classes', data.class_id); if (c) data.grade_level_id = c.grade_level_id; }
    if (req.file && E('students.photo')) data.photo = upload.relPath(req.file);
    // حساب کاربری
    const username = String(data.student_number).toLowerCase();
    if (await db.exists('users', { username })) throw new Error('نام کاربری (شماره دانش‌آموزی) قبلاً استفاده شده است');
    const password = req.body.password && req.body.password.length >= 6 ? req.body.password : (settings.get('student_default_password', '') || (data.national_id || '123456'));
    data.user_id = await db.insert('users', { username, password: await auth.hashPassword(password), role: 'student', name: `${data.first_name} ${data.last_name}`, phone: data.mobile || null, email: data.email || null, status: 'active', must_change_password: settings.get('force_password_change', '0') === '1' ? 1 : 0, created_at: db.now() });
    data.created_at = db.now();
    const id = await db.insert('students', data);
    await activity.log(req, 'create', 'students', id, `ثبت‌نام ${data.first_name} ${data.last_name} (${data.student_number})`);
    req.flash('success', `دانش‌آموز ثبت شد. نام کاربری: <code class="ltr">${username}</code> رمز: <code class="ltr">${utils.escapeHtml(password)}</code>`);
    res.redirect(req.body._another === '1' ? '/students/new?class_id=' + (data.class_id || '') : '/students/' + id);
  } catch (e) { req.flash('danger', e.message); req.keepInput(); res.redirect('/students/new'); }
});

// ---------- ورود گروهی ----------
router.get('/import', auth.requireAdmin, modules.requireEnabled('students.import'), async (req, res) => {
  const classes = await db.table('classes').where('is_active', 1).orderBy('title').all();
  res.render(v('import'), { title: 'ورود گروهی دانش‌آموزان', classes, columns: fields.importColumns() });
});
router.get('/import/template', auth.requireAdmin, modules.requireEnabled('students.import'), (req, res) => {
  const cols = fields.importColumns();
  const sample = [{ first_name: 'علی', last_name: 'محمدی', gender: 'male', national_id: '0012345678', birth_date: '1391/04/15', father_name: 'رضا', father_phone: '09121234567', mother_name: 'مریم', mother_phone: '09123456789', address: 'تهران، خیابان آزادی' }];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="students-template.csv"');
  res.send(utils.toCSV(sample, cols.map((c) => ({ label: c.key, value: (r) => r[c.key] || '' }))));
});
router.post('/import', auth.requireAdmin, modules.requireEnabled('students.import'), ...upload.form('imports', 'single', 'file', { maxMb: 10 }), async (req, res) => {
  if (req.uploadError || !req.file) { req.flash('danger', req.uploadError || 'فایلی انتخاب نشده'); return res.redirect('/students/import'); }
  const fs = require('fs');
  let text = fs.readFileSync(req.file.path, 'utf8'); upload.removeFile(upload.relPath(req.file));
  const rows = utils.parseCSVObjects(text);
  const classId = req.body.class_id ? Number(req.body.class_id) : null;
  const cls = classId ? await db.findById('classes', classId) : null;
  const report = { ok: 0, skipped: 0, errors: [] };
  const labelMap = Object.fromEntries(fields.importColumns().map((c) => [c.label, c.key]));
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i]; const r = {};
    for (const [k, val] of Object.entries(raw)) { const key = labelMap[k] || k; r[key] = val; }
    const data = utils.cleanBody(r, { fields: fields.importColumns().map((c) => c.key), dates: ['birth_date', 'enrollment_date'] });
    if (data.gender) data.gender = /^(f|female|دختر|زن)$/i.test(data.gender) ? 'female' : 'male';
    const val = validateStudent(data, true);
    if (!val.ok) { report.errors.push(`ردیف ${J.toPersianDigits(i + 2)}: ${val.message}`); continue; }
    if (data.national_id && await db.exists('students', { national_id: data.national_id })) { report.skipped++; continue; }
    try {
      if (!data.student_number) data.student_number = await nextStudentNumber();
      if (cls) { data.class_id = cls.id; data.grade_level_id = cls.grade_level_id; }
      data.status = 'active'; data.enrollment_date = data.enrollment_date || J.todayISO();
      const username = String(data.student_number).toLowerCase();
      const password = settings.get('student_default_password', '') || data.national_id || '123456';
      data.user_id = await db.insert('users', { username, password: await auth.hashPassword(password), role: 'student', name: `${data.first_name} ${data.last_name}`, phone: data.mobile || null, status: 'active', created_at: db.now() });
      data.created_at = db.now();
      await db.insert('students', data); report.ok++;
    } catch (e) { report.errors.push(`ردیف ${J.toPersianDigits(i + 2)}: ${e.message}`); }
  }
  await activity.log(req, 'import', 'students', null, `ورود گروهی: ${report.ok} موفق، ${report.skipped} تکراری، ${report.errors.length} خطا`);
  req.flash(report.errors.length ? 'warning' : 'success', `${J.toPersianDigits(report.ok)} دانش‌آموز ثبت شد، ${J.toPersianDigits(report.skipped)} تکراری نادیده گرفته شد.` + (report.errors.length ? '<br>' + report.errors.slice(0, 15).map(utils.escapeHtml).join('<br>') : ''));
  res.redirect('/students' + (classId ? '?class_id=' + classId : ''));
});

// ---------- پرونده ----------
router.get('/:id', async (req, res) => {
  const s = await baseQuery().where('s.id', req.params.id).first();
  if (!s) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  if (!(await canView(req, s))) return res.status(403).render('errors/403', { title: 'دسترسی غیرمجاز' });
  const isStudent = req.user.role === 'student';
  const data = { s, isStudent, canManage: canManage(req), isTeacher: req.user.role === 'teacher', att: null, attTotal: 0, attRecent: [], grades: null, avg: null, discipline: null, points: 0, notes: null, documents: null, transfers: null, invoices: null, due: 0, tickets: null, health: null, counseling: null, loans: null, hwStats: null, route: null, siblings: null, timeline: null };
  data.homeroom = s.class_id ? await db.table('classes as c').leftJoin('teachers as t', 't.id', 'c.teacher_id').leftJoin('users as u', 'u.id', 't.user_id').select('u.name', 't.id as teacher_id', 'u.phone').where('c.id', s.class_id).first() : null;
  if (E('attendance')) {
    const att = await db.table('attendance').select('status', 'COUNT(*) as c').where('student_id', s.id).groupBy('status').all();
    data.att = Object.fromEntries(att.map((a) => [a.status, Number(a.c)]));
    data.attTotal = att.reduce((a, r) => a + Number(r.c), 0);
    data.attRecent = await db.table('attendance as a').leftJoin('class_subjects as cs', 'cs.id', 'a.class_subject_id').leftJoin('subjects as sb', 'sb.id', 'cs.subject_id').select('a.*', 'sb.title as subject_title').where('a.student_id', s.id).where('a.status', '!=', 'present').orderBy('a.date', 'desc').limit(12).all();
  }
  if (E('exams') && (!isStudent || E('exams.student_view'))) {
    data.grades = await db.table('grades as g').join('exams as e', 'e.id', 'g.exam_id').join('subjects as sb', 'sb.id', 'e.subject_id').select('g.*', 'e.title as exam_title', 'e.date', 'e.max_score', 'e.type', 'sb.title as subject_title').where('g.student_id', s.id).where('e.is_published', 1).orderBy('e.date', 'desc').limit(15).all();
    const avg = await db.table('grades as g').join('exams as e', 'e.id', 'g.exam_id').select('AVG(g.score * 20.0 / e.max_score) as avg').where('g.student_id', s.id).whereNotNull('g.score').first();
    data.avg = avg && avg.avg != null ? Math.round(avg.avg * 100) / 100 : null;
  }
  if (E('discipline')) { data.discipline = await db.table('discipline_records as d').leftJoin('users as u', 'u.id', 'd.recorded_by').select('d.*', 'u.name as by_name').where('d.student_id', s.id).orderBy('d.date', 'desc').limit(10).all(); data.points = await db.table('discipline_records').where('student_id', s.id).sum('points'); }
  if (E('students.notes')) { const nq = db.table('student_notes as n').leftJoin('users as u', 'u.id', 'n.author_id').select('n.*', 'u.name as author_name').where('n.student_id', s.id).orderBy('n.id', 'desc'); if (isStudent) nq.where('n.is_private', 0); data.notes = await nq.all(); }
  if (E('students.documents')) data.documents = await db.table('student_documents').where('student_id', s.id).orderBy('id', 'desc').all();
  if (E('students.transfer')) data.transfers = await db.table('student_transfers as t').leftJoin('classes as c1', 'c1.id', 't.from_class_id').leftJoin('classes as c2', 'c2.id', 't.to_class_id').leftJoin('users as u', 'u.id', 't.transferred_by').select('t.*', 'c1.title as from_title', 'c2.title as to_title', 'u.name as by_name').where('t.student_id', s.id).orderBy('t.id', 'desc').all();
  if (E('finance') && !data.isTeacher) { data.invoices = await db.table('invoices').where('student_id', s.id).orderBy('id', 'desc').limit(10).all(); data.due = await db.table('invoices').where('student_id', s.id).whereIn('status', ['unpaid', 'partial']).sum('amount') - await db.table('invoices').where('student_id', s.id).whereIn('status', ['unpaid', 'partial']).sum('paid_amount'); }
  if (E('tickets')) data.tickets = await db.table('tickets').where('student_id', s.id).orderBy('id', 'desc').limit(8).all();
  if (E('health') && !data.isTeacher) data.health = await db.table('health_records').where('student_id', s.id).orderBy('date', 'desc').limit(6).all();
  if (E('counseling') && canManage(req)) data.counseling = await db.table('counseling_sessions').where('student_id', s.id).orderBy('date', 'desc').limit(6).all();
  if (E('library')) data.loans = await db.table('book_loans as l').join('books as b', 'b.id', 'l.book_id').select('l.*', 'b.title').where('l.student_id', s.id).orderBy('l.id', 'desc').limit(6).all();
  if (E('homework') && E('homework.submit')) data.hwStats = await db.table('homework_submissions').select('status', 'COUNT(*) as c').where('student_id', s.id).groupBy('status').all();
  if (E('transport') && s.transport_route_id) data.route = await db.findById('transport_routes', s.transport_route_id);
  if (E('students.siblings') && !isStudent) {
    const ids = [s.father_national_id, s.mother_national_id].filter(Boolean);
    data.siblings = ids.length ? await db.table('students as x').leftJoin('classes as c', 'c.id', 'x.class_id').select('x.id', 'x.first_name', 'x.last_name', 'x.photo', 'c.title as class_title').where('x.id', '!=', s.id).where((b) => { if (s.father_national_id) b.orWhere('x.father_national_id', s.father_national_id); if (s.mother_national_id) b.orWhere('x.mother_national_id', s.mother_national_id); }).all() : [];
  }
  if (E('students.timeline')) {
    const tl = [];
    (data.attRecent || []).slice(0, 5).forEach((a) => tl.push({ date: a.date, icon: 'bi-clipboard-x', color: utils.ATT_COLORS[a.status], text: `${utils.ATT_STATUS[a.status]}${a.subject_title ? ' — ' + a.subject_title : ''}` }));
    (data.grades || []).slice(0, 5).forEach((g) => tl.push({ date: g.date, icon: 'bi-award', color: 'primary', text: `${g.subject_title}: ${g.score != null ? J.toPersianDigits(g.score) + ' از ' + J.toPersianDigits(g.max_score) : (utils.DESCRIPTIVE_GRADES[g.descriptive] || g.descriptive || '—')}` }));
    (data.discipline || []).slice(0, 5).forEach((d) => tl.push({ date: d.date, icon: d.type === 'positive' ? 'bi-hand-thumbs-up' : 'bi-exclamation-triangle', color: d.type === 'positive' ? 'success' : 'danger', text: (d.category || '') + (d.description ? ': ' + utils.truncate(d.description, 60) : '') }));
    (data.tickets || []).slice(0, 3).forEach((t) => tl.push({ date: t.created_at, icon: 'bi-chat-left-text', color: 'info', text: 'تیکت: ' + t.subject }));
    (data.transfers || []).slice(0, 3).forEach((t) => tl.push({ date: t.created_at, icon: 'bi-arrow-left-right', color: 'secondary', text: `انتقال ${t.from_title || '—'} → ${t.to_title || '—'}` }));
    data.timeline = tl.filter((x) => x.date).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 12);
  }
  data.classes = canManage(req) ? await db.table('classes').where('is_active', 1).orderBy('title').all() : [];
  const print = req.query.print === '1' && E('students.profile_print') && !isStudent;
  res.render(v(print ? 'print' : 'show'), Object.assign({ title: `${s.first_name} ${s.last_name}`, layout: print ? 'layouts/print' : undefined, tab: req.query.tab || 'overview' }, data));
});

router.get('/:id/card', modules.requireEnabled('students.id_card'), async (req, res) => {
  const s = await baseQuery().where('s.id', req.params.id).first();
  if (!s) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  if (!(await canView(req, s))) return res.status(403).render('errors/403', { title: 'دسترسی غیرمجاز' });
  const year = await db.table('academic_years').where('is_current', 1).first();
  res.render(v('card'), { title: 'کارت دانش‌آموزی', layout: 'layouts/print', students: [s], year });
});
router.get('/cards/class/:classId', auth.requireRole('admin', 'staff'), modules.requireEnabled('students.id_card'), async (req, res) => {
  const students = await baseQuery().where('s.class_id', req.params.classId).where('s.status', 'active').orderBy('s.last_name').all();
  const year = await db.table('academic_years').where('is_current', 1).first();
  res.render(v('card'), { title: 'کارت‌های دانش‌آموزی کلاس', layout: 'layouts/print', students, year });
});

router.get('/:id/edit', auth.requireAdmin, modules.requireEnabled('students.manage'), async (req, res) => {
  const row = await db.findById('students', req.params.id);
  if (!row) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  res.render(v('form'), { title: 'ویرایش پرونده', row, isNew: false, sections: await fields.sections(), action: '/students/' + row.id });
});
router.post('/:id', auth.requireAdmin, modules.requireEnabled('students.manage'), ...upload.form('students', 'single', 'photo', { images: true, maxMb: 3 }), async (req, res) => {
  const row = await db.findById('students', req.params.id);
  if (!row) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  if (req.uploadError) { req.flash('danger', req.uploadError); return res.redirect(`/students/${row.id}/edit`); }
  const data = collect(req);
  const val = validateStudent(data, false);
  if (!val.ok) { req.flash('danger', val.message); req.keepInput(); return res.redirect(`/students/${row.id}/edit`); }
  try {
    const dup = await db.table('students').where('student_number', data.student_number).where('id', '!=', row.id).first();
    if (dup) throw new Error('شماره دانش‌آموزی تکراری است');
    if (data.class_id && Number(data.class_id) !== Number(row.class_id)) {
      const c = await db.findById('classes', data.class_id); if (c) data.grade_level_id = c.grade_level_id;
      if (E('students.transfer')) await db.insert('student_transfers', { student_id: row.id, from_class_id: row.class_id, to_class_id: data.class_id, reason: 'ویرایش پرونده', transferred_by: req.user.id, created_at: db.now() });
    }
    if (req.file && E('students.photo')) { upload.removeFile(row.photo); data.photo = upload.relPath(req.file); }
    else if (req.body.remove_photo === '1') { upload.removeFile(row.photo); data.photo = null; }
    data.updated_at = db.now();
    await db.update('students', data, { id: row.id });
    const u = { name: `${data.first_name} ${data.last_name}`, phone: data.mobile || null, email: data.email || null, username: String(data.student_number).toLowerCase(), updated_at: db.now() };
    if (req.body.password && req.body.password.length >= 6) u.password = await auth.hashPassword(req.body.password);
    if (row.user_id) await db.update('users', u, { id: row.user_id });
    await activity.log(req, 'update', 'students', row.id, `ویرایش پرونده ${data.first_name} ${data.last_name}`);
    req.flash('success', 'پرونده به‌روزرسانی شد.');
    res.redirect('/students/' + row.id);
  } catch (e) { req.flash('danger', e.message); req.keepInput(); res.redirect(`/students/${row.id}/edit`); }
});
router.post('/:id/delete', auth.requireAdmin, modules.requireEnabled('students.manage'), async (req, res) => {
  const row = await db.findById('students', req.params.id);
  if (!row) return res.redirect('/students');
  await db.transaction(async (tx) => {
    for (const t of ['attendance', 'grades', 'homework_submissions', 'discipline_records', 'student_notes', 'student_documents', 'student_transfers', 'absence_excuses', 'health_records', 'counseling_sessions', 'book_loans', 'invoices', 'payments']) await tx.remove(t, { student_id: row.id }).catch(() => {});
    await tx.remove('students', { id: row.id });
    if (row.user_id) { await tx.remove('tickets', { created_by: row.user_id }).catch(() => {}); await tx.remove('users', { id: row.user_id }); }
  });
  upload.removeFile(row.photo);
  await activity.log(req, 'delete', 'students', row.id, `حذف پرونده ${row.first_name} ${row.last_name}`);
  req.flash('success', 'پروندهٔ دانش‌آموز و حساب کاربری او حذف شد.');
  res.redirect('/students');
});

// ---------- عملیات پرونده ----------
router.post('/:id/status', auth.requireAdmin, modules.requireEnabled('students.status'), async (req, res) => {
  const row = await db.findById('students', req.params.id);
  if (!row) return res.redirect('/students');
  const status = utils.STUDENT_STATUS[req.body.status] ? req.body.status : 'active';
  await db.update('students', { status, updated_at: db.now() }, { id: row.id });
  if (row.user_id) await db.update('users', { status: status === 'active' ? 'active' : 'inactive' }, { id: row.user_id });
  if (req.body.note && E('students.notes')) await db.insert('student_notes', { student_id: row.id, author_id: req.user.id, content: `تغییر وضعیت به «${utils.STUDENT_STATUS[status]}»: ${utils.normalizePersian(req.body.note)}`, type: 'status', is_private: 1, created_at: db.now() });
  await activity.log(req, 'update', 'students', row.id, `وضعیت ${row.first_name} ${row.last_name} → ${utils.STUDENT_STATUS[status]}`);
  req.flash('success', 'وضعیت تحصیلی به‌روزرسانی شد.'); res.redirect('/students/' + row.id);
});
router.post('/:id/transfer', auth.requireAdmin, modules.requireEnabled('students.transfer'), async (req, res) => {
  const row = await db.findById('students', req.params.id);
  const cls = await db.findById('classes', req.body.class_id);
  if (!row || !cls) { req.flash('danger', 'کلاس نامعتبر'); return res.redirect('/students/' + req.params.id); }
  await db.update('students', { class_id: cls.id, grade_level_id: cls.grade_level_id, updated_at: db.now() }, { id: row.id });
  await db.insert('student_transfers', { student_id: row.id, from_class_id: row.class_id, to_class_id: cls.id, reason: utils.normalizePersian(req.body.reason) || null, transferred_by: req.user.id, created_at: db.now() });
  if (row.user_id && E('notifications.inapp')) await notify.push([row.user_id], { title: 'انتقال کلاس', body: `شما به کلاس «${cls.title}» منتقل شدید.`, link: '/students/me', type: 'info' });
  await activity.log(req, 'transfer', 'students', row.id, `انتقال ${row.first_name} ${row.last_name} به ${cls.title}`);
  req.flash('success', `دانش‌آموز به کلاس «${cls.title}» منتقل شد.`); res.redirect('/students/' + row.id + '?tab=history');
});
router.post('/:id/notes', auth.requireRole('admin', 'teacher', 'staff'), modules.requireEnabled('students.notes'), async (req, res) => {
  const row = await db.findById('students', req.params.id);
  if (!row || !(await canView(req, row))) return res.status(403).render('errors/403', { title: 'دسترسی غیرمجاز' });
  const content = utils.normalizePersian(req.body.content || '');
  if (content.length < 2) { req.flash('danger', 'متن یادداشت خالی است'); return res.redirect(`/students/${row.id}?tab=notes`); }
  await db.insert('student_notes', { student_id: row.id, author_id: req.user.id, content, type: req.body.type || 'general', is_private: req.body.is_private === '0' ? 0 : 1, created_at: db.now() });
  if (req.body.is_private === '0' && row.user_id && E('notifications.inapp')) await notify.push([row.user_id], { title: 'یادداشت جدید در پرونده', body: utils.truncate(content, 80), link: '/students/me?tab=notes', type: 'info' });
  req.flash('success', 'یادداشت ثبت شد.'); res.redirect(`/students/${row.id}?tab=notes`);
});
router.post('/:id/notes/:nid/delete', auth.requireRole('admin', 'teacher'), modules.requireEnabled('students.notes'), async (req, res) => {
  const n = await db.table('student_notes').where({ id: req.params.nid, student_id: req.params.id }).first();
  if (n && (req.user.role === 'admin' || n.author_id === req.user.id)) await db.remove('student_notes', { id: n.id });
  res.redirect(`/students/${req.params.id}?tab=notes`);
});
router.post('/:id/documents', auth.requireAdmin, modules.requireEnabled('students.documents'), ...upload.form('students/docs', 'single', 'file', { maxMb: 10 }), async (req, res) => {
  const row = await db.findById('students', req.params.id);
  if (!row) return res.redirect('/students');
  if (req.uploadError || !req.file) { req.flash('danger', req.uploadError || 'فایلی انتخاب نشده'); return res.redirect(`/students/${row.id}?tab=docs`); }
  await db.insert('student_documents', { student_id: row.id, title: utils.normalizePersian(req.body.title) || req.file.originalname, file_path: upload.relPath(req.file), file_name: req.file.originalname, mime: req.file.mimetype, size: req.file.size, uploaded_by: req.user.id, created_at: db.now() });
  req.flash('success', 'مدرک بارگذاری شد.'); res.redirect(`/students/${row.id}?tab=docs`);
});
router.post('/:id/documents/:did/delete', auth.requireAdmin, modules.requireEnabled('students.documents'), async (req, res) => {
  const d = await db.table('student_documents').where({ id: req.params.did, student_id: req.params.id }).first();
  if (d) { upload.removeFile(d.file_path); await db.remove('student_documents', { id: d.id }); req.flash('success', 'مدرک حذف شد.'); }
  res.redirect(`/students/${req.params.id}?tab=docs`);
});
router.post('/:id/photo', auth.requireAdmin, modules.requireEnabled('students.photo'), ...upload.form('students', 'single', 'photo', { images: true, maxMb: 3 }), async (req, res) => {
  const row = await db.findById('students', req.params.id);
  if (!row) return res.redirect('/students');
  if (req.uploadError || !req.file) { req.flash('danger', req.uploadError || 'عکسی انتخاب نشده'); return res.redirect('/students/' + row.id); }
  upload.removeFile(row.photo);
  await db.update('students', { photo: upload.relPath(req.file), updated_at: db.now() }, { id: row.id });
  if (row.user_id) await db.update('users', { avatar: upload.relPath(req.file) }, { id: row.user_id });
  req.flash('success', 'عکس به‌روزرسانی شد.'); res.redirect('/students/' + row.id);
});
router.post('/:id/reset-password', auth.requireAdmin, modules.requireEnabled('students.user_account'), async (req, res) => {
  const row = await db.findById('students', req.params.id);
  if (!row || !row.user_id) return res.redirect('/students');
  const pw = req.body.password && req.body.password.length >= 6 ? req.body.password : utils.randomDigits(6);
  await db.update('users', { password: await auth.hashPassword(pw), must_change_password: 1, status: 'active', updated_at: db.now() }, { id: row.user_id });
  await activity.log(req, 'password', 'users', row.user_id, `بازنشانی رمز دانش‌آموز ${row.first_name} ${row.last_name}`);
  req.flash('success', `رمز جدید: <code class="ltr">${utils.escapeHtml(pw)}</code> (دانش‌آموز در ورود بعدی باید آن را تغییر دهد)`);
  res.redirect('/students/' + row.id);
});

module.exports = router;
