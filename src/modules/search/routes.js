'use strict';
const path = require('path');
const express = require('express');
const db = require('../../core/db');
const auth = require('../../core/auth');
const modules = require('../../core/modules');
const people = require('../../core/people');
const utils = require('../../core/utils');
const J = require('../../core/jalali');

const router = express.Router();
const v = (n) => path.join(__dirname, 'views', n + '.ejs');
router.use(auth.requireAuth, auth.requireRole('admin', 'staff', 'teacher'));
const E = modules.isEnabled;

async function run(req, term, limit) {
  const groups = [];
  const t = utils.normalizePersian(term).trim(); const en = J.toEnglishDigits(t);
  if (!t) return groups;
  const teacherClasses = req.user.role === 'teacher' ? await people.teacherClassIds(req.user.id) : null;
  if (E('students')) {
    const q = db.table('students as s').leftJoin('classes as c', 'c.id', 's.class_id').select('s.id', 's.first_name', 's.last_name', 's.student_number', 's.national_id', 's.status', 'c.title as class_title').where((b) => b.search(t, ['s.first_name', 's.last_name', 's.father_name']).orWhere('s.student_number', 'like', en + '%').orWhere('s.national_id', 'like', en + '%').orWhere('s.mobile', 'like', '%' + en + '%').orWhere('s.father_phone', 'like', '%' + en + '%')).orderBy('s.last_name').limit(limit);
    if (teacherClasses) q.whereIn('s.class_id', teacherClasses);
    const rows = await q.all();
    if (rows.length) groups.push({ title: 'دانش‌آموزان', icon: 'bi-mortarboard', items: rows.map((s) => ({ title: `${s.first_name} ${s.last_name}`, sub: `${J.toPersianDigits(s.student_number)} · ${s.class_title || '—'}`, href: '/students/' + s.id, badge: s.status !== 'active' ? utils.statusBadge(s.status) : '' })) });
  }
  if (E('teachers') && req.user.role !== 'teacher') {
    const rows = await db.table('teachers as t').join('users as u', 'u.id', 't.user_id').select('t.id', 'u.name', 't.personnel_code', 't.field', 'u.phone').where((b) => b.search(t, ['u.name', 't.field']).orWhere('t.personnel_code', 'like', en + '%').orWhere('u.phone', 'like', '%' + en + '%')).limit(limit).all();
    if (rows.length) groups.push({ title: 'معلمان', icon: 'bi-person-workspace', items: rows.map((r) => ({ title: r.name, sub: `${r.field || ''} ${r.personnel_code ? '· ' + J.toPersianDigits(r.personnel_code) : ''}`, href: '/teachers/' + r.id })) });
  }
  if (E('academic')) {
    const q = db.table('classes as c').leftJoin('grade_levels as g', 'g.id', 'c.grade_level_id').select('c.id', 'c.title', 'g.title as grade').where((b) => b.search(t, ['c.title', 'g.title'])).limit(limit);
    if (teacherClasses) q.whereIn('c.id', teacherClasses);
    const rows = await q.all();
    if (rows.length) groups.push({ title: 'کلاس‌ها', icon: 'bi-door-open', items: rows.map((c) => ({ title: c.title, sub: c.grade || '', href: '/academic/classes/' + c.id })) });
  }
  if (E('tickets')) {
    const q = db.table('tickets as k').select('k.id', 'k.code', 'k.subject', 'k.status').where((b) => b.search(t, ['k.subject', 'k.code'])).orderBy('k.id', 'desc').limit(limit);
    if (req.user.role === 'teacher') q.where((b) => b.where('k.assigned_to', req.user.id).orWhere('k.created_by', req.user.id));
    const rows = await q.all();
    if (rows.length) groups.push({ title: 'تیکت‌ها', icon: 'bi-chat-left-text', items: rows.map((k) => ({ title: k.subject, sub: k.code, href: '/tickets/' + k.id, badge: utils.statusBadge(k.status) })) });
  }
  if (E('library')) {
    const rows = await db.table('books').select('id', 'title', 'author', 'available_copies').where((b) => b.search(t, ['title', 'author', 'isbn'])).limit(limit).all();
    if (rows.length) groups.push({ title: 'کتاب‌ها', icon: 'bi-book', items: rows.map((b) => ({ title: b.title, sub: b.author || '', href: '/library?q=' + encodeURIComponent(b.title), badge: Number(b.available_copies) > 0 ? '<span class="badge badge-soft-success">موجود</span>' : '' })) });
  }
  if (E('announcements')) {
    const rows = await db.table('announcements').select('id', 'title', 'created_at').where((b) => b.search(t, ['title', 'body'])).orderBy('id', 'desc').limit(limit).all();
    if (rows.length) groups.push({ title: 'اطلاعیه‌ها', icon: 'bi-megaphone', items: rows.map((a) => ({ title: a.title, sub: J.formatDate(a.created_at), href: '/announcements/' + a.id })) });
  }
  if (req.user.role === 'admin' && E('users')) {
    const rows = await db.table('users').select('id', 'name', 'username', 'role').where((b) => b.search(t, ['name', 'username', 'email'])).limit(limit).all();
    if (rows.length) groups.push({ title: 'کاربران', icon: 'bi-people', items: rows.map((u) => ({ title: u.name, sub: `${u.username} · ${utils.ROLES[u.role] || u.role}`, href: '/users/' + u.id + '/edit' })) });
  }
  return groups;
}
router.get('/', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const groups = q.length >= 2 ? await run(req, q, 15) : [];
  res.render(v('index'), { title: 'جستجو', q, groups, total: groups.reduce((a, g) => a + g.items.length, 0) });
});
router.get('/api', modules.requireEnabled('search.live'), async (req, res) => {
  const q = String(req.query.q || '').trim();
  const groups = q.length >= 2 ? await run(req, q, 5) : [];
  res.json({ groups: groups.map((g) => ({ title: g.title, icon: g.icon, items: g.items.map((i) => ({ title: i.title, sub: i.sub, href: i.href })) })) });
});
module.exports = router;
