'use strict';
module.exports = {
  key: 'users', name: 'کاربران', description: 'مدیریت حساب‌های کاربری، نقش‌ها، فعال/غیرفعال‌سازی و بازنشانی رمز', icon: 'bi-person-badge', category: 'system', core: false, order: 850,
  features: [
    { key: 'manage', name: 'مدیریت کاربران و نقش‌ها', description: 'ایجاد حساب مدیر/کارمند، ویرایش و حذف', locked: true },
    { key: 'profile', name: 'ویرایش پروفایل و تصویر توسط کاربر', description: 'ایمیل، موبایل، آواتار و پوسته' },
    { key: 'reset_password', name: 'بازنشانی رمز توسط مدیر', description: 'تعیین رمز جدید با اجبار تغییر در ورود بعدی' },
    { key: 'status', name: 'فعال/غیرفعال‌سازی حساب', description: 'مسدودکردن ورود بدون حذف داده' }
  ],
  menu: [{ title: 'کاربران', href: '/users', icon: 'bi-person-badge', roles: ['admin'] }],
  routes: require('./routes')
};
