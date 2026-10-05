'use strict';
module.exports = {
  key: 'lessons', name: 'دفتر کلاسی و گزارش تدریس', description: 'ثبت گزارش هر جلسهٔ تدریس بر اساس برنامهٔ هفتگی، سرفصل‌ها و بودجه‌بندی، پیشرفت تدریس، جلسات ثبت‌نشده و نمایش «امروز چه درس دادیم» برای دانش‌آموز و ولی', icon: 'bi-journal-bookmark', category: 'academic', order: 36,
  dependencies: ['academic'],
  features: [
    { key: 'log', name: 'گزارش تدریس', description: 'ثبت موضوع، شرح و تکلیف هر جلسه (کلاس، درس، تاریخ، زنگ)', locked: true },
    { key: 'today', name: 'تدریس امروز', description: 'جلسات امروز معلم بر اساس برنامهٔ هفتگی با ثبت سریع؛ پایش وضعیت ثبت برای مدیر' },
    { key: 'syllabus', name: 'سرفصل‌ها و بودجه‌بندی', description: 'تعریف سرفصل هر درس با ساعت و بازهٔ زمانی برنامه‌ریزی‌شده' },
    { key: 'coverage', name: 'پیشرفت تدریس', description: 'درصد سرفصل‌های تدریس‌شده و مقایسه با بودجه‌بندی برای هر کلاس/درس' },
    { key: 'missing', name: 'جلسات ثبت‌نشده', description: 'مقایسهٔ برنامهٔ هفتگی با گزارش‌های ثبت‌شده و فهرست جلسات بدون گزارش به تفکیک معلم' },
    { key: 'edit_window', name: 'مهلت ویرایش معلم', description: 'ویرایش/حذف گزارش توسط معلم فقط تا چند روز پس از جلسه (تنظیمات آموزشی)' },
    { key: 'student_view', name: 'درس‌های من', description: 'نمایش آنچه در کلاس تدریس شده و تکلیف هر جلسه برای دانش‌آموز و ولی' },
    { key: 'register', name: 'دفتر کلاسی ماهانه', description: 'دفتر کلاسی هر کلاس در یک ماه (روز × زنگ) با قابلیت چاپ' },
    { key: 'export', name: 'خروجی CSV', description: 'دانلود گزارش‌های تدریس با فیلتر' }
  ],
  menu: [
    { title: 'دفتر کلاسی', href: '/lessons', icon: 'bi-journal-bookmark', roles: ['admin', 'teacher'], permission: 'lessons.manage' },
    { title: 'تدریس امروز', href: '/lessons/today', icon: 'bi-calendar-check', roles: ['teacher'], feature: 'today' },
    { title: 'درس‌های من', href: '/lessons/my', icon: 'bi-journal-bookmark', roles: ['student', 'parent'], feature: 'student_view' }
  ],
  routes: require('./routes')
};
