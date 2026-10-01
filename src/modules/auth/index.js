'use strict';
module.exports = {
  key: 'auth', name: 'احراز هویت و امنیت', description: 'ورود امن، محدودیت تلاش ناموفق، کپچا، تاریخچهٔ ورود و ورود به جای کاربر', icon: 'bi-shield-lock', category: 'system', core: true, order: 900,
  features: [
    { key: 'login_throttle', name: 'محدودیت تلاش‌های ناموفق ورود', description: 'پس از چند تلاش ناموفق، ورود برای مدتی مسدود می‌شود' },
    { key: 'captcha', name: 'سؤال امنیتی (کپچا) در صفحهٔ ورود', description: 'یک جمع سادهٔ ریاضی برای جلوگیری از ربات‌ها' },
    { key: 'remember_me', name: 'مرا به خاطر بسپار', description: 'نشست طولانی‌مدت برای کاربران' },
    { key: 'force_password_change', name: 'اجبار تغییر رمز در اولین ورود', description: 'برای حساب‌های تازه‌ساخته‌شده یا بازنشانی‌شده' },
    { key: 'impersonate', name: 'ورود به جای کاربر (توسط مدیر)', description: 'مدیر می‌تواند سامانه را از دید معلم یا دانش‌آموز ببیند' },
    { key: 'password_reset', name: 'بازیابی رمز عبور (فراموشی رمز)', description: 'کد یک‌بارمصرف ۶ رقمی با پیامک/ایمیل، اعتبار ۱۰ دقیقه، حداکثر ۳ درخواست در ساعت و ۵ تلاش برای هر کد' },
    { key: 'login_history', name: 'تاریخچهٔ ورود کاربران', description: 'ثبت IP، مرورگر و زمان هر ورود' },
    { key: 'csrf', name: 'محافظت CSRF و هدرهای امنیتی', description: 'همیشه فعال', locked: true },
    { key: 'session_db', name: 'نشست‌های پایدار روی پایگاه داده', description: 'همیشه فعال', locked: true }
  ],
  menu: []
};
