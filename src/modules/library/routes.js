'use strict';
const path = require('path');
const express = require('express');
const db = require('../../core/db');
const auth = require('../../core/auth');
const modules = require('../../core/modules');
const crud = require('../../core/crud');
const people = require('../../core/people');
const notify = require('../../core/notify');
const activity = require('../../core/activity');
const settings = require('../../core/settings');
const utils = require('../../core/utils');
const J = require('../../core/jalali');

const router = express.Router();
const v = (n) => path.join(__dirname, 'views', n + '.ejs');
router.use(auth.requireAuth);
const E = modules.isEnabled;
const CATS = { story: 'داستان و رمان', science: 'علمی', religious: 'دینی و مذهبی', history: 'تاریخ و جغرافیا', poetry: 'شعر و ادبیات', reference: 'مرجع و کمک‌درسی', biography: 'زندگی‌نامه', art: 'هنر و سرگرمی', other: 'سایر' };
const staffOnly = [auth.requireRole('admin', 'staff')];
async function recount(bookId) {
  const b = await db.findById('books', bookId); if (!b) return;
  const out = await db.table('book_loans').where({ book_id: bookId, status: 'loaned' }).count();
  await db.update('books', { available_copies: Math.max(0, Number(b.total_copies) - Number(out)) }, { id: bookId });
}
const loanQuery = () => db.table('book_loans as l').join('books as b', 'b.id', 'l.book_id').leftJoin('students as s', 's.id', 'l.student_id').leftJoin('users as u', 'u.id', 'l.user_id').leftJoin('classes as c', 'c.id', 's.class_id').select('l.*', 'b.title as book_title', 'b.author', 's.first_name', 's.last_name', 'c.title as class_title', 'u.name as user_name');

router.get('/my', auth.requireRole('student', 'parent'), modules.requireEnabled('library.student_view'), async (req, res) => {
  const s = await people.studentOf(req); if (!s) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const loans = await loanQuery().where('l.student_id', s.id).orderBy('l.id', 'desc').all();
  let books = { data: [], total: 0, pages: 0 };
  if (E('library.catalog')) { const q = db.table('books').orderBy('title'); if (req.query.q) q.search(utils.normalizePersian(req.query.q), ['title', 'author', 'publisher']); if (req.query.category) q.where('category', req.query.category); books = await q.paginate(req.query.page, 24); }
  res.render(v('my'), { title: 'کتابخانه', loans, books, CATS, today: J.todayISO(), query: req.query, f: { q: req.query.q || '', category: req.query.category || '' } });
});
router.get('/overdue', auth.requireRole('admin', 'staff', 'teacher'), modules.requireEnabled('library.overdue'), async (req, res) => {
  const rows = await loanQuery().where('l.status', 'loaned').where('l.due_at', '<', J.todayISO()).orderBy('l.due_at').all();
  res.render(v('overdue'), { title: 'امانت‌های دیرکرده', rows, today: J.todayISO() });
});
router.post('/overdue/remind', ...staffOnly, modules.requireEnabled('library.overdue'), async (req, res) => {
  const rows = await loanQuery().select('s.user_id as student_user').where('l.status', 'loaned').where('l.due_at', '<', J.todayISO()).all();
  let n = 0;
  for (const r of rows) { const uid = r.student_user || r.user_id; if (uid) { await notify.push([uid], { title: 'یادآوری بازگشت کتاب', body: `«${r.book_title}» از ${J.formatDate(r.due_at)} سررسید شده است.`, link: '/library/my', type: 'warning' }); n++; } }
  req.flash('success', `${J.toPersianDigits(n)} یادآوری ارسال شد.`); res.redirect('/library/overdue');
});

crud(router, {
  path: '', table: 'books', alias: 'b', title: 'کتاب', plural: 'کتابخانه', icon: 'bi-book', feature: 'library.books', orderBy: 'title', roles: ['admin', 'staff'], viewRoles: ['admin', 'staff', 'teacher'], exportFeature: 'library.export',
  fields: [
    { name: 'title', label: 'عنوان', type: 'text', required: true, list: true, search: true },
    { name: 'author', label: 'نویسنده', type: 'text', list: true, search: true },
    { name: 'publisher', label: 'ناشر', type: 'text', search: true },
    { name: 'isbn', label: 'شابک', type: 'text', search: true, placeholder: '978-…' },
    { name: 'category', label: 'دسته', type: 'select', list: true, filter: true, options: CATS },
    { name: 'shelf', label: 'قفسه', type: 'text', list: true },
    { name: 'total_copies', label: 'تعداد نسخه', type: 'number', required: true, min: 1, list: true },
    { name: 'available_copies', label: 'موجود', type: 'number', readonly: true, hideInForm: true, list: true, format: (val, row) => `<span class="badge ${Number(val) > 0 ? 'badge-soft-success' : 'badge-soft-danger'}">${J.toPersianDigits(val)} / ${J.toPersianDigits(row.total_copies)}</span>` },
    { name: 'description', label: 'توضیحات', type: 'textarea' }
  ],
  defaults: () => ({ total_copies: 1, category: 'story' }),
  beforeSave: async (d, req, isNew, row) => { if (isNew) d.available_copies = d.total_copies; return d; },
  afterSave: async (id) => recount(id),
  beforeDelete: async (row) => ((await db.exists('book_loans', { book_id: row.id, status: 'loaned' })) ? 'این کتاب در امانت است' : true),
  rowActions: (row) => (Number(row.available_copies) > 0 && E('library.loans') ? [{ href: '/library/loans/new?book_id=' + row.id, icon: 'bi-box-arrow-up-right', label: 'امانت دادن' }] : []),
  pageActions: () => [{ href: '/library/loans', label: 'امانت‌ها', icon: 'bi-arrow-left-right', class: 'btn-outline-primary' }, ...(E('library.overdue') ? [{ href: '/library/overdue', label: 'دیرکردها', icon: 'bi-exclamation-circle', class: 'btn-outline-danger' }] : [])],
  listData: async () => {
    const books = await db.count('books'); const copies = await db.table('books').sum('total_copies'); const out = await db.table('book_loans').where('status', 'loaned').count(); const overdue = await db.table('book_loans').where('status', 'loaned').where('due_at', '<', J.todayISO()).count();
    const card = (t, c, s) => `<div class="col-6 col-md-3"><div class="card stat-card"><div class="card-body py-2"><div class="fs-7 text-secondary">${t}</div><div class="fs-4 fw-bold text-${c}">${J.toPersianDigits(s)}</div></div></div></div>`;
    return { summaryHtml: `<div class="row g-2 mb-3">${card('عنوان کتاب', 'primary', books)}${card('کل نسخه‌ها', 'info', copies || 0)}${card('در امانت', 'warning', out)}${card('دیرکرد', 'danger', overdue)}</div>` };
  }
});

crud(router, {
  path: '/loans', table: 'book_loans', alias: 'l', title: 'امانت', plural: 'امانت‌ها', icon: 'bi-arrow-left-right', feature: 'library.loans', orderBy: 'id', dir: 'desc', roles: ['admin', 'staff'], viewRoles: ['admin', 'staff', 'teacher'], breadcrumbs: [{ title: 'کتابخانه', href: '/library' }], exportFeature: 'library.export',
  query: (q) => q.join('books as b', 'b.id', 'l.book_id').leftJoin('students as s', 's.id', 'l.student_id').leftJoin('users as u', 'u.id', 'l.user_id').select('l.*', 'b.title as book_title', 's.first_name', 's.last_name', 'u.name as user_name'),
  filterHook: (q, req) => { if (req.query.student_id) q.where('l.student_id', req.query.student_id); },
  fields: [
    { name: 'book_id', label: 'کتاب', type: 'select', required: true, list: true, search: true, searchColumn: 'b.title', options: async (req, row) => (await db.table('books').orderBy('title').all()).filter((b) => Number(b.available_copies) > 0 || (row && row.book_id === b.id)).map((b) => ({ value: b.id, label: `${b.title}${b.author ? ' — ' + b.author : ''} (موجود: ${J.toPersianDigits(b.available_copies)})` })) },
    { name: 'student_id', label: 'دانش‌آموز', type: 'select', list: true, search: true, searchColumn: 's.last_name', options: async (req) => [{ value: '', label: '— (امانت به همکار)' }].concat(await people.studentOptions(req)) },
    { name: 'user_id', label: 'همکار (معلم/کارمند)', type: 'select', options: async () => [{ value: '', label: '—' }].concat(await people.staffOptions()) },
    { name: 'loaned_at', label: 'تاریخ امانت', type: 'date', required: true, list: true },
    { name: 'due_at', label: 'مهلت بازگشت', type: 'date', required: true, list: true, format: (val, row) => `<span class="${row.status === 'loaned' && val < J.todayISO() ? 'text-danger fw-semibold' : ''}">${J.formatDate(val)}</span>` },
    { name: 'returned_at', label: 'تاریخ بازگشت', type: 'date', list: true, hideInForm: true },
    { name: 'status', label: 'وضعیت', type: 'select', list: true, filter: true, hideInForm: true, options: { loaned: 'در امانت', returned: 'بازگشتی' }, format: (val) => utils.statusBadge(val) },
    { name: 'note', label: 'یادداشت', type: 'text' }
  ],
  defaults: (req) => ({ loaned_at: J.todayISO(), due_at: J.addDays(J.todayISO(), settings.getInt('library_loan_days', 14)), book_id: req.query.book_id || '', student_id: req.query.student_id || '' }),
  validate: (val, d) => { if (!d.student_id && !d.user_id) val.custom(false, 'دانش‌آموز یا همکار امانت‌گیرنده را مشخص کنید'); if (d.due_at && d.loaned_at && d.due_at < d.loaned_at) val.custom(false, 'مهلت بازگشت باید بعد از تاریخ امانت باشد'); },
  beforeSave: async (d, req, isNew, row) => {
    d.student_id = d.student_id || null; d.user_id = d.student_id ? null : (d.user_id || null);
    if (isNew) {
      const book = await db.findById('books', d.book_id); if (!book || Number(book.available_copies) < 1) throw new Error('نسخهٔ موجودی از این کتاب نیست');
      if (E('library.limits')) { const max = settings.getInt('library_max_loans', 3); const open = await db.table('book_loans').where('status', 'loaned').where(d.student_id ? { student_id: d.student_id } : { user_id: d.user_id }).count(); if (open >= max) throw new Error(`سقف امانت هم‌زمان (${J.toPersianDigits(max)} کتاب) پر شده است`); }
      d.status = 'loaned'; d.created_by = req.user.id;
    }
    return d;
  },
  afterSave: async (id, d, req, isNew, row) => { await recount(d.book_id); if (row && row.book_id !== d.book_id) await recount(row.book_id); if (isNew && d.student_id && E('notifications.inapp')) { const s = await db.findById('students', d.student_id); const b = await db.findById('books', d.book_id); if (s && s.user_id && b) await notify.push([s.user_id], { title: 'امانت کتاب', body: `«${b.title}» تا ${J.formatDate(d.due_at)} در امانت شماست.`, link: '/library/my', type: 'info' }); } },
  afterDelete: async (row) => recount(row.book_id),
  rowActions: (row) => (row.status === 'loaned' ? [{ post: '/library/loans/' + row.id + '/return', icon: 'bi-box-arrow-in-down', label: 'ثبت بازگشت', confirm: 'بازگشت کتاب ثبت شود؟' }] : []),
  pageActions: () => [{ href: '/library/loans?f_status=loaned', label: 'در امانت', icon: 'bi-funnel', class: 'btn-outline-primary' }]
});
router.post('/loans/:id/return', ...staffOnly, modules.requireEnabled('library.loans'), async (req, res) => {
  const l = await db.findById('book_loans', req.params.id);
  if (l && l.status === 'loaned') { await db.update('book_loans', { status: 'returned', returned_at: J.todayISO() }, { id: l.id }); await recount(l.book_id); await activity.log(req, 'update', 'book_loans', l.id, 'بازگشت کتاب'); req.flash('success', 'بازگشت ثبت شد.'); }
  res.redirect(req.get('referer') || '/library/loans');
});
module.exports = router;
