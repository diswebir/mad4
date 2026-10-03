'use strict';
module.exports = {
  key: 'academic', name: 'ساختار آموزشی', description: 'سال تحصیلی، نوبت‌ها، پایه‌ها، دروس، کلاس‌ها، تخصیص معلم و برنامهٔ هفتگی', icon: 'bi-mortarboard', category: 'academic', core: true, order: 20,
  features: [
    { key: 'years', name: 'سال تحصیلی و نوبت‌ها (ترم‌ها)', description: 'تعریف سال جاری و نوبت اول/دوم', locked: true },
    { key: 'grade_levels', name: 'پایه‌های تحصیلی', description: 'ابتدایی تا متوسطه با نوع ارزشیابی', locked: true },
    { key: 'subjects', name: 'دروس', description: 'تعریف درس با کد و ساعت هفتگی', locked: true },
    { key: 'classes', name: 'کلاس‌ها و معلم راهنما', description: 'ایجاد کلاس، ظرفیت، شیفت و معلم سرپرست', locked: true },
    { key: 'class_subjects', name: 'تخصیص درس و معلم به کلاس', description: 'هر درس کلاس به یک معلم' },
    { key: 'rooms', name: 'اتاق‌ها و فضاهای آموزشی', description: 'کلاس فیزیکی، آزمایشگاه، سالن' },
    { key: 'schedule', name: 'برنامهٔ هفتگی کلاس و معلم', description: 'جدول زنگ‌ها به تفکیک روز' },
    { key: 'schedule_print', name: 'چاپ برنامهٔ هفتگی', description: 'نسخهٔ قابل چاپ' },
    { key: 'class_stats', name: 'آمار و نمای کلی کلاس', description: 'تعداد، جنسیت، میانگین حضور و نمرات در صفحهٔ کلاس' },
    { key: 'promote', name: 'ارتقای گروهی دانش‌آموزان', description: 'انتقال همهٔ دانش‌آموزان یک کلاس به کلاس دیگر (پایان سال)' },
    { key: 'year_close', name: 'پایان سال تحصیلی و ارتقای پایه', description: 'ویزارد بستن سال: ساخت سال و نوبت‌های جدید، کلاس‌های پایهٔ بالاتر، ارتقا/تکرار پایه/فارغ‌التحصیلی دانش‌آموزان با پیش‌نمایش و قابلیت بازگردانی' },
  ],
  menu: [
    { title: 'کلاس‌ها', href: '/academic/classes', icon: 'bi-door-open', roles: ['admin', 'teacher'], permission: ['academic.manage', 'students.view'] },
    { title: 'برنامه هفتگی', href: '/academic/schedule', icon: 'bi-table', roles: ['admin', 'teacher', 'student', 'parent'], permission: ['academic.schedule', 'academic.manage', 'students.view'], feature: 'schedule' },
    { title: 'دروس', href: '/academic/subjects', icon: 'bi-book', roles: ['admin'], permission: 'academic.manage' },
    { title: 'پایه‌ها', href: '/academic/grade-levels', icon: 'bi-layers', roles: ['admin'], permission: 'academic.manage' },
    { title: 'سال تحصیلی', href: '/academic/years', icon: 'bi-calendar-range', roles: ['admin'] },
    { title: 'اتاق‌ها', href: '/academic/rooms', icon: 'bi-building', roles: ['admin'], permission: 'academic.manage', feature: 'rooms' }
  ],
  routes: require('./routes')
};
