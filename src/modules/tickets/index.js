'use strict';
module.exports = {
  key: 'tickets', name: 'تیکت و پشتیبانی', description: 'ارتباط دانش‌آموز/اولیا با معلم و مدیریت از طریق تیکت: پاسخ‌دهی، ارجاع، اولویت، دسته‌بندی، پیوست، امتیازدهی', icon: 'bi-chat-left-text', category: 'communication', order: 60,
  features: [
    { key: 'student', name: 'ثبت تیکت توسط دانش‌آموز', description: 'دانش‌آموز می‌تواند برای مدیریت یا معلم کلاس خود تیکت ثبت کند', locked: true },
    { key: 'teacher_create', name: 'ثبت تیکت توسط معلم', description: 'معلمان می‌توانند با مدیریت مکاتبه کنند' },
    { key: 'replies', name: 'گفتگوی رشته‌ای', description: 'پاسخ‌های متوالی با تاریخچهٔ کامل', locked: true },
    { key: 'status', name: 'چرخهٔ وضعیت', description: 'باز، پاسخ داده شده، در انتظار کاربر، بسته' },
    { key: 'priority', name: 'اولویت', description: 'کم، عادی، زیاد، فوری' },
    { key: 'categories', name: 'دسته‌بندی موضوعی', description: 'آموزشی، حضور و غیاب، مالی، فنی و…' },
    { key: 'attachments', name: 'پیوست فایل', description: 'ارسال تصویر یا PDF همراه پیام' },
    { key: 'assign', name: 'ارجاع به کاربر', description: 'مدیر می‌تواند تیکت را به معلم یا کارمند ارجاع دهد' },
    { key: 'internal_notes', name: 'یادداشت داخلی', description: 'پیام‌های محرمانهٔ کارکنان که دانش‌آموز نمی‌بیند' },
    { key: 'rating', name: 'امتیاز به پاسخ', description: 'دانش‌آموز پس از بسته‌شدن تیکت به پاسخ امتیاز می‌دهد' },
    { key: 'canned', name: 'پاسخ‌های آماده', description: 'الگوهای پاسخ برای کارکنان' },
    { key: 'sla', name: 'هشدار تیکت‌های بی‌پاسخ', description: 'نمایش تیکت‌هایی که بیش از حد مجاز بی‌پاسخ مانده‌اند' },
    { key: 'stats', name: 'آمار و گزارش تیکت‌ها', description: 'به تفکیک وضعیت، دسته، زمان پاسخ' },
    { key: 'notify', name: 'اعلان تیکت', description: 'اعلان درون‌برنامه‌ای برای پاسخ و ارجاع' },
    { key: 'export', name: 'خروجی CSV', description: 'دانلود فهرست تیکت‌ها' }
  ],
  menu: [
    { title: 'تیکت‌ها', href: '/tickets', icon: 'bi-chat-left-text', roles: ['admin', 'staff', 'teacher', 'student', 'parent'], badge: 'tickets' }
  ],
  routes: require('./routes')
};
