'use strict';
module.exports = {
  key: 'messages', name: 'پیام‌های داخلی', description: 'صندوق پیام داخلی بین مدیر، معلمان و دانش‌آموزان با پاسخ رشته‌ای و ارسال گروهی', icon: 'bi-envelope', category: 'communication', order: 61,
  features: [
    { key: 'internal', name: 'پیام خصوصی', description: 'ارسال و دریافت پیام بین کاربران مجاز', locked: true },
    { key: 'student_send', name: 'ارسال توسط دانش‌آموز', description: 'دانش‌آموز می‌تواند به معلمان کلاس خود و مدیریت پیام بدهد' },
    { key: 'broadcast', name: 'ارسال گروهی', description: 'ارسال یک پیام به همهٔ دانش‌آموزان یک کلاس یا یک نقش' },
    { key: 'threads', name: 'پاسخ رشته‌ای', description: 'نمایش گفتگو به‌صورت زنجیرهٔ پیام‌ها' },
    { key: 'read_receipt', name: 'رسید خواندن', description: 'نمایش زمان خوانده‌شدن پیام برای فرستنده' },
    { key: 'notify', name: 'اعلان پیام جدید', description: 'اعلان درون‌برنامه‌ای هنگام دریافت پیام' }
  ],
  menu: [{ title: 'پیام‌ها', href: '/messages', icon: 'bi-envelope', roles: ['admin', 'staff', 'teacher', 'student'], badge: 'messages' }],
  routes: require('./routes')
};
