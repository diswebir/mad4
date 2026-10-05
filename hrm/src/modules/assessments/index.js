'use strict';
/** ماژول آزمون و تحلیل: آزمون شخصیت‌شناسی MBTI، تخصیص خودکار، گزارش تحلیلی برای منابع انسانی */
const service = require('./service');

module.exports = {
  key: 'assessments',
  name: 'آزمون و تحلیل شخصیت',
  icon: 'bi-clipboard2-pulse',
  category: 'assessments',
  order: 30,
  dependencies: ['recruitment'],
  description: 'آزمون MBTI ۲۸ سؤالی شرکت، امتیازدهی خودکار و گزارش تحلیلی محرمانه برای تیم منابع انسانی',
  mount: ['/assessments'],
  routes: [require('./routes')],
  features: [
    { key: 'auto_assign', name: 'تخصیص خودکار پس از ارسال فرم', description: 'آزمون‌های فعال به‌صورت خودکار برای متقاضی فعال می‌شوند' },
    { key: 'fit', name: 'تناسب با تیپ‌های ترجیحی موقعیت', description: 'محاسبهٔ امتیاز تناسب بر اساس تیپ‌های تعریف‌شده در موقعیت شغلی' },
    { key: 'interview_questions', name: 'پیشنهاد سؤال مصاحبه', description: 'سؤال‌های هدفمند بر اساس تیپ در گزارش' },
    { key: 'types_guide', name: 'راهنمای ۱۶ تیپ', description: 'صفحهٔ مرجع تیپ‌ها برای تیم منابع انسانی' }
  ],
  menu: [
    { href: '/assessments', title: 'آزمون‌ها', icon: 'bi-clipboard2-pulse', match: '/assessments', permission: 'assessments.view' },
    { href: '/assessments/attempts', title: 'نتایج و تحلیل‌ها', icon: 'bi-pie-chart', match: '/assessments/attempts', permission: 'assessments.view' },
    { href: '/assessments/types', title: 'راهنمای تیپ‌ها', icon: 'bi-book', match: '/assessments/types', permission: 'assessments.view', feature: 'types_guide' }
  ],
  async ensureDefaults(log) { await service.ensureDefaults(log); },
  jobs: [
    { key: 'assessments.remind_pending', name: 'یادآوری آزمون‌های انجام‌نشده', description: 'اعلان/پیامک به متقاضیانی که آزمون تخصیص‌یافته را انجام نداده‌اند', schedule: 'daily', defaultTime: '10:00',
      run: async () => { const db = require('../../core/db'); const notify = require('../../core/notify'); const settings = require('../../core/settings'); const before = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 19).replace('T', ' '); const rows = await db.table('assessment_attempts as a').select('a.*', 't.title', 'p.mobile', 'p.first_name', 'p.last_name').join('assessments as t', 'a.assessment_id', 't.id').join('applications as p', 'a.application_id', 'p.id').whereIn('a.status', ['assigned', 'in_progress']).where('a.created_at', '<', before).whereIn('p.status', ['submitted', 'screening', 'test']).all(); let n = 0; for (const r of rows) { if (r.user_id) await notify.push(r.user_id, { title: 'یادآوری آزمون', body: `«${r.title}» هنوز تکمیل نشده است.`, link: '/assessments/take/' + r.id, type: 'warning' }); if (r.mobile && settings.getBool('sms_notify_test_reminder')) await notify.smsTemplate(r.mobile, 'sms_template_test', { name: [r.first_name, r.last_name].filter(Boolean).join(' ') || 'متقاضی', test: r.title }, { userId: r.user_id }); n++; } return `${n} یادآوری`; } }
  ]
};
