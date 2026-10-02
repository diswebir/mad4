'use strict';
module.exports = {
  key: 'admissions', name: 'پیش‌ثبت‌نام و پذیرش', description: 'فرم عمومی پیش‌ثبت‌نام بدون نیاز به ورود، کد پیگیری، بررسی و پذیرش/رد توسط مدرسه و تبدیل به پروندهٔ دانش‌آموز', icon: 'bi-person-plus', category: 'people', order: 47,
  dependencies: ['students'],
  features: [
    { key: 'public_form', name: 'فرم عمومی پیش‌ثبت‌نام', description: 'صفحهٔ /apply برای اولیا با اعتبارسنجی کد ملی، شمارهٔ موبایل و تاریخ شمسی', locked: true },
    { key: 'tracking', name: 'پیگیری با کد رهگیری', description: 'استعلام وضعیت درخواست با کد و کد ملی (بدون ورود)' },
    { key: 'attachments', name: 'بارگذاری مدارک', description: 'پیوست تصویر شناسنامه/کارنامه (تصویر یا PDF تا ۵ مگابایت)' },
    { key: 'review', name: 'بررسی و پذیرش', description: 'تغییر وضعیت (در حال بررسی، نیازمند مدارک، پذیرفته، رد) با یادداشت داخلی و پیام به خانواده', locked: true },
    { key: 'enroll', name: 'ثبت‌نام قطعی', description: 'تبدیل درخواست پذیرفته‌شده به پروندهٔ دانش‌آموز با انتخاب کلاس و ساخت حساب کاربری' },
    { key: 'notify', name: 'پیامک نتیجه', description: 'ارسال پیامک کد رهگیری هنگام ثبت و اطلاع‌رسانی تغییر وضعیت به شمارهٔ پدر' },
    { key: 'export', name: 'خروجی CSV', description: 'دانلود فهرست درخواست‌ها با فیلتر' },
    { key: 'login_link', name: 'لینک در صفحهٔ ورود', description: 'نمایش دکمهٔ پیش‌ثبت‌نام در صفحهٔ ورود هنگام باز بودن ثبت‌نام' }
  ],
  menu: [
    { title: 'پیش‌ثبت‌نام', href: '/admissions', icon: 'bi-person-plus', roles: ['admin'], permission: 'admissions.manage' }
  ],
  routes: require('./routes')
};
