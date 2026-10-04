'use strict';
module.exports = {
  key: 'support', name: 'پشتیبانی و گزارش خطا', description: 'دکمهٔ شناور «گزارش خطا» در همهٔ صفحات (با یک تصویر تا ۵ مگابایت)، پیگیری گزارش‌های کاربر، و درخواست فعال‌سازی ماژول توسط مدیر — همهٔ گزارش‌ها به کنسول سازنده می‌رسند', icon: 'bi-life-preserver', category: 'communication', order: 75,
  features: [
    { key: 'widget', name: 'دکمهٔ شناور گزارش خطا', description: 'پایین-چپ همهٔ صفحات برای همهٔ کاربران: نوع (خطا/پیشنهاد/سؤال)، عنوان، شرح، یک تصویر تا ۵ مگابایت و اطلاعات فنی صفحه به‌صورت خودکار' },
    { key: 'my_reports', name: 'پیگیری گزارش‌های من', description: 'فهرست گزارش‌های ارسالی کاربر با وضعیت و پاسخ سازنده' },
    { key: 'module_requests', name: 'درخواست فعال‌سازی ماژول', description: 'صفحهٔ «ماژول‌های سامانه» برای مدیر مدرسه: مشاهدهٔ ماژول‌ها/قابلیت‌های فعال و غیرفعال و ارسال درخواست فعال‌سازی به سازنده' }
  ],
  menu: [
    { title: 'ماژول‌های سامانه', href: '/support/modules', icon: 'bi-grid-1x2', roles: ['admin'], feature: 'module_requests' }
  ],
  routes: require('./routes')
};
