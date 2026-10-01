'use strict';
module.exports = {
  key: 'health', name: 'سلامت و بهداشت', description: 'سوابق پزشکی، معاینات دوره‌ای، حوادث، واکسیناسیون و ارجاع‌ها به همراه اطلاعات پزشکی پروندهٔ دانش‌آموز', icon: 'bi-heart-pulse', category: 'people', order: 46,
  features: [
    { key: 'records', name: 'سوابق سلامت', description: 'ثبت معاینه، بیماری، حادثه و واکسن برای هر دانش‌آموز', locked: true },
    { key: 'alerts', name: 'هشدار حساسیت و بیماری', description: 'نمایش دانش‌آموزان دارای حساسیت/بیماری خاص به معلمان کلاس' },
    { key: 'student_view', name: 'نمایش به دانش‌آموز', description: 'دانش‌آموز سوابق سلامت خود را می‌بیند' },
    { key: 'referral', name: 'ارجاع به مراکز درمانی', description: 'علامت‌گذاری موارد ارجاع‌شده و پیگیری' }
  ],
  menu: [
    { title: 'سلامت', href: '/health', icon: 'bi-heart-pulse', roles: ['admin', 'staff'] },
    { title: 'هشدارهای سلامت کلاس', href: '/health/alerts', icon: 'bi-heart-pulse', roles: ['teacher'], feature: 'alerts' },
    { title: 'سوابق سلامت من', href: '/health/my', icon: 'bi-heart-pulse', roles: ['student'], feature: 'student_view' }
  ],
  routes: require('./routes')
};
