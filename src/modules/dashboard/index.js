'use strict';
module.exports = {
  key: 'dashboard', name: 'داشبورد', description: 'داشبورد اختصاصی مدیر، معلم و دانش‌آموز با آمار، نمودار و دسترسی سریع', icon: 'bi-speedometer2', category: 'main', core: true, order: 1,
  features: [
    { key: 'admin', name: 'داشبورد مدیر با آمار کلی', description: 'تعداد دانش‌آموزان، معلمان، کلاس‌ها و حضور امروز', locked: true },
    { key: 'teacher', name: 'داشبورد معلم', description: 'کلاس‌های من، برنامهٔ امروز و کارهای در انتظار', locked: true },
    { key: 'student', name: 'پنل دانش‌آموز', description: 'خلاصهٔ حضور، نمرات، تکالیف و اطلاعیه‌ها', locked: true },
    { key: 'charts', name: 'نمودارهای تحلیلی', description: 'روند حضور، توزیع پایه‌ها و جنسیت (Chart.js)' },
    { key: 'quick_actions', name: 'دسترسی سریع', description: 'میانبرهای پرکاربرد بر اساس نقش' },
    { key: 'pending', name: 'کارهای در انتظار اقدام', description: 'تیکت‌های باز، درخواست‌های موجه‌سازی، مرخصی‌ها' },
    { key: 'birthdays', name: 'تولدهای امروز و این هفته', description: 'یادآوری تولد دانش‌آموزان' }
  ],
  menu: [{ title: 'داشبورد', href: '/dashboard', icon: 'bi-speedometer2' }],
  routes: require('./routes')
};
