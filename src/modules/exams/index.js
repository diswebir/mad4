'use strict';
module.exports = {
  key: 'exams', name: 'آزمون‌ها و نمرات', description: 'تعریف آزمون، ثبت نمره (عددی/توصیفی)، کارنامه، رتبه‌بندی، تحلیل و چاپ', icon: 'bi-award', category: 'academic', order: 55,
  features: [
    { key: 'manage', name: 'تعریف آزمون', description: 'کوئیز، میان‌ترم، پایان‌ترم، شفاهی، عملی با بارم و ضریب', locked: true },
    { key: 'grades', name: 'ثبت نمرات', description: 'برگهٔ ورود نمره برای کل کلاس با ذخیرهٔ یکجا', locked: true },
    { key: 'publish', name: 'انتشار نمرات', description: 'نمرات تا زمان انتشار برای دانش‌آموز نمایش داده نمی‌شود' },
    { key: 'descriptive', name: 'ارزشیابی توصیفی', description: 'خیلی خوب / خوب / قابل قبول / نیاز به تلاش برای پایه‌های توصیفی' },
    { key: 'report_card', name: 'کارنامه', description: 'کارنامهٔ هر نوبت با معدل، رتبه و نظر معلم' },
    { key: 'gpa', name: 'معدل و رتبه‌بندی', description: 'محاسبهٔ معدل وزنی و رتبهٔ دانش‌آموز در کلاس' },
    { key: 'print', name: 'چاپ کارنامه', description: 'نسخهٔ چاپی کارنامه برای تحویل به اولیا' },
    { key: 'class_sheet', name: 'ریزنمرات کلاس', description: 'جدول نمرات همهٔ دانش‌آموزان × دروس' },
    { key: 'schedule', name: 'برنامهٔ آزمون‌ها', description: 'فهرست آزمون‌های پیش رو برای دانش‌آموز، معلم و مدیر' },
    { key: 'student_view', name: 'مشاهدهٔ نمرات توسط دانش‌آموز', description: 'پنل نمرات و کارنامهٔ شخصی' },
    { key: 'analytics', name: 'تحلیل نمرات', description: 'نمودار توزیع نمرات، میانگین دروس و مقایسهٔ کلاس‌ها' },
    { key: 'remarks', name: 'نظر معلم در کارنامه', description: 'توضیح معلم راهنما برای هر نوبت' },
    { key: 'notify', name: 'اعلان ثبت نمره', description: 'اطلاع‌رسانی به دانش‌آموز هنگام انتشار نمرات' },
    { key: 'export', name: 'خروجی CSV نمرات', description: 'دانلود ریزنمرات' },
    { key: 'lock', name: 'قفل نمرات نوبت', description: 'پس از نهایی شدن نوبت، نمرات فقط با مجوز «قفل نمرات» و ثبت دلیل قابل تغییرند' },
    { key: 'history', name: 'تاریخچهٔ تغییر نمرات', description: 'ثبت هر تغییر نمره با مقدار قبلی/جدید، کاربر، زمان و دلیل' }
  ],
  menu: [
    { title: 'آزمون‌ها و نمرات', href: '/exams', icon: 'bi-award', roles: ['admin', 'teacher'], permission: ['exams.view_all', 'exams.manage_all'] },
    { title: 'نمرات من', href: '/exams/my', icon: 'bi-award', roles: ['student', 'parent'], feature: 'student_view' }
  ],
  routes: require('./routes')
};
