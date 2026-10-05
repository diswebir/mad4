'use strict';
/** ماژول استخدام: موقعیت‌های شغلی، فرم استخدام پویا، پرونده‌ها، مصاحبه، دعوت‌نامه/QR، گزارش */
const forms = require('./forms');
const { applyRouter, portal } = require('./routes-apply');
const hr = require('./routes-hr');
const config = require('./routes-config');

module.exports = {
  key: 'recruitment',
  name: 'استخدام و جذب',
  icon: 'bi-person-plus',
  category: 'recruitment',
  order: 20,
  description: 'موقعیت‌های شغلی، فرم استخدام چندمرحله‌ای، پروندهٔ متقاضیان، مصاحبه و دعوت‌نامهٔ QR',
  mount: ['/recruitment', '/recruitment', '/apply', '/portal'],
  routes: [hr, config, applyRouter, portal],
  features: [
    { key: 'board', name: 'تابلوی کانبان فرایند', description: 'نمایش پرونده‌ها به تفکیک مرحله' },
    { key: 'interviews', name: 'زمان‌بندی مصاحبه', description: 'ثبت و پیگیری مصاحبه‌ها و اطلاع‌رسانی به متقاضی' },
    { key: 'invites', name: 'دعوت‌نامه و QR', description: 'لینک/QR اختصاصی برای متقاضیان حضوری' },
    { key: 'evaluations', name: 'ارزیابی سه‌مرحله‌ای', description: 'نظر مصاحبه‌کننده، منابع انسانی و مدیریت' },
    { key: 'reports', name: 'گزارش‌های استخدام', description: 'قیف جذب، منابع آشنایی، ترکیب تیپ‌ها' },
    { key: 'export', name: 'خروجی اکسل', description: 'خروجی پرونده‌ها' },
    { key: 'manual_entry', name: 'ثبت دستی پرونده', description: 'ایجاد پرونده توسط منابع انسانی برای متقاضی حضوری' },
    { key: 'duplicate_check', name: 'هشدار پروندهٔ تکراری', description: 'تشخیص کد ملی/موبایل تکراری' },
    { key: 'print', name: 'چاپ فرم استخدام', description: 'نسخهٔ چاپی فرم با ارزیابی‌ها' }
  ],
  menu: [
    { href: '/recruitment/applications', title: 'پرونده‌های استخدام', icon: 'bi-folder2-open', match: '/recruitment/applications', permission: 'applicants.view', badge: 'applications' },
    { href: '/recruitment/applications/board', title: 'تابلوی فرایند', icon: 'bi-kanban', match: '/recruitment/applications/board', permission: 'applicants.view', feature: 'board' },
    { href: '/recruitment/interviews', title: 'مصاحبه‌ها', icon: 'bi-calendar2-check', match: '/recruitment/interviews', permission: 'interviews.manage', feature: 'interviews' },
    { href: '/recruitment/positions', title: 'موقعیت‌های شغلی', icon: 'bi-briefcase', match: '/recruitment/positions', permission: 'jobs.view' },
    { href: '/recruitment/invites', title: 'دعوت‌نامه و QR', icon: 'bi-qr-code', match: '/recruitment/invites', permission: 'invites.manage', feature: 'invites' },
    { href: '/recruitment/form-builder', title: 'فرم‌ساز استخدام', icon: 'bi-ui-checks', match: '/recruitment/form-builder', permission: 'forms.manage' },
    { href: '/recruitment/departments', title: 'واحدهای سازمانی', icon: 'bi-diagram-3', match: '/recruitment/departments', permission: 'jobs.view' },
    { href: '/recruitment/reports', title: 'گزارش‌های استخدام', icon: 'bi-graph-up', match: '/recruitment/reports', permission: 'reports.view', feature: 'reports' }
  ],
  async ensureDefaults(log) { await forms.ensureDefaults(log); },
  jobs: [
    { key: 'recruitment.cleanup_drafts', name: 'بایگانی پیش‌نویس‌های رهاشده', description: 'پیش‌نویس‌هایی که مدت مشخصی فعالیت نداشته‌اند بایگانی می‌شوند', schedule: 'daily', defaultTime: '03:30',
      run: async () => { const db = require('../../core/db'); const settings = require('../../core/settings'); const days = settings.getInt('recruitment_draft_days', 30); if (!days) return 'غیرفعال'; const before = new Date(Date.now() - days * 86400000).toISOString().slice(0, 19).replace('T', ' '); const rows = await db.table('applications').where('status', 'draft').where('last_activity_at', '<', before).all(); for (const r of rows) await db.update('applications', { status: 'archived', archived_at: db.now() }, { id: r.id }); return `${rows.length} پیش‌نویس بایگانی شد`; } },
    { key: 'recruitment.close_expired', name: 'بستن موقعیت‌های منقضی', description: 'موقعیت‌هایی که تاریخ پایان آن‌ها گذشته بسته می‌شوند', schedule: 'daily', defaultTime: '00:30',
      run: async () => { const db = require('../../core/db'); const J = require('../../core/jalali'); const n = await db.table('job_positions').where('status', 'open').whereNotNull('closes_at').where('closes_at', '<', J.todayISO()).update({ status: 'closed', updated_at: db.now() }); return `${n} موقعیت بسته شد`; } },
    { key: 'recruitment.interview_reminders', name: 'یادآوری مصاحبهٔ فردا', description: 'اعلان به مصاحبه‌کننده و پیامک به متقاضی برای مصاحبه‌های فردا', schedule: 'daily', defaultTime: '17:00',
      run: async () => { const db = require('../../core/db'); const J = require('../../core/jalali'); const notify = require('../../core/notify'); const settings = require('../../core/settings'); const d = J.addDays(J.todayISO(), 1); const rows = await db.table('interviews as i').select('i.*', 'a.first_name', 'a.last_name', 'a.mobile', 'a.user_id as applicant_user').join('applications as a', 'i.application_id', 'a.id').where('i.status', 'scheduled').whereBetween('i.scheduled_at', d + ' 00:00:00', d + ' 23:59:59').all(); let n = 0; for (const r of rows) { const when = J.formatDateTime(r.scheduled_at); const name = [r.first_name, r.last_name].filter(Boolean).join(' '); if (r.interviewer_id) await notify.push(r.interviewer_id, { title: 'یادآوری مصاحبهٔ فردا', body: `${name} — ${when}`, link: '/recruitment/applications/' + r.application_id + '?tab=interviews' }); if (r.applicant_user) await notify.push(r.applicant_user, { title: 'یادآوری مصاحبه', body: `مصاحبهٔ شما فردا ${when} برگزار می‌شود.`, link: '/portal' }); if (r.mobile && settings.getBool('sms_notify_interview_reminder')) await notify.smsTemplate(r.mobile, 'sms_template_interview', { name, date: J.formatDate(r.scheduled_at), time: J.formatTime(r.scheduled_at), location: r.location || settings.get('company_address') || 'دفتر شرکت' }, { userId: r.applicant_user }); n++; } return `${n} یادآوری ارسال شد`; } }
  ]
};
