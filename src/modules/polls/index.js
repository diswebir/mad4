'use strict';
module.exports = {
  key: 'polls', name: 'نظرسنجی', description: 'نظرسنجی از دانش‌آموزان، معلمان یا یک کلاس با نمودار نتایج', icon: 'bi-bar-chart-steps', category: 'communication', order: 68,
  features: [
    { key: 'manage', name: 'مدیریت نظرسنجی', description: 'ایجاد نظرسنجی با گزینه‌های دلخواه، مخاطب و مهلت', locked: true },
    { key: 'vote', name: 'شرکت در نظرسنجی', description: 'کاربران مخاطب یک‌بار رأی می‌دهند', locked: true },
    { key: 'multiple', name: 'چندگزینه‌ای', description: 'امکان انتخاب چند گزینه در یک نظرسنجی' },
    { key: 'results_public', name: 'نمایش نتایج به رأی‌دهندگان', description: 'پس از رأی‌دادن، نتایج نمایش داده می‌شود' },
    { key: 'teacher_create', name: 'ایجاد توسط معلم', description: 'معلم برای کلاس خود نظرسنجی می‌سازد' }
  ],
  menu: [{ title: 'نظرسنجی', href: '/polls', icon: 'bi-bar-chart-steps', roles: ['admin', 'staff', 'teacher', 'student'] }],
  routes: require('./routes')
};
