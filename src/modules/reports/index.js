'use strict';
module.exports = {
  key: 'reports', name: 'گزارش‌ها و آمار', description: 'گزارش‌های مدیریتی با نمودار: آمار دانش‌آموزان، حضور و غیاب، نمرات، معلمان و خروجی چاپی', icon: 'bi-graph-up-arrow', category: 'system', order: 90,
  features: [
    { key: 'dashboard_charts', name: 'نمودارهای آماری', description: 'نمودارهای تعاملی در صفحهٔ گزارش‌ها', locked: true },
    { key: 'students', name: 'گزارش دانش‌آموزان', description: 'ترکیب جمعیتی به تفکیک پایه، کلاس، جنسیت، وضعیت و سن' },
    { key: 'attendance', name: 'گزارش حضور و غیاب', description: 'نرخ غیبت و تأخیر هر کلاس در بازهٔ دلخواه' },
    { key: 'grades', name: 'گزارش نمرات', description: 'میانگین هر کلاس در هر درس و مقایسه' },
    { key: 'teachers', name: 'گزارش معلمان', description: 'بار کاری: تعداد کلاس، درس و ساعت هفتگی' },
    { key: 'print', name: 'نسخهٔ چاپی', description: 'چاپ تمیز گزارش‌ها بدون منو' },
    { key: 'export', name: 'خروجی CSV', description: 'دانلود جدول گزارش‌ها' }
  ],
  menu: [{ title: 'گزارش‌ها', href: '/reports', icon: 'bi-graph-up-arrow', roles: ['admin', 'staff'] }],
  routes: require('./routes')
};
