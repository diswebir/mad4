'use strict';
const path = require('path');
const express = require('express');
const db = require('../../core/db');
const auth = require('../../core/auth');
const modules = require('../../core/modules');
const crud = require('../../core/crud');
const people = require('../../core/people');
const activity = require('../../core/activity');
const utils = require('../../core/utils');
const J = require('../../core/jalali');

const router = express.Router();
const v = (n) => path.join(__dirname, 'views', n + '.ejs');
router.use(auth.requireAuth);
const E = modules.isEnabled;
const staffOnly = [auth.requireRoleOrPermission(['admin'], 'transport.manage')];

router.get('/my', auth.requireRole('student', 'parent'), modules.requireEnabled('transport.student_view'), async (req, res) => {
  const s = await people.studentOf(req); if (!s) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const route = s.transport_route_id ? await db.findById('transport_routes', s.transport_route_id) : null;
  const mates = route ? await db.table('students as s').leftJoin('classes as c', 'c.id', 's.class_id').select('s.first_name', 's.last_name', 'c.title as class_title').where('s.transport_route_id', route.id).where('s.status', 'active').where('s.id', '!=', s.id).orderBy('c.title').all() : [];
  res.render(v('my'), { title: 'سرویس من', route, mates, s });
});
crud(router, {
  path: '', table: 'transport_routes', alias: 'r', title: 'مسیر سرویس', plural: 'سرویس مدرسه', icon: 'bi-bus-front', feature: 'transport.routes', orderBy: 'title', roles: ['admin'], permission: 'transport.manage',
  query: (q) => q.select('r.*', '(SELECT COUNT(*) FROM students s WHERE s.transport_route_id = r.id AND s.status = \'active\') as riders'),
  fields: [
    { name: 'title', label: 'عنوان مسیر', type: 'text', required: true, list: true, search: true, placeholder: 'مثال: مسیر ۱ — شهرک غرب' },
    { name: 'driver_name', label: 'نام راننده', type: 'text', required: true, list: true, search: true },
    { name: 'driver_phone', label: 'تلفن راننده', type: 'tel', mobile: true, list: true },
    { name: 'vehicle', label: 'خودرو', type: 'text', list: true }, { name: 'plate', label: 'پلاک', type: 'text', list: true },
    { name: 'capacity', label: 'ظرفیت', type: 'number', required: true, min: 1, list: true },
    { name: 'riders', label: 'سرنشینان', type: 'number', virtual: true, readonly: true, hideInForm: true, list: true, format: (val, row) => { const pct = row.capacity ? Math.round(Number(val) / Number(row.capacity) * 100) : 0; return `<div class="d-flex align-items-center gap-2"><div class="progress" style="width:60px;height:6px"><div class="progress-bar ${pct >= 100 ? 'bg-danger' : pct > 80 ? 'bg-warning' : ''}" style="width:${Math.min(100, pct)}%"></div></div><span class="fs-7">${J.toPersianDigits(val)} / ${J.toPersianDigits(row.capacity)}</span></div>`; } },
    { name: 'fee', label: 'هزینهٔ سرویس', type: 'number', money: true, min: 0 },
    { name: 'departure_time', label: 'ساعت حرکت', type: 'time', list: true },
    { name: 'path_description', label: 'شرح مسیر و ایستگاه‌ها', type: 'textarea' },
    { name: 'is_active', label: 'فعال', type: 'checkbox', list: true }
  ],
  defaults: () => ({ capacity: 20, is_active: 1, departure_time: '07:00' }),
  beforeDelete: async (row) => ((await db.exists('students', { transport_route_id: row.id })) ? 'دانش‌آموزانی به این مسیر تخصیص دارند' : true),
  rowActions: (row) => [...(E('transport.roster') ? [{ href: '/transport/' + row.id + '/roster', icon: 'bi-people', label: 'فهرست سرنشینان' }] : []), ...(E('transport.assign') ? [{ href: '/transport/' + row.id + '/assign', icon: 'bi-person-plus', label: 'تخصیص دانش‌آموز' }] : [])],
  listData: async () => {
    const routes = await db.table('transport_routes').where('is_active', 1).count(); const riders = await db.table('students').whereNotNull('transport_route_id').where('status', 'active').count(); const cap = await db.table('transport_routes').where('is_active', 1).sum('capacity');
    const card = (t, c, s) => `<div class="col-6 col-md-4"><div class="card stat-card"><div class="card-body py-2"><div class="fs-7 text-secondary">${t}</div><div class="fs-4 fw-bold text-${c}">${J.toPersianDigits(s)}</div></div></div></div>`;
    return { summaryHtml: `<div class="row g-2 mb-3">${card('مسیرهای فعال', 'primary', routes)}${card('دانش‌آموزان سرویسی', 'success', riders)}${card('ظرفیت کل', 'info', cap || 0)}</div>` };
  }
});
router.get('/:id/roster', ...staffOnly, modules.requireEnabled('transport.roster'), async (req, res) => {
  const route = await db.findById('transport_routes', req.params.id); if (!route) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const rows = await db.table('students as s').leftJoin('classes as c', 'c.id', 's.class_id').select('s.*', 'c.title as class_title').where('s.transport_route_id', route.id).where('s.status', 'active').orderBy('c.title').orderBy('s.last_name').all();
  const print = req.query.print === '1';
  res.render(v('roster'), { title: 'سرنشینان ' + route.title, layout: print ? 'layouts/print' : undefined, print, route, rows });
});
router.get('/:id/assign', ...staffOnly, modules.requireEnabled('transport.assign'), async (req, res) => {
  const route = await db.findById('transport_routes', req.params.id); if (!route) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const classes = await db.table('classes').where('is_active', 1).orderBy('title').all();
  const classId = Number(req.query.class_id) || (classes[0] && classes[0].id);
  const students = classId ? await db.table('students as s').leftJoin('transport_routes as r', 'r.id', 's.transport_route_id').select('s.id', 's.first_name', 's.last_name', 's.student_number', 's.transport_route_id', 's.address', 'r.title as route_title').where('s.class_id', classId).where('s.status', 'active').orderBy('s.last_name').all() : [];
  const riders = await db.table('students').where('transport_route_id', route.id).where('status', 'active').count();
  res.render(v('assign'), { title: 'تخصیص به ' + route.title, route, classes, classId, students, riders });
});
router.post('/:id/assign', ...staffOnly, modules.requireEnabled('transport.assign'), async (req, res) => {
  const route = await db.findById('transport_routes', req.params.id); if (!route) return res.status(404).render('errors/404', { title: 'یافت نشد' });
  const classId = Number(req.body.class_id) || 0;
  let ids = req.body.student_ids; ids = (Array.isArray(ids) ? ids : ids ? [ids] : []).map(Number).filter(Boolean);
  const inClass = await db.table('students').where('class_id', classId).where('status', 'active').pluck('id');
  const current = await db.table('students').where('transport_route_id', route.id).where('status', 'active').count();
  const toAdd = ids.filter((id) => inClass.includes(id));
  const toRemove = inClass.filter((id) => !ids.includes(id));
  const removeCount = (await db.table('students').whereIn('id', toRemove.length ? toRemove : [0]).where('transport_route_id', route.id).count());
  const addCount = (await db.table('students').whereIn('id', toAdd.length ? toAdd : [0]).where((b) => b.whereNull('transport_route_id').orWhere('transport_route_id', '!=', route.id)).count());
  if (Number(current) - Number(removeCount) + Number(addCount) > Number(route.capacity)) { req.flash('danger', `ظرفیت مسیر (${J.toPersianDigits(route.capacity)} نفر) کافی نیست.`); return res.redirect(`/transport/${route.id}/assign?class_id=${classId}`); }
  if (toRemove.length) await db.table('students').whereIn('id', toRemove).where('transport_route_id', route.id).update({ transport_route_id: null });
  if (toAdd.length) await db.table('students').whereIn('id', toAdd).update({ transport_route_id: route.id });
  await activity.log(req, 'update', 'transport_routes', route.id, `تخصیص سرویس ${route.title} برای کلاس ${classId}`);
  req.flash('success', 'تخصیص سرویس ذخیره شد.'); res.redirect(`/transport/${route.id}/assign?class_id=${classId}`);
});
module.exports = router;
