'use strict';
module.exports = {
  key: 'parents', name: 'پنل اولیا', description: 'حساب کاربری برای پدر/مادر/سرپرست با دسترسی به پروندهٔ فرزند، حضور و غیاب، نمرات، تکالیف، مالی و ارتباط با مدرسه', icon: 'bi-people-fill', category: 'people', order: 45,
  features: [
    { key: 'accounts', name: 'حساب کاربری اولیا', description: 'ساخت/پیوند حساب ولی از پروندهٔ دانش‌آموز (نام کاربری = موبایل)', locked: true },
    { key: 'panel', name: 'پنل ولی', description: 'داشبورد اختصاصی ولی با خلاصهٔ وضعیت فرزند و میان‌برها', locked: true },
    { key: 'multi_child', name: 'چند فرزند', description: 'سوئیچ بین فرزندان در یک حساب (خواهر/برادر با شمارهٔ موبایل مشترک)' },
    { key: 'bulk_create', name: 'ساخت گروهی حساب', description: 'ساخت حساب برای همهٔ دانش‌آموزان بدون ولی بر اساس شمارهٔ پدر/مادر' },
    { key: 'sms_credentials', name: 'پیامک اطلاعات ورود', description: 'ارسال نام کاربری و رمز به موبایل ولی' },
    { key: 'absence_sms', name: 'پیامک غیبت به ولی', description: 'اطلاع‌رسانی خودکار غیبت روزانه به اولیا (کار زمان‌بندی‌شده)' },
    { key: 'messaging', name: 'پیام و تیکت اولیا', description: 'ارسال پیام به معلمان فرزند و ثبت تیکت از طرف ولی' },
    { key: 'export', name: 'خروجی CSV اولیا', description: 'فهرست اولیا با فرزندان' }
  ],
  menu: [
    { title: 'پنل اولیا', href: '/parents/panel', icon: 'bi-house-heart', roles: ['parent'], feature: 'panel' },
    { title: 'اولیا', href: '/parents', icon: 'bi-people-fill', roles: ['admin'], permission: 'parents.manage', feature: 'accounts' }
  ],
  routes: require('./routes')
};
