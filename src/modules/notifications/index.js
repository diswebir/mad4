'use strict';
module.exports = {
  key: 'notifications', name: 'اعلان‌ها', description: 'اعلان درون‌برنامه‌ای، پیامک و ایمیل برای رویدادهای مهم؛ ارسال اعلان دستی به گروه‌ها', icon: 'bi-bell', category: 'communication', order: 64,
  features: [
    { key: 'inapp', name: 'اعلان درون‌برنامه‌ای', description: 'زنگولهٔ اعلان در نوار بالا و صفحهٔ فهرست اعلان‌ها', locked: true },
    { key: 'broadcast', name: 'ارسال اعلان دستی', description: 'مدیر می‌تواند به نقش، کلاس یا کاربر خاص اعلان بفرستد' },
    { key: 'sms', name: 'پیامک', description: 'ارسال پیامک از طریق درگاه (کاوه‌نگار / وب‌هوک) — نیازمند تنظیم کلید API' },
    { key: 'email', name: 'ایمیل', description: 'ارسال ایمیل از طریق SMTP' },
    { key: 'cleanup', name: 'پاک‌سازی خودکار', description: 'حذف اعلان‌های خوانده‌شدهٔ قدیمی‌تر از ۶۰ روز' }
  ],
  menu: [
    { title: 'اعلان‌ها', href: '/notifications', icon: 'bi-bell', roles: ['admin', 'staff', 'teacher', 'student'], badge: 'notifications' },
    { title: 'ارسال اعلان', href: '/notifications/send', icon: 'bi-megaphone', roles: ['admin'], feature: 'broadcast' }
  ],
  routes: require('./routes')
};
