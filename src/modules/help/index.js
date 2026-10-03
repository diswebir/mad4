'use strict';
module.exports = {
  key: 'help', name: 'راهنما و راه‌اندازی', description: 'راهنمای کاربری نقش‌محور داخل سامانه، چک‌لیست زندهٔ راه‌اندازی اولیه برای مدیر، دکمهٔ راهنمای زمینه‌ای و صفحهٔ دربارهٔ سامانه', icon: 'bi-life-preserver', category: 'system', order: 900,
  features: [
    { key: 'guide', name: 'راهنمای کاربری', description: 'راهنمای گام‌به‌گام برای مدیر، معلم، دانش‌آموز و اولیا؛ بخش‌های مربوط به ماژول‌های خاموش پنهان می‌شوند' },
    { key: 'checklist', name: 'چک‌لیست راه‌اندازی اولیه', description: 'وضعیت زندهٔ گام‌های راه‌اندازی (اطلاعات مدرسه، رمز مدیر، سال تحصیلی، کلاس‌ها، معلمان، دانش‌آموزان، پیامک، پشتیبان‌گیری…) با پیشرفت درصدی و ویجت داشبورد' },
    { key: 'contextual', name: 'راهنمای زمینه‌ای', description: 'دکمهٔ «؟» در نوار بالا که به بخش مرتبط با صفحهٔ جاری می‌رود' },
    { key: 'about', name: 'دربارهٔ سامانه', description: 'نسخه، ماژول‌ها و قابلیت‌های فعال، محیط اجرا و راهنمای به‌روزرسانی' }
  ],
  menu: [
    { title: 'راه‌اندازی اولیه', href: '/help/setup', icon: 'bi-check2-square', roles: ['admin'], feature: 'checklist' },
    { title: 'راهنما', href: '/help', icon: 'bi-life-preserver', feature: 'guide' }
  ],
  routes: require('./routes')
};
