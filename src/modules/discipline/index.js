'use strict';
module.exports = {
  key: 'discipline', name: 'انضباط و تشویق', description: 'ثبت موارد انضباطی منفی و امتیازهای مثبت، اطلاع به اولیا و گزارش کلاس/دانش‌آموز', icon: 'bi-shield-check', category: 'people', order: 45,
  features: [
    { key: 'negative', name: 'ثبت مورد انضباطی', description: 'تخلف، تأخیر، بی‌نظمی و… با امتیاز منفی', locked: true },
    { key: 'positive', name: 'ثبت تشویق', description: 'امتیاز مثبت برای رفتار و عملکرد خوب' },
    { key: 'points', name: 'امتیاز انضباطی', description: 'جمع امتیاز مثبت و منفی هر دانش‌آموز' },
    { key: 'parent_notify', name: 'اطلاع به اولیا', description: 'علامت‌گذاری اطلاع‌رسانی به والدین و ارسال پیامک در صورت فعال‌بودن' },
    { key: 'report', name: 'گزارش انضباطی', description: 'رتبه‌بندی کلاس و خلاصهٔ موارد در بازهٔ زمانی' },
    { key: 'student_view', name: 'نمایش به دانش‌آموز', description: 'دانش‌آموز سوابق انضباطی و تشویقی خود را می‌بیند' },
    { key: 'teacher_record', name: 'ثبت توسط معلم', description: 'معلمان برای دانش‌آموزان کلاس خود مورد ثبت می‌کنند' }
  ],
  menu: [
    { title: 'انضباط و تشویق', href: '/discipline', icon: 'bi-shield-check', roles: ['admin', 'teacher'], permission: ['discipline.view', 'discipline.manage'] },
    { title: 'سوابق انضباطی من', href: '/discipline/my', icon: 'bi-shield-check', roles: ['student', 'parent'], feature: 'student_view' }
  ],
  routes: require('./routes')
};
