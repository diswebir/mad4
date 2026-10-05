'use strict';
module.exports = {
  key: 'notifications', name: 'اعلان‌ها', description: 'اعلان درون‌برنامه‌ای، پیامک و ایمیل برای رویدادهای مهم؛ ارسال اعلان دستی به گروه‌ها', icon: 'bi-bell', category: 'communication', order: 64,
  features: [
    { key: 'inapp', name: 'اعلان درون‌برنامه‌ای', description: 'زنگولهٔ اعلان در نوار بالا و صفحهٔ فهرست اعلان‌ها', locked: true },
    { key: 'broadcast', name: 'ارسال اعلان دستی', description: 'مدیر می‌تواند به نقش، کلاس یا کاربر خاص اعلان بفرستد' },
    { key: 'sms', name: 'پیامک', description: 'ارسال پیامک از طریق درگاه (کاوه‌نگار / وب‌هوک) — نیازمند تنظیم کلید API' },
    { key: 'email', name: 'ایمیل', description: 'ارسال ایمیل از طریق SMTP' },
    { key: 'cleanup', name: 'پاک‌سازی خودکار', description: 'حذف اعلان‌های خوانده‌شدهٔ قدیمی‌تر از ۶۰ روز' },
    { key: 'retry_queue', name: 'صف تلاش مجدد پیامک/ایمیل', description: 'ارسال‌های ناموفق (خطای شبکه یا درگاه) در صف می‌مانند و با فاصلهٔ افزایشی (۲ دقیقه تا ۶ ساعت) دوباره ارسال می‌شوند؛ پس از سقف تلاش به مدیر اطلاع داده می‌شود' }
  ],
  jobs: [
    {
      key: 'notify_retry', name: 'تلاش مجدد ارسال پیامک/ایمیل', description: 'پردازش صف ارسال‌های ناموفق (هر ۱۵ دقیقه)', schedule: 'every15',
      async run() {
        if (!require('../../core/modules').isEnabled('notifications.retry_queue')) return 'صف تلاش مجدد غیرفعال است';
        const r = await require('../../core/notifyQueue').process();
        return r.processed ? `${r.processed} مورد پردازش شد: ${r.sent} ارسال، ${r.retry} در انتظار تلاش بعدی، ${r.failed} ناموفق نهایی` : 'موردی برای ارسال مجدد نبود';
      }
    }
  ],
  menu: [
    { title: 'اعلان‌ها', href: '/notifications', icon: 'bi-bell', roles: ['admin', 'staff', 'teacher', 'student', 'parent'], badge: 'notifications' },
    { title: 'ارسال اعلان', href: '/notifications/send', icon: 'bi-megaphone', roles: ['admin'], feature: 'broadcast' },
    { title: 'صف ارسال پیامک/ایمیل', href: '/system/notify-queue', icon: 'bi-hourglass-split', roles: ['admin'], permission: 'system.logs', feature: 'retry_queue' }
  ],
  routes: require('./routes')
};
