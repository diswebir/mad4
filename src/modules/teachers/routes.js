'use strict';
const path = require('path');
const express = require('express');
const db = require('../../core/db');
const auth = require('../../core/auth');
const modules = require('../../core/modules');
const activity = require('../../core/activity');
const utils = require('../../core/utils');
const J = require('../../core/jalali');
const crud = require('../../core/crud');
const upload = require('../../core/upload');
const settings = require('../../core/settings');

const router = express.Router();
const v = (n) => path.join(__dirname, 'views', n + '.ejs');
router.use(auth.requireAuth);

const myTeacher = async (req) => (req.user.role === 'teacher' ? db.table('teachers').where('user_id', req.user.id).first() : null);

// ---- مسیرهای ویژه (قبل از CRUD) ----
router.get('/my-classes', auth.requireRole('teacher'), modules.requireEnabled('teachers.my_classes'), async (req, res) => {
  const t = await myTeacher(req);
  if (!t) return res.status(404).render('errors/404', { title: 'پروندهٔ معلم یافت نشد' });
  const homeroom = await db.table('classes as c').leftJoin('grade_levels as g', 'g.id', 'c.grade_level_id').select('c.*', 'g.title as grade_title', '(SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.status = \'active\') as cnt').where('c.teacher_id', t.id).where('c.is_active', 1).orderBy('c.title').all();
  const teaching = await db.table('class_subjects as cs').join('classes as c', 'c.id', 'cs.class_id').join('subjects as s', 's.id', 'cs.subject_id').leftJoin('grade_levels as g', 'g.id', 'c.grade_level_id')
    .select('cs.*', 'c.title as class_title', 'g.title as grade_title', 's.title as subject_title', '(SELECT COUNT(*) FROM students st WHERE st.class_id = c.id AND st.status = \'active\') as cnt',
      '(SELECT COUNT(*) FROM exams e WHERE e.class_subject_id = cs.id) as exams', '(SELECT COUNT(*) FROM homework h WHERE h.class_subject_id = cs.id) as homework').where('cs.teacher_id', t.id).where('c.is_active', 1).orderBy('c.title').orderBy('s.title').all();
  const today = J.weekdayIndex(J.todayISO());
  const todaySlots = modules.isEnabled('academic.schedule') ? await db.table('schedule_slots as ss').join('class_subjects as cs', 'cs.id', 'ss.class_subject_id').join('subjects as s', 's.id', 'cs.subject_id').join('classes as c', 'c.id', 'ss.class_id').select('ss.*', 's.title as subject_title', 'c.title as class_title').where('cs.teacher_id', t.id).where('ss.day_of_week', today).orderBy('ss.period').all() : [];
  res.render(v('my-classes'), { title: 'کلاس‌های من', teacher: t, homeroom, teaching, todaySlots });
});
router.get('/directory', auth.requireRole('teacher', 'admin', 'staff'), modules.requireEnabled('teachers.directory'), async (req, res) => {
  const rows = await db.table('teachers as t').join('users as u', 'u.id', 't.user_id').select('t.id', 't.field', 't.education', 'u.name', 'u.phone', 'u.email', 'u.avatar').where('t.status', 'active').orderBy('u.name').all();
  res.render(v('directory'), { title: 'دفترچهٔ تماس همکاران', rows });
});
router.get('/me', auth.requireRole('teacher'), async (req, res) => { const t = await myTeacher(req); res.redirect(t ? '/teachers/' + t.id : '/dashboard'); });

// ---- CRUD ----
crud(router, {
  path: '', table: 'teachers', alias: 't', title: 'معلم', plural: 'معلمان', icon: 'bi-person-video3', feature: 'teachers.manage', roles: ['admin'], viewRoles: ['admin', 'staff'], orderBy: 'u.name', dir: 'asc', labelField: 'name', exportFeature: 'teachers.export', uploadFolder: 'teachers',
  query: (q) => q.join('users as u', 'u.id', 't.user_id').select('t.*', 'u.name', 'u.username', 'u.phone', 'u.email', 'u.avatar', 'u.avatar as photo', 'u.status as user_status', 'u.last_login_at',
    '(SELECT COUNT(*) FROM classes c WHERE c.teacher_id = t.id AND c.is_active = 1) as homeroom_count', '(SELECT COUNT(*) FROM class_subjects cs WHERE cs.teacher_id = t.id) as subjects_count', '(SELECT COALESCE(SUM(cs.weekly_hours),0) FROM class_subjects cs WHERE cs.teacher_id = t.id) as hours'),
  fields: [
    { name: '_acc', label: 'حساب کاربری', type: 'heading', icon: 'bi-person-badge' },
    { name: 'name', label: 'نام و نام خانوادگی', type: 'text', required: true, list: true, search: true, searchColumn: 'u.name', virtual: true, format: (val, r) => `<a href="/teachers/${r.id}" class="d-flex align-items-center gap-2 fw-semibold"><span class="avatar avatar-sm" style="background:${utils.colorFor(val)}">${r.avatar ? `<img src="/files/${r.avatar}" alt="">` : utils.initials(val)}</span>${utils.escapeHtml(val)}</a>` },
    { name: 'username', label: 'نام کاربری', type: 'username', required: true, virtual: true, help: 'برای ورود معلم؛ مثال: t1001', search: true, searchColumn: 'u.username' },
    { name: 'password', label: 'رمز عبور', type: 'password', virtual: true, help: 'در ویرایش برای حفظ رمز فعلی خالی بگذارید' },
    { name: 'phone', label: 'موبایل', type: 'tel', virtual: true, list: true, searchColumn: 'u.phone', search: true, format: (val) => `<span class="ltr d-inline-block">${J.toPersianDigits(val || '—')}</span>` },
    { name: 'email', label: 'ایمیل', type: 'email', virtual: true },
    { name: 'photo', label: 'عکس پرسنلی', type: 'file', images: true, accept: 'image/*', col: 6 },
    { name: '_info', label: 'اطلاعات پرسنلی', type: 'heading', icon: 'bi-card-list' },
    { name: 'personnel_code', label: 'کد پرسنلی', type: 'en', list: true, search: true, col: 3, format: (val) => `<span class="ltr d-inline-block">${J.toPersianDigits(val || '—')}</span>` },
    { name: 'national_id', label: 'کد ملی', type: 'en', nationalId: true, col: 3 },
    { name: 'gender', label: 'جنسیت', type: 'select', options: utils.GENDERS_ADULT, col: 3, filter: true },
    { name: 'birth_date', label: 'تاریخ تولد', type: 'date', col: 3 },
    { name: 'education', label: 'مدرک تحصیلی', type: 'select', options: utils.EDUCATIONS, col: 4, list: true },
    { name: 'field', label: 'رشته / تخصص', type: 'text', col: 4, list: true, search: true },
    { name: 'hire_date', label: 'تاریخ استخدام', type: 'date', col: 4 },
    { name: 'employment_type', label: 'نوع همکاری', type: 'select', options: { official: 'رسمی', contract: 'پیمانی', hourly: 'حق‌التدریس', parttime: 'پاره‌وقت' }, col: 4, filter: true },
    { name: 'status', label: 'وضعیت', type: 'select', options: { active: 'فعال', inactive: 'غیرفعال', leave: 'مرخصی بلندمدت' }, default: 'active', col: 4, list: true, filter: true, format: (val) => utils.statusBadge(val, { active: 'فعال', inactive: 'غیرفعال', leave: 'مرخصی' }) },
    { name: 'address', label: 'نشانی', type: 'textarea', rows: 2, col: 12 },
    { name: 'bio', label: 'دربارهٔ معلم / سوابق', type: 'textarea', rows: 3, col: 12 },
    { name: 'hours', label: 'ساعت/هفته', type: 'number', virtual: true, hideInForm: true, list: true, format: (val, r) => `<span class="badge badge-soft-primary">${J.toPersianDigits(val || 0)} س</span> <span class="fs-7 text-secondary">${J.toPersianDigits(r.homeroom_count || 0)} راهنما · ${J.toPersianDigits(r.subjects_count || 0)} درس</span>` }
  ],
  validate: (val, data, req) => {
    const b = req.body;
    val.custom(b.name && String(b.name).trim().length >= 3, 'نام معلم الزامی است');
    val.custom(/^[a-zA-Z0-9_.]{3,40}$/.test(b.username || ''), 'نام کاربری باید ۳ تا ۴۰ کاراکتر لاتین باشد');
    if (b.phone && !utils.isValidMobile(b.phone)) val.custom(false, 'شماره موبایل معتبر نیست');
    if (b.email && !utils.isValidEmail(b.email)) val.custom(false, 'ایمیل معتبر نیست');
  },
  beforeSave: async (data, req, isNew, row) => {
    const b = req.body;
    const u = { name: utils.normalizePersian(b.name), username: String(b.username).toLowerCase().trim(), phone: b.phone ? utils.normalizePhone(b.phone) : null, email: b.email || null, role: 'teacher' };
    if (data.photo !== undefined) { u.avatar = data.photo; } delete data.photo;
    if (isNew) {
      if (!b.password || b.password.length < 6) throw new Error('رمز عبور باید حداقل ۶ کاراکتر باشد');
      if (await db.exists('users', { username: u.username })) throw new Error('این نام کاربری قبلاً استفاده شده است');
      u.password = await auth.hashPassword(b.password); u.status = 'active'; u.must_change_password = settings.get('force_password_change', '0') === '1' ? 1 : 0; u.created_at = db.now();
      data.user_id = await db.insert('users', u);
      if (!data.personnel_code) data.personnel_code = String(1000 + data.user_id);
    } else {
      const dup = await db.table('users').where('username', u.username).where('id', '!=', row.user_id).first();
      if (dup) throw new Error('این نام کاربری قبلاً استفاده شده است');
      if (b.password) { if (b.password.length < 6) throw new Error('رمز عبور باید حداقل ۶ کاراکتر باشد'); u.password = await auth.hashPassword(b.password); }
      u.status = data.status === 'inactive' ? 'inactive' : 'active'; u.updated_at = db.now();
      await db.update('users', u, { id: row.user_id });
    }
    return data;
  },
  beforeDelete: async (row) => {
    if (await db.exists('classes', { teacher_id: row.id })) return 'این معلم سرپرست کلاس است؛ ابتدا کلاس را ویرایش کنید';
    if (await db.exists('class_subjects', { teacher_id: row.id })) return 'به این معلم درس تخصیص داده شده است؛ ابتدا تخصیص‌ها را حذف کنید';
    return true;
  },
  afterDelete: async (row) => { await db.remove('teacher_documents', { teacher_id: row.id }); await db.remove('users', { id: row.user_id }); },
  afterSaveRedirect: (id) => '/teachers/' + id,
  rowActions: (row) => [{ href: '/teachers/' + row.id, icon: 'bi-eye', label: 'پرونده' }, ...(modules.isEnabled('academic.schedule') ? [{ href: '/academic/schedule/teacher/' + row.id, icon: 'bi-table', label: 'برنامه' }] : [])],
  pageActions: () => (modules.isEnabled('teachers.workload') ? [{ href: '/teachers/workload', label: 'بار کاری', icon: 'bi-bar-chart-steps', class: 'btn-outline-primary' }] : [])
});

// ---- بار کاری ----
router.get('/workload', auth.requireRole('admin', 'staff'), modules.requireEnabled('teachers.workload'), async (req, res) => {
  const rows = await db.table('teachers as t').join('users as u', 'u.id', 't.user_id').select('t.id', 't.employment_type', 'u.name',
    '(SELECT COALESCE(SUM(cs.weekly_hours),0) FROM class_subjects cs WHERE cs.teacher_id = t.id) as hours', '(SELECT COUNT(*) FROM class_subjects cs WHERE cs.teacher_id = t.id) as subjects', '(SELECT COUNT(DISTINCT cs.class_id) FROM class_subjects cs WHERE cs.teacher_id = t.id) as classes',
    '(SELECT COUNT(*) FROM schedule_slots ss JOIN class_subjects cs ON cs.id = ss.class_subject_id WHERE cs.teacher_id = t.id) as slots', '(SELECT COUNT(*) FROM classes c WHERE c.teacher_id = t.id AND c.is_active = 1) as homeroom').where('t.status', 'active').orderBy('hours', 'desc').all();
  const max = Number(settings.get('max_weekly_hours', 24)) || 24;
  res.render(v('workload'), { title: 'بار کاری معلمان', rows, max });
});

// ---- پرونده ----
router.get('/:id', modules.requireEnabled('teachers.profile'), async (req, res) => {
  const t = await db.table('teachers as t').join('users as u', 'u.id', 't.user_id').select('t.*', 'u.name', 'u.username', 'u.phone', 'u.email', 'u.avatar', 'u.last_login_at', 'u.login_count', 'u.status as user_status').where('t.id', req.params.id).first();
  if (!t) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const mine = req.user.role === 'teacher' && t.user_id === req.user.id;
  if (!['admin', 'staff'].includes(req.user.role) && !mine) return res.status(403).render('errors/403', { title: 'دسترسی غیرمجاز' });
  const homeroom = await db.table('classes as c').leftJoin('grade_levels as g', 'g.id', 'c.grade_level_id').select('c.*', 'g.title as grade_title', '(SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.status = \'active\') as cnt').where('c.teacher_id', t.id).orderBy('c.is_active', 'desc').all();
  const teaching = await db.table('class_subjects as cs').join('classes as c', 'c.id', 'cs.class_id').join('subjects as s', 's.id', 'cs.subject_id').select('cs.*', 'c.title as class_title', 's.title as subject_title').where('cs.teacher_id', t.id).orderBy('c.title').all();
  const documents = modules.isEnabled('teachers.documents') ? await db.table('teacher_documents').where('teacher_id', t.id).orderBy('id', 'desc').all() : [];
  const leaves = modules.isEnabled('hr.leaves') ? await db.table('leave_requests').where('user_id', t.user_id).orderBy('id', 'desc').limit(8).all() : [];
  const staffAtt = modules.isEnabled('attendance.staff') ? await db.table('staff_attendance').select('status', 'COUNT(*) as c').where('user_id', t.user_id).groupBy('status').all() : [];
  const hours = teaching.reduce((a, r) => a + Number(r.weekly_hours || 0), 0);
  const tickets = modules.isEnabled('tickets') ? await db.count('tickets', { assigned_to: t.user_id, status: 'open' }) : 0;
  res.render(v('show'), { title: t.name, t, homeroom, teaching, documents, leaves, staffAtt, hours, tickets, mine, isAdmin: req.user.role === 'admin' });
});

// ---- مدارک ----
router.post('/:id/documents', auth.requireRole('admin', 'teacher'), modules.requireEnabled('teachers.documents'), ...upload.form('teachers/docs', 'single', 'file', { maxMb: 10 }), async (req, res) => {
  const t = await db.findById('teachers', req.params.id);
  if (!t || (req.user.role === 'teacher' && t.user_id !== req.user.id)) return res.status(403).render('errors/403', { title: 'دسترسی غیرمجاز' });
  if (req.uploadError || !req.file) { req.flash('danger', req.uploadError || 'فایلی انتخاب نشده است'); return res.redirect(`/teachers/${t.id}#docs`); }
  await db.insert('teacher_documents', { teacher_id: t.id, title: utils.normalizePersian(req.body.title) || req.file.originalname, file_path: upload.relPath(req.file), file_name: req.file.originalname, mime: req.file.mimetype, size: req.file.size, uploaded_by: req.user.id, created_at: db.now() });
  req.flash('success', 'مدرک بارگذاری شد.'); res.redirect(`/teachers/${t.id}#docs`);
});
router.post('/:id/documents/:docId/delete', auth.requireRole('admin', 'teacher'), modules.requireEnabled('teachers.documents'), async (req, res) => {
  const d = await db.table('teacher_documents').where({ id: req.params.docId, teacher_id: req.params.id }).first();
  const t = await db.findById('teachers', req.params.id);
  if (d && t && (req.user.role === 'admin' || t.user_id === req.user.id)) { upload.removeFile(d.file_path); await db.remove('teacher_documents', { id: d.id }); req.flash('success', 'مدرک حذف شد.'); }
  res.redirect(`/teachers/${req.params.id}#docs`);
});

module.exports = router;
