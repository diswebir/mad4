'use strict';
module.exports = {
  key: 'attendance', name: 'حضور و غیاب', description: 'ثبت روزانه و زنگ‌به‌زنگ، گزارش‌ها، تأییدیهٔ غیبت، هشدار و اعلان به ولی', icon: 'bi-clipboard-check', category: 'daily', order: 50,
  features: [
    { key: 'daily', name: 'حضور و غیاب روزانه', description: 'ثبت یک‌بار در روز توسط معلم راهنما/مدیر' },
    { key: 'per_subject', name: 'حضور و غیاب زنگ‌به‌زنگ', description: 'ثبت به تفکیک درس توسط معلم همان درس' },
    { key: 'statuses', name: 'وضعیت‌های تکمیلی (تأخیر، موجه، مرخصی)', description: 'علاوه بر حاضر/غایب با ثبت دقیقهٔ تأخیر' },
    { key: 'quick_all_present', name: 'ثبت سریع «همه حاضر»', description: 'یک کلیک برای پیش‌فرض حاضر' },
    { key: 'edit_window', name: 'محدودیت ویرایش برای معلمان', description: 'معلم فقط تا ۳ روز پس از تاریخ می‌تواند ویرایش کند' },
    { key: 'student_report', name: 'گزارش دانش‌آموز', description: 'کارنامهٔ حضور با نمودار ماهانه' },
    { key: 'class_report', name: 'گزارش کلاس', description: 'آمار هر دانش‌آموز در بازهٔ دلخواه' },
    { key: 'daily_report', name: 'گزارش روزانهٔ مدرسه', description: 'وضعیت همهٔ کلاس‌ها در یک روز' },
    { key: 'monthly_report', name: 'دفتر حضور ماهانه', description: 'جدول دانش‌آموز × روز برای یک ماه شمسی' },
    { key: 'excuses', name: 'درخواست موجه‌شدن غیبت', description: 'ارسال توضیح و مدرک توسط دانش‌آموز و تأیید مدیر' },
    { key: 'notify', name: 'اعلان غیبت به دانش‌آموز/ولی', description: 'اعلان درون‌برنامه‌ای و پیامک (در صورت فعال‌بودن)' },
    { key: 'alerts', name: 'هشدار غیبت‌های مکرر', description: 'فهرست دانش‌آموزان با غیبت بیش از آستانه در ۳۰ روز اخیر' },
    { key: 'export', name: 'خروجی CSV', description: 'دانلود رکوردهای حضور و غیاب' },
    { key: 'dashboard_stats', name: 'آمار حضور در داشبورد', description: 'نرخ حضور امروز و روند هفتگی' },
    { key: 'staff', name: 'حضور و غیاب کارکنان', description: 'ثبت حضور معلمان و کادر با ساعت ورود/خروج' },
    { key: 'my', name: 'مشاهدهٔ حضور توسط دانش‌آموز', description: 'تقویم ماهانهٔ حضور در پنل دانش‌آموز' }
  ],
  menu: [
    { title: 'حضور و غیاب', href: '/attendance', icon: 'bi-clipboard-check', roles: ['admin', 'staff', 'teacher'] },
    { title: 'حضور و غیاب من', href: '/attendance/my', icon: 'bi-clipboard-check', roles: ['student', 'parent'], feature: 'my' },
    { title: 'درخواست‌های موجه', href: '/attendance/excuses', icon: 'bi-file-earmark-medical', roles: ['admin', 'staff', 'teacher', 'student'], feature: 'excuses' },
    { title: 'حضور کارکنان', href: '/attendance/staff', icon: 'bi-person-check', roles: ['admin'], feature: 'staff' }
  ],
  routes: require('./routes')
};
