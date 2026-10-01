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
const staff = [auth.requireRole('admin', 'staff')];
const FEE_TYPES = { tuition: 'شهریه', transport: 'سرویس', books: 'کتاب و لوازم', food: 'تغذیه', trip: 'اردو', uniform: 'لباس فرم', other: 'سایر' };
const METHODS = { cash: 'نقدی', card: 'کارت‌خوان', transfer: 'انتقال بانکی', online: 'پرداخت آنلاین', cheque: 'چک' };
const unit = () => settings.get('currency_unit', 'تومان');
const invStatus = (inv) => { const due = Number(inv.amount) - Number(inv.discount || 0); const paid = Number(inv.paid_amount || 0); return paid >= due - 0.5 ? 'paid' : paid > 0 ? 'partial' : 'unpaid'; };
async function recalc(invoiceId) {
  const inv = await db.findById('invoices', invoiceId); if (!inv) return;
  const paid = Number(await db.table('payments').where('invoice_id', inv.id).sum('amount')) || 0;
  const status = inv.status === 'cancelled' ? 'cancelled' : invStatus(Object.assign({}, inv, { paid_amount: paid }));
  await db.update('invoices', { paid_amount: paid, status, updated_at: db.now() }, { id: inv.id });
}
async function nextNumber() {
  const prefix = settings.get('invoice_prefix', 'INV-') + J.currentJalali().jy + '-';
  const last = await db.table('invoices').where('number', 'like', prefix + '%').orderBy('id', 'desc').first();
  const n = last ? parseInt(String(last.number).slice(prefix.length), 10) + 1 : 1;
  return prefix + String(n).padStart(4, '0');
}
async function summary(where) {
  const q = db.table('invoices as i').leftJoin('students as s', 's.id', 'i.student_id').select('COUNT(*) as cnt', 'COALESCE(SUM(i.amount - COALESCE(i.discount,0)),0) as due', 'COALESCE(SUM(i.paid_amount),0) as paid').where('i.status', '!=', 'cancelled');
  if (where) where(q);
  const r = await q.first(); r.remaining = Number(r.due) - Number(r.paid);
  r.overdue = Number((await db.table('invoices as i').leftJoin('students as s', 's.id', 'i.student_id').select('COALESCE(SUM(i.amount - COALESCE(i.discount,0) - i.paid_amount),0) as x').whereIn('i.status', ['unpaid', 'partial']).where('i.due_date', '<', J.todayISO()).where((b) => (where ? where(b) : b)).first() || {}).x || 0);
  return r;
}

// ---------- داشبورد مالی ----------
router.get('/', ...staff, async (req, res) => {
  const sum = await summary();
  const recent = await db.table('payments as p').join('students as s', 's.id', 'p.student_id').leftJoin('invoices as i', 'i.id', 'p.invoice_id').select('p.*', 's.first_name', 's.last_name', 'i.number').orderBy('p.id', 'desc').limit(10).all();
  const overdue = await db.table('invoices as i').join('students as s', 's.id', 'i.student_id').leftJoin('classes as c', 'c.id', 's.class_id').select('i.*', 's.first_name', 's.last_name', 'c.title as class_title').whereIn('i.status', ['unpaid', 'partial']).where('i.due_date', '<', J.todayISO()).orderBy('i.due_date').limit(10).all();
  const byType = await db.table('invoices as i').leftJoin('fees as f', 'f.id', 'i.fee_id').select('f.type', 'COALESCE(SUM(i.amount - COALESCE(i.discount,0)),0) as due', 'COALESCE(SUM(i.paid_amount),0) as paid').where('i.status', '!=', 'cancelled').groupBy('f.type').all();
  const monthly = []; for (let i = 5; i >= 0; i--) { const cur = J.currentJalali(); let jm = cur.jm - i; let jy = cur.jy; while (jm <= 0) { jm += 12; jy--; } const r = J.jalaliMonthRange(jy, jm); const x = await db.table('payments').select('COALESCE(SUM(amount),0) as s').where('paid_at', '>=', r.start).where('paid_at', '<=', r.end + ' 23:59:59').first(); monthly.push({ label: J.MONTHS[jm - 1], value: Number(x.s) }); }
  res.render(v('index'), { title: 'امور مالی', sum, recent, overdue, byType, monthly, FEE_TYPES, METHODS, unit: unit() });
});

// ---------- شهریه‌ها ----------
crud(router, {
  path: '/fees', table: 'fees', alias: 'f', title: 'شهریه/هزینه', plural: 'شهریه و هزینه‌ها', icon: 'bi-tags', feature: 'finance.fees', orderBy: 'id', dir: 'desc', roles: ['admin', 'staff'], breadcrumbs: [{ title: 'امور مالی', href: '/finance' }],
  query: (q) => q.leftJoin('grade_levels as g', 'g.id', 'f.grade_level_id').leftJoin('classes as c', 'c.id', 'f.class_id').leftJoin('academic_years as y', 'y.id', 'f.academic_year_id').select('f.*', 'g.title as grade_title', 'c.title as class_title', 'y.title as year_title', '(SELECT COUNT(*) FROM invoices i WHERE i.fee_id = f.id) as invoice_count'),
  fields: [
    { name: 'title', label: 'عنوان', type: 'text', required: true, list: true, search: true },
    { name: 'type', label: 'نوع', type: 'select', required: true, list: true, filter: true, options: FEE_TYPES },
    { name: 'amount', label: 'مبلغ', type: 'number', required: true, list: true, money: true, min: 0 },
    { name: 'academic_year_id', label: 'سال تحصیلی', type: 'select', required: true, options: async () => (await db.table('academic_years').orderBy('id', 'desc').all()).map((y) => ({ value: y.id, label: y.title })) },
    { name: 'grade_level_id', label: 'پایه (اختیاری)', type: 'select', list: true, options: async () => [{ value: '', label: 'همهٔ پایه‌ها' }].concat((await db.table('grade_levels').orderBy('sort_order').all()).map((g) => ({ value: g.id, label: g.title }))), format: (val, row) => row.grade_title || 'همه' },
    { name: 'class_id', label: 'کلاس (اختیاری)', type: 'select', options: async () => [{ value: '', label: '—' }].concat(await people.classOptions()) },
    { name: 'due_date', label: 'سررسید', type: 'date', list: true },
    { name: 'description', label: 'توضیحات', type: 'textarea' },
    { name: 'invoice_count', label: 'صورت‌حساب‌ها', type: 'number', virtual: true, readonly: true, hideInForm: true, list: true, format: (val) => J.toPersianDigits(val || 0) }
  ],
  defaults: async () => ({ academic_year_id: ((await db.findOne('academic_years', { is_current: 1 })) || {}).id, type: 'tuition' }),
  beforeSave: (d) => { if (!d.grade_level_id) d.grade_level_id = null; if (!d.class_id) d.class_id = null; return d; },
  beforeDelete: async (row) => ((await db.exists('invoices', { fee_id: row.id })) ? 'برای این هزینه صورت‌حساب صادر شده است' : true),
  rowActions: (row) => (E('finance.bulk_invoice') ? [{ href: '/finance/fees/' + row.id + '/issue', icon: 'bi-receipt', label: 'صدور گروهی صورت‌حساب' }] : []),
  pageActions: () => [{ href: '/finance/invoices', label: 'صورت‌حساب‌ها', icon: 'bi-receipt', class: 'btn-outline-primary' }]
});
router.get('/fees/:id/issue', ...staff, modules.requireEnabled('finance.bulk_invoice'), async (req, res) => {
  const fee = await db.findById('fees', req.params.id); if (!fee) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const classes = await db.table('classes as c').leftJoin('grade_levels as g', 'g.id', 'c.grade_level_id').select('c.*', 'g.title as grade_title').where('c.is_active', 1).where((b) => { if (fee.class_id) b.where('c.id', fee.class_id); else if (fee.grade_level_id) b.where('c.grade_level_id', fee.grade_level_id); return b; }).orderBy('c.title').all();
  const existing = await db.table('invoices').where('fee_id', fee.id).pluck('student_id');
  res.render(v('issue'), { title: 'صدور گروهی', fee, classes, existingCount: existing.length, unit: unit() });
});
router.post('/fees/:id/issue', ...staff, modules.requireEnabled('finance.bulk_invoice'), async (req, res) => {
  const fee = await db.findById('fees', req.params.id); if (!fee) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  let classIds = req.body.class_ids; classIds = (Array.isArray(classIds) ? classIds : [classIds]).map(Number).filter(Boolean);
  if (!classIds.length) { req.flash('danger', 'کلاسی انتخاب نشده'); return res.redirect('/finance/fees/' + fee.id + '/issue'); }
  const discount = Number(J.toEnglishDigits(req.body.discount || 0)) || 0;
  const students = await db.table('students').whereIn('class_id', classIds).where('status', 'active').all();
  const existing = await db.table('invoices').where('fee_id', fee.id).pluck('student_id');
  let n = 0; const now = db.now();
  for (const s of students) {
    if (existing.includes(s.id)) continue;
    await db.insert('invoices', { number: await nextNumber(), student_id: s.id, fee_id: fee.id, title: fee.title, amount: fee.amount, paid_amount: 0, discount: E('finance.discount') ? discount : 0, due_date: fee.due_date || J.addDays(J.todayISO(), 30), status: 'unpaid', notes: null, created_by: req.user.id, created_at: now, updated_at: now });
    n++;
  }
  if (n && E('notifications.inapp')) { const uids = students.filter((s) => !existing.includes(s.id) && s.user_id).map((s) => s.user_id); await notify.push(uids, { title: 'صورت‌حساب جدید', body: `${fee.title} — ${utils.money(fee.amount, unit())}`, link: '/finance/my', type: 'info' }); }
  await activity.log(req, 'create', 'invoices', fee.id, `صدور گروهی ${n} صورت‌حساب برای ${fee.title}`);
  req.flash('success', `${J.toPersianDigits(n)} صورت‌حساب صادر شد.` + (students.length - n ? ` (${J.toPersianDigits(students.length - n)} نفر قبلاً داشتند)` : ''));
  res.redirect('/finance/invoices?f_fee_id=' + fee.id);
});

// ---------- صورت‌حساب‌ها ----------
crud(router, {
  path: '/invoices', table: 'invoices', alias: 'i', title: 'صورت‌حساب', plural: 'صورت‌حساب‌ها', icon: 'bi-receipt', feature: 'finance.invoices', orderBy: 'id', dir: 'desc', roles: ['admin', 'staff'], breadcrumbs: [{ title: 'امور مالی', href: '/finance' }], exportFeature: 'finance.export',
  query: (q) => q.leftJoin('students as s', 's.id', 'i.student_id').leftJoin('classes as c', 'c.id', 's.class_id').select('i.*', 's.first_name', 's.last_name', 'c.title as class_title'),
  filterHook: (q, req) => { if (req.query.student_id) q.where('i.student_id', req.query.student_id); if (req.query.class_id) q.where('s.class_id', req.query.class_id); if (req.query.overdue === '1') q.whereIn('i.status', ['unpaid', 'partial']).where('i.due_date', '<', J.todayISO()); },
  fields: [
    { name: 'number', label: 'شماره', type: 'text', readonly: true, list: true, search: true, format: (val, row) => `<a href="/finance/invoices/${row.id}" class="ltr d-inline-block">${J.toPersianDigits(val)}</a>` },
    { name: 'student_id', label: 'دانش‌آموز', type: 'select', required: true, list: true, search: true, searchColumn: 's.last_name', options: (req) => people.studentOptions(req, { activeOnly: false }) },
    { name: 'class_title', label: 'کلاس', type: 'text', virtual: true, readonly: true, hideInForm: true, list: true },
    { name: 'fee_id', label: 'بابت', type: 'select', filter: true, options: async () => [{ value: '', label: 'دستی / متفرقه' }].concat((await db.table('fees').orderBy('id', 'desc').all()).map((f) => ({ value: f.id, label: f.title + ' (' + utils.money(f.amount) + ')' }))) },
    { name: 'title', label: 'عنوان', type: 'text', required: true, list: true, search: true },
    { name: 'amount', label: 'مبلغ', type: 'number', required: true, list: true, money: true, min: 0 },
    { name: 'discount', label: 'تخفیف', type: 'number', list: true, money: true, min: 0 },
    { name: 'paid_amount', label: 'پرداخت‌شده', type: 'number', readonly: true, hideInForm: true, list: true, money: true },
    { name: 'due_date', label: 'سررسید', type: 'date', required: true, list: true, format: (val, row) => `<span class="${val < J.todayISO() && ['unpaid', 'partial'].includes(row.status) ? 'text-danger fw-semibold' : ''}">${J.formatDate(val)}</span>` },
    { name: 'status', label: 'وضعیت', type: 'select', list: true, filter: true, options: { unpaid: 'پرداخت نشده', partial: 'پرداخت جزئی', paid: 'پرداخت شده', cancelled: 'لغو شده' }, format: (val) => utils.statusBadge(val), help: 'وضعیت بر اساس پرداخت‌ها به‌صورت خودکار محاسبه می‌شود؛ فقط «لغو» را دستی انتخاب کنید' },
    { name: 'notes', label: 'یادداشت', type: 'textarea' }
  ],
  defaults: (req) => ({ due_date: J.addDays(J.todayISO(), 30), status: 'unpaid', student_id: req.query.student_id || '' }),
  beforeSave: async (d, req, isNew, row) => {
    if (isNew) { d.number = await nextNumber(); d.created_by = req.user.id; d.paid_amount = 0; }
    if (!d.fee_id) d.fee_id = null; if (!E('finance.discount')) d.discount = row ? row.discount : 0; d.discount = d.discount || 0;
    if (d.fee_id && !d.title) { const f = await db.findById('fees', d.fee_id); if (f) { d.title = f.title; if (!d.amount) d.amount = f.amount; } }
    const paid = row ? Number(row.paid_amount || 0) : 0;
    d.status = d.status === 'cancelled' ? 'cancelled' : invStatus({ amount: d.amount, discount: d.discount, paid_amount: paid });
    return d;
  },
  afterSave: async (id, d, req, isNew) => { if (isNew && E('notifications.inapp')) { const s = await db.findById('students', d.student_id); if (s && s.user_id) await notify.push([s.user_id], { title: 'صورت‌حساب جدید', body: `${d.title} — ${utils.money(Number(d.amount) - Number(d.discount || 0), unit())}`, link: '/finance/my', type: 'info' }); } },
  beforeDelete: async (row) => ((await db.exists('payments', { invoice_id: row.id })) ? 'برای این صورت‌حساب پرداخت ثبت شده است؛ ابتدا پرداخت‌ها را حذف کنید' : true),
  afterSaveRedirect: (id) => '/finance/invoices/' + id,
  rowActions: (row) => [{ href: '/finance/invoices/' + row.id, icon: 'bi-eye', label: 'مشاهده و پرداخت' }],
  pageActions: () => [{ href: '/finance/invoices?overdue=1', label: 'معوقات', icon: 'bi-exclamation-circle', class: 'btn-outline-danger' }, { href: '/finance/payments', label: 'پرداخت‌ها', icon: 'bi-cash', class: 'btn-outline-primary' }],
  listData: async (req) => {
    const s = await summary(req.query.class_id ? (q) => q.where('s.class_id', req.query.class_id) : null);
    const card = (t, c, val) => `<div class="col-6 col-md-3"><div class="card stat-card"><div class="card-body py-2"><div class="fs-7 text-secondary">${t}</div><div class="fs-5 fw-bold text-${c}">${utils.money(val, unit())}</div></div></div></div>`;
    return { summaryHtml: `<div class="row g-2 mb-3">${card('کل مطالبات', 'primary', s.due)}${card('وصول‌شده', 'success', s.paid)}${card('مانده', 'warning', s.remaining)}${card('معوق (سررسید گذشته)', 'danger', s.overdue)}</div>` };
  }
});
router.get('/invoices/:id', ...staff, async (req, res) => {
  const inv = await db.table('invoices as i').join('students as s', 's.id', 'i.student_id').leftJoin('classes as c', 'c.id', 's.class_id').leftJoin('fees as f', 'f.id', 'i.fee_id').select('i.*', 's.first_name', 's.last_name', 's.student_number', 's.father_name', 's.father_phone', 's.mobile', 's.user_id', 'c.title as class_title', 'f.type as fee_type').where('i.id', req.params.id).first();
  if (!inv) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const payments = await db.table('payments as p').leftJoin('users as u', 'u.id', 'p.recorded_by').select('p.*', 'u.name as recorder').where('p.invoice_id', inv.id).orderBy('p.paid_at').all();
  const print = req.query.print === '1' && E('finance.receipt');
  res.render(v('invoice'), { title: 'صورت‌حساب ' + inv.number, layout: print ? 'layouts/print' : undefined, print, inv, payments, METHODS, FEE_TYPES, unit: unit(), remaining: Number(inv.amount) - Number(inv.discount || 0) - Number(inv.paid_amount || 0), canPay: E('finance.payments') && inv.status !== 'cancelled' && inv.status !== 'paid', schoolInfo: { name: settings.get('school_name'), phone: settings.get('school_phone'), address: settings.get('school_address') } });
});
router.post('/invoices/:id/pay', ...staff, modules.requireEnabled('finance.payments'), async (req, res) => {
  const inv = await db.findById('invoices', req.params.id); if (!inv) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const b = utils.cleanBody(req.body, { fields: ['amount', 'method', 'reference', 'paid_at', 'note'], numbers: ['amount'], dates: ['paid_at'] });
  const remaining = Number(inv.amount) - Number(inv.discount || 0) - Number(inv.paid_amount || 0);
  if (!b.amount || b.amount <= 0) { req.flash('danger', 'مبلغ نامعتبر'); return res.redirect('/finance/invoices/' + inv.id); }
  if (b.amount > remaining + 0.5) { req.flash('danger', `مبلغ بیشتر از ماندهٔ بدهی (${utils.money(remaining, unit())}) است`); return res.redirect('/finance/invoices/' + inv.id); }
  const id = await db.insert('payments', { invoice_id: inv.id, student_id: inv.student_id, amount: b.amount, method: METHODS[b.method] ? b.method : 'cash', reference: b.reference, paid_at: (b.paid_at || J.todayISO()) + ' ' + J.nowTime(), note: b.note, recorded_by: req.user.id, created_at: db.now() });
  await recalc(inv.id);
  const s = await db.findById('students', inv.student_id);
  if (s && s.user_id && E('notifications.inapp')) await notify.push([s.user_id], { title: 'پرداخت ثبت شد', body: `${utils.money(b.amount, unit())} بابت ${inv.title}`, link: '/finance/my', type: 'success' });
  await activity.log(req, 'create', 'payments', id, `ثبت پرداخت ${utils.money(b.amount)} برای ${inv.number}`);
  req.flash('success', 'پرداخت ثبت شد.'); res.redirect('/finance/invoices/' + inv.id + (E('finance.receipt') ? '?receipt=' + id : ''));
});
router.post('/invoices/:id/remind', ...staff, modules.requireEnabled('finance.overdue_notify'), async (req, res) => {
  const inv = await db.table('invoices as i').join('students as s', 's.id', 'i.student_id').select('i.*', 's.user_id', 's.father_phone', 's.mobile', 's.first_name', 's.last_name').where('i.id', req.params.id).first();
  if (!inv) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const remaining = Number(inv.amount) - Number(inv.discount || 0) - Number(inv.paid_amount || 0);
  let msg = '';
  if (inv.user_id) { await notify.push([inv.user_id], { title: 'یادآوری پرداخت', body: `ماندهٔ ${inv.title}: ${utils.money(remaining, unit())} — سررسید ${J.formatDate(inv.due_date)}`, link: '/finance/my', type: 'warning' }); msg = 'اعلان ارسال شد.'; }
  const phone = inv.father_phone || inv.mobile; if (phone) { const r = await notify.sms(phone, `${settings.get('school_name', '')}: یادآوری پرداخت ${inv.title} به مبلغ ${utils.money(remaining, unit())} (سررسید ${J.formatDate(inv.due_date)})`); if (r.ok) msg += ' پیامک ارسال شد.'; }
  req.flash('success', msg || 'کاربری برای یادآوری یافت نشد'); res.redirect('/finance/invoices/' + inv.id);
});
router.post('/overdue/remind-all', ...staff, modules.requireEnabled('finance.overdue_notify'), async (req, res) => {
  const rows = await db.table('invoices as i').join('students as s', 's.id', 'i.student_id').select('i.*', 's.user_id').whereIn('i.status', ['unpaid', 'partial']).where('i.due_date', '<', J.todayISO()).whereNotNull('s.user_id').all();
  for (const inv of rows) await notify.push([inv.user_id], { title: 'یادآوری پرداخت', body: `ماندهٔ ${inv.title}: ${utils.money(Number(inv.amount) - Number(inv.discount || 0) - Number(inv.paid_amount || 0), unit())}`, link: '/finance/my', type: 'warning' });
  req.flash('success', `برای ${J.toPersianDigits(rows.length)} صورت‌حساب معوق یادآوری ارسال شد.`); res.redirect('/finance/invoices?overdue=1');
});

// ---------- پرداخت‌ها ----------
crud(router, {
  path: '/payments', table: 'payments', alias: 'p', title: 'پرداخت', plural: 'پرداخت‌ها', icon: 'bi-cash', feature: 'finance.payments', orderBy: 'paid_at', dir: 'desc', roles: ['admin', 'staff'], breadcrumbs: [{ title: 'امور مالی', href: '/finance' }], canCreate: false, exportFeature: 'finance.export',
  query: (q) => q.join('students as s', 's.id', 'p.student_id').leftJoin('invoices as i', 'i.id', 'p.invoice_id').select('p.*', 's.first_name', 's.last_name', 'i.number as invoice_number', 'i.title as invoice_title'),
  filterHook: (q, req) => { if (req.query.from) q.where('p.paid_at', '>=', J.toGregorian(req.query.from)); if (req.query.to) q.where('p.paid_at', '<=', J.toGregorian(req.query.to) + ' 23:59:59'); },
  fields: [
    { name: 'paid_at', label: 'تاریخ', type: 'datetime', list: true, readonly: true, hideInForm: true },
    { name: 'invoice_number', label: 'صورت‌حساب', type: 'text', virtual: true, readonly: true, hideInForm: true, list: true, search: true, searchColumn: 'i.number', format: (val, row) => `<a href="/finance/invoices/${row.invoice_id}" class="ltr d-inline-block">${J.toPersianDigits(val || '')}</a>` },
    { name: 'student_id', label: 'دانش‌آموز', type: 'select', list: true, readonly: true, search: true, searchColumn: 's.last_name', options: (req) => people.studentOptions(req, { activeOnly: false }) },
    { name: 'amount', label: 'مبلغ', type: 'number', required: true, list: true, money: true, min: 1 },
    { name: 'method', label: 'روش', type: 'select', list: true, filter: true, options: METHODS },
    { name: 'reference', label: 'شماره پیگیری', type: 'text', list: true, search: true },
    { name: 'note', label: 'یادداشت', type: 'text' }
  ],
  afterSave: async (id, d, req, isNew, row) => { if (row) await recalc(row.invoice_id); },
  afterDelete: async (row) => recalc(row.invoice_id),
  rowActions: (row) => (E('finance.receipt') ? [{ href: '/finance/invoices/' + row.invoice_id + '?print=1&receipt=' + row.id, icon: 'bi-printer', label: 'رسید' }] : [])
});

// ---------- گزارش ----------
router.get('/reports', ...staff, modules.requireEnabled('finance.reports'), async (req, res) => {
  const byClass = await db.table('invoices as i').join('students as s', 's.id', 'i.student_id').leftJoin('classes as c', 'c.id', 's.class_id').select('c.title as class_title', 'COUNT(*) as cnt', 'COALESCE(SUM(i.amount - COALESCE(i.discount,0)),0) as due', 'COALESCE(SUM(i.paid_amount),0) as paid').where('i.status', '!=', 'cancelled').groupBy('c.title').orderBy('c.title').all();
  const byType = await db.table('invoices as i').leftJoin('fees as f', 'f.id', 'i.fee_id').select('f.type', 'COUNT(*) as cnt', 'COALESCE(SUM(i.amount - COALESCE(i.discount,0)),0) as due', 'COALESCE(SUM(i.paid_amount),0) as paid').where('i.status', '!=', 'cancelled').groupBy('f.type').all();
  const byMethod = await db.table('payments').select('method', 'COUNT(*) as cnt', 'COALESCE(SUM(amount),0) as total').groupBy('method').all();
  const debtors = await db.table('invoices as i').join('students as s', 's.id', 'i.student_id').leftJoin('classes as c', 'c.id', 's.class_id').select('s.id', 's.first_name', 's.last_name', 's.father_phone', 'c.title as class_title', 'COALESCE(SUM(i.amount - COALESCE(i.discount,0) - i.paid_amount),0) as debt', 'COUNT(*) as cnt').whereIn('i.status', ['unpaid', 'partial']).groupBy('s.id', 's.first_name', 's.last_name', 's.father_phone', 'c.title').orderBy('debt', 'desc').limit(30).all();
  const sum = await summary();
  res.render(v('reports'), { title: 'گزارش مالی', byClass, byType, byMethod, debtors, sum, FEE_TYPES, METHODS, unit: unit(), print: req.query.print === '1', layout: req.query.print === '1' ? 'layouts/print' : undefined });
});

// ---------- پنل دانش‌آموز ----------
router.get('/my', auth.requireRole('student', 'parent'), modules.requireEnabled('finance.student_view'), async (req, res) => {
  const s = await people.studentOf(req); if (!s) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const invoices = await db.table('invoices').where('student_id', s.id).where('status', '!=', 'cancelled').orderBy('due_date', 'desc').all();
  const payments = await db.table('payments as p').leftJoin('invoices as i', 'i.id', 'p.invoice_id').select('p.*', 'i.title as invoice_title', 'i.number').where('p.student_id', s.id).orderBy('p.paid_at', 'desc').all();
  const total = invoices.reduce((a, i) => a + Number(i.amount) - Number(i.discount || 0), 0); const paid = invoices.reduce((a, i) => a + Number(i.paid_amount || 0), 0);
  res.render(v('my'), { title: 'شهریه و پرداخت‌ها', s, invoices, payments, total, paid, METHODS, unit: unit(), today: J.todayISO() });
});
router.get('/my/:id', auth.requireRole('student', 'parent'), modules.requireEnabled('finance.student_view'), async (req, res) => {
  const s = await people.studentOf(req);
  const inv = s ? await db.table('invoices as i').join('students as s', 's.id', 'i.student_id').leftJoin('classes as c', 'c.id', 's.class_id').select('i.*', 's.first_name', 's.last_name', 's.student_number', 's.father_name', 'c.title as class_title').where('i.id', req.params.id).where('i.student_id', s.id).first() : null;
  if (!inv) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const payments = await db.table('payments').where('invoice_id', inv.id).orderBy('paid_at').all();
  const print = req.query.print === '1' && E('finance.receipt');
  res.render(v('invoice'), { title: 'صورت‌حساب ' + inv.number, layout: print ? 'layouts/print' : undefined, print, inv, payments, METHODS, FEE_TYPES, unit: unit(), remaining: Number(inv.amount) - Number(inv.discount || 0) - Number(inv.paid_amount || 0), canPay: false, schoolInfo: { name: settings.get('school_name'), phone: settings.get('school_phone'), address: settings.get('school_address') } });
});
module.exports = router;
