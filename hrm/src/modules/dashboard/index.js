'use strict';
/** داشبورد مدیریتی (هسته): نمای متفاوت برای منابع انسانی و کارمند */
const path = require('path');
const express = require('express');
const db = require('../../core/db');
const auth = require('../../core/auth');
const modules = require('../../core/modules');
const permissions = require('../../core/permissions');
const settings = require('../../core/settings');
const J = require('../../core/jalali');

const router = express.Router();
const v = (n) => path.join(__dirname, 'views', n + '.ejs');

router.get('/', auth.requireAuth, async (req, res) => {
  if (req.user.role === 'applicant') return res.redirect('/portal');
  const can = (k) => permissions.can(req.user, k);
  const data = { can, now: J.nowISO() };
  // اطلاعیه‌ها برای همه
  if (modules.isEnabled('employees')) {
    const today = J.todayISO();
    data.announcements = (await db.table('announcements').orderBy('is_pinned', 'desc').orderBy('id', 'desc').limit(6).all()).filter((a) => (!a.publish_at || a.publish_at <= today) && (!a.expires_at || a.expires_at >= today) && (a.audience === 'all' || (a.audience === 'hr' && permissions.isHR(req.user)) || (a.audience === 'employees' && req.user.role === 'employee')));
  }
  const notifications = modules.isEnabled('notifications.inapp') ? await db.table('notifications').where('user_id', req.user.id).orderBy('id', 'desc').limit(6).all() : [];
  if (!permissions.isHR(req.user) && !can('applicants.view') && !can('reports.view')) {
    // داشبورد کارمند
    let employee = null;
    if (modules.isEnabled('employees')) employee = await db.table('employees as e').select('e.*', 'd.title as department').leftJoin('departments as d', 'e.department_id', 'd.id').where('e.user_id', req.user.id).first();
    return res.render(v('employee'), Object.assign({ title: 'داشبورد من', notifications, employee }, data));
  }
  // داشبورد منابع انسانی
  const recruitment = modules.isEnabled('recruitment') && can('applicants.view');
  if (recruitment) {
    const svc = require('../recruitment/service');
    data.st = await svc.stats(30);
    data.recent = await db.table('applications as a').select('a.*', 'p.title as position_title').leftJoin('job_positions as p', 'a.position_id', 'p.id').whereNotIn('a.status', ['draft', 'archived']).orderBy('a.submitted_at', 'desc').orderBy('a.id', 'desc').limit(8).all();
    data.mine = await db.table('applications').where('assigned_to', req.user.id).whereNotIn('status', ['hired', 'rejected', 'withdrawn', 'archived', 'draft']).count();
    data.interviews = modules.isEnabled('recruitment.interviews') ? await db.table('interviews as i').select('i.*', 'a.first_name', 'a.last_name', 'a.id as app_id', 'u.name as interviewer_name').join('applications as a', 'i.application_id', 'a.id').leftJoin('users as u', 'i.interviewer_id', 'u.id').where('i.status', 'scheduled').where('i.scheduled_at', '>=', J.todayISO() + ' 00:00:00').orderBy('i.scheduled_at').limit(6).all() : [];
    data.chart = buildChart(data.st.perDay, 30);
    data.stale = await db.table('applications').whereIn('status', ['submitted', 'screening']).where('submitted_at', '<', new Date(Date.now() - settings.getInt('recruitment_sla_days', 5) * 86400000).toISOString().slice(0, 19).replace('T', ' ')).count();
  }
  if (modules.isEnabled('assessments') && can('assessments.view')) {
    const asvc = require('../assessments/service');
    data.tests = await asvc.stats();
  }
  if (modules.isEnabled('employees') && can('employees.view')) data.employees = await db.count('employees', { status: 'active' });
  const ids = (data.recent || []).map((a) => a.id); data.types = {};
  if (ids.length && modules.isEnabled('assessments')) (await db.table('assessment_attempts').whereIn('application_id', ids).where('status', 'completed').whereNotNull('result_type').all()).forEach((t) => (data.types[t.application_id] = t.result_type));
  data.activity = can('logs.view') ? await db.table('activity_logs as l').select('l.*', 'u.name as user_name').leftJoin('users as u', 'l.user_id', 'u.id').orderBy('l.id', 'desc').limit(8).all() : [];
  res.render(v('index'), Object.assign({ title: 'داشبورد', notifications, recruitment }, data));
});

function buildChart(perDay, days) {
  const labels = [], values = [];
  for (let i = days - 1; i >= 0; i--) { const d = J.addDays(J.todayISO(), -i); const p = J.toJalaliParts(d); labels.push(p ? p.jd + '/' + p.jm : d); values.push(perDay[d] || 0); }
  return { labels, values };
}

module.exports = {
  key: 'dashboard', name: 'داشبورد', icon: 'bi-grid-1x2', category: 'main', order: 1, core: true,
  description: 'داشبورد مدیریتی با آمار استخدام، آزمون‌ها، مصاحبه‌های پیش رو و فعالیت‌های اخیر',
  mount: ['/dashboard'], routes: [router],
  features: [
    { key: 'charts', name: 'نمودارها', description: 'نمودار روند درخواست‌ها و ترکیب تیپ‌ها' },
    { key: 'activity', name: 'فعالیت‌های اخیر', description: 'نمایش آخرین فعالیت‌ها در داشبورد' }
  ],
  menu: [{ href: '/dashboard', title: 'داشبورد', icon: 'bi-grid-1x2', match: '/dashboard' }]
};
