'use strict';
module.exports = {
  key: 'system', name: 'تنظیمات و سیستم', description: 'تنظیمات مدرسه، مدیریت ماژول‌ها، پشتیبان‌گیری، گزارش فعالیت و اطلاعات سامانه', icon: 'bi-gear', category: 'system', core: true, order: 800,
  features: [
    { key: 'school_info', name: 'اطلاعات و لوگوی مدرسه', description: 'نام، مقطع، تلفن، آدرس و لوگو', locked: true },
    { key: 'appearance', name: 'شخصی‌سازی ظاهر (رنگ اصلی و پوسته)', description: 'رنگ برند و پوستهٔ پیش‌فرض' },
    { key: 'modules', name: 'مدیریت ماژول‌ها و قابلیت‌ها', description: 'فعال/غیرفعال‌سازی هر ماژول و قابلیت', locked: true },
    { key: 'backup', name: 'پشتیبان‌گیری از پایگاه داده', description: 'دانلود نسخهٔ پشتیبان (SQLite / JSON)' },
    { key: 'activity_log', name: 'گزارش فعالیت کاربران', description: 'ثبت ایجاد/ویرایش/حذف و سایر اقدامات' },
    { key: 'sms_settings', name: 'تنظیمات درگاه پیامک', description: 'کاوه‌نگار یا وب‌هوک سفارشی' },
    { key: 'email_settings', name: 'تنظیمات ایمیل (SMTP)', description: 'ارسال ایمیل از طریق سرور SMTP' },
    { key: 'security_settings', name: 'تنظیمات امنیتی', description: 'تعداد تلاش ورود، مدت قفل، کپچا و طول نشست' },
    { key: 'demo_data', name: 'بارگذاری/حذف دادهٔ نمونه', description: 'برای آشنایی با سامانه' },
    { key: 'system_info', name: 'اطلاعات سامانه و سلامت سرویس', description: 'نسخهٔ Node، پایگاه داده، حافظه و زمان اجرا' },
    { key: 'jalali', name: 'تقویم شمسی و انتخابگر تاریخ', description: 'همیشه فعال', locked: true },
    { key: 'rtl_vazir', name: 'رابط راست‌چین با فونت وزیرمتن', description: 'همیشه فعال', locked: true },
    { key: 'dark_mode', name: 'حالت تاریک', description: 'دکمهٔ تغییر پوسته در نوار بالا' },
    { key: 'installer', name: 'ویزارد نصب وب و بازیابی اتصال', description: 'همیشه فعال', locked: true }
  ],
  menu: [
    { title: 'تنظیمات مدرسه', href: '/system/settings', icon: 'bi-sliders', roles: ['admin'] },
    { title: 'ماژول‌ها و قابلیت‌ها', href: '/system/modules', icon: 'bi-grid-1x2', roles: ['admin'] },
    { title: 'گزارش فعالیت', href: '/system/activity', icon: 'bi-clock-history', roles: ['admin'], feature: 'activity_log' },
    { title: 'پشتیبان‌گیری', href: '/system/backup', icon: 'bi-cloud-arrow-down', roles: ['admin'], feature: 'backup' },
    { title: 'اطلاعات سامانه', href: '/system/info', icon: 'bi-info-circle', roles: ['admin'], feature: 'system_info' }
  ],
  routes: require('./routes')
};
