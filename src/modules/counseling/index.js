'use strict';
module.exports = {
  key: 'counseling', name: 'مشاوره', description: 'ثبت جلسات مشاورهٔ تحصیلی و رفتاری، پیگیری و جلسات محرمانه', icon: 'bi-chat-heart', category: 'people', order: 47,
  features: [
    { key: 'sessions', name: 'جلسات مشاوره', description: 'ثبت جلسه با موضوع، خلاصه و تاریخ پیگیری', locked: true },
    { key: 'confidential', name: 'جلسات محرمانه', description: 'فقط مشاور ثبت‌کننده و مدیر می‌بینند' },
    { key: 'followup', name: 'پیگیری', description: 'فهرست پیگیری‌های سررسیدشده در صفحهٔ اصلی ماژول' },
    { key: 'student_request', name: 'درخواست مشاوره توسط دانش‌آموز', description: 'دانش‌آموز از پنل خود درخواست جلسه ثبت می‌کند (از طریق تیکت با دستهٔ مشاوره)' }
  ],
  menu: [
    { title: 'مشاوره', href: '/counseling', icon: 'bi-chat-heart', roles: ['admin', 'staff'] },
    { title: 'درخواست مشاوره', href: '/counseling/request', icon: 'bi-chat-heart', roles: ['student', 'parent'], feature: 'student_request' }
  ],
  routes: require('./routes')
};
