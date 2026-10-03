'use strict';
module.exports = {
  key: 'library', name: 'کتابخانه', description: 'فهرست کتاب‌ها، امانت و بازگشت، دیرکرد، سقف امانت و جستجو', icon: 'bi-book', category: 'services', order: 75,
  features: [
    { key: 'books', name: 'مدیریت کتاب‌ها', description: 'ثبت کتاب با نویسنده، ناشر، شابک، قفسه و تعداد نسخه', locked: true },
    { key: 'loans', name: 'امانت و بازگشت', description: 'ثبت امانت به دانش‌آموز یا همکار و بازگشت', locked: true },
    { key: 'overdue', name: 'پیگیری دیرکرد', description: 'فهرست امانت‌های سررسیدگذشته و ارسال یادآوری' },
    { key: 'limits', name: 'سقف امانت', description: 'محدودیت تعداد کتاب هم‌زمان برای هر نفر (تنظیمات)' },
    { key: 'student_view', name: 'امانت‌های من', description: 'دانش‌آموز کتاب‌های امانتی و تاریخ بازگشت خود را می‌بیند' },
    { key: 'catalog', name: 'جستجوی کتاب برای دانش‌آموز', description: 'مشاهدهٔ فهرست کتاب‌ها و موجودی' },
    { key: 'export', name: 'خروجی CSV', description: 'دانلود فهرست کتاب‌ها و امانت‌ها' },
    { key: 'scan', name: 'امانت سریع با اسکن بارکد', description: 'در فرم امانت، با اسکن بارکد کارت دانش‌آموزی (یا تایپ شمارهٔ دانش‌آموزی/شابک کتاب + Enter) امانت‌گیرنده و کتاب خودکار انتخاب می‌شوند' }
  ],
  menu: [
    { title: 'کتابخانه', href: '/library', icon: 'bi-book', roles: ['admin', 'teacher'], permission: 'library.manage' },
    { title: 'کتابخانه', href: '/library/my', icon: 'bi-book', roles: ['student', 'parent'], feature: 'student_view' }
  ],
  jobs: require('./jobs'),
  routes: require('./routes')
};
