'use strict';
module.exports = {
  key: 'teachers', name: 'معلمان و کادر آموزشی', description: 'پروندهٔ معلمان، حساب کاربری، کلاس‌ها، بار کاری و مدارک', icon: 'bi-person-video3', category: 'people', core: true, order: 30,
  features: [
    { key: 'manage', name: 'مدیریت معلمان', description: 'ثبت معلم همراه با ساخت خودکار حساب کاربری', locked: true },
    { key: 'profile', name: 'پروندهٔ معلم', description: 'اطلاعات شخصی، استخدامی و تحصیلی' },
    { key: 'my_classes', name: 'کلاس‌های من (پنل معلم)', description: 'فهرست کلاس‌ها و دروس معلم با دسترسی سریع' },
    { key: 'workload', name: 'بار کاری و ساعت تدریس', description: 'جمع ساعات هفتگی هر معلم' },
    { key: 'documents', name: 'مدارک و فایل‌های معلم', description: 'بارگذاری حکم، مدرک تحصیلی و…' },
    { key: 'export', name: 'خروجی CSV معلمان', description: 'دانلود فهرست معلمان' },
    { key: 'directory', name: 'دفترچهٔ تماس همکاران', description: 'نمایش شمارهٔ همکاران به معلمان' }
  ],
  menu: [
    { title: 'معلمان', href: '/teachers', icon: 'bi-person-video3', roles: ['admin'], permission: ['teachers.view', 'teachers.manage'] },
    { title: 'کلاس‌های من', href: '/teachers/my-classes', icon: 'bi-easel', roles: ['teacher'], feature: 'my_classes' },
    { title: 'همکاران', href: '/teachers/directory', icon: 'bi-people', roles: ['teacher'], feature: 'directory' }
  ],
  routes: require('./routes')
};
