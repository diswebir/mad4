'use strict';
module.exports = {
  key: 'documents', name: 'اسناد رسمی و گواهی‌ها', description: 'صدور گواهی اشتغال به تحصیل، نامه با سربرگ، کارنامهٔ رسمی، ریزنمرات و دفتر حضور و غیاب با شمارهٔ سریال، امضا/مهر و استعلام اصالت', icon: 'bi-file-earmark-ruled', category: 'services', order: 62,
  dependencies: ['students'],
  features: [
    { key: 'letterhead', name: 'سربرگ، امضا و مهر', description: 'سربرگ رسمی (آرم، عنوان اداره، نام مدرسه) و تصویر امضا/مهر مدیر در پایین اسناد', locked: true },
    { key: 'serials', name: 'شماره‌گذاری خودکار', description: 'سریال یکتا به‌ازای نوع سند و سال تحصیلی (مثل گ-۱۴۰۵-۰۰۰۱) و بایگانی اسناد صادرشده', locked: true },
    { key: 'certificates', name: 'گواهی اشتغال به تحصیل', description: 'صدور گواهی با قالب قابل ویرایش و متغیرهای خودکار از پروندهٔ دانش‌آموز' },
    { key: 'letters', name: 'نامه و معرفی‌نامه', description: 'نامهٔ رسمی با سربرگ برای دانش‌آموز یا مکاتبات عمومی' },
    { key: 'report_card', name: 'کارنامهٔ رسمی', description: 'کارنامهٔ نوبت با سربرگ، سریال و ثبت نسخهٔ ثابت (snapshot) در زمان صدور' },
    { key: 'grade_sheet', name: 'ریزنمرات رسمی درس', description: 'جدول نمرات همهٔ آزمون‌های یک درس برای کلاس با سربرگ' },
    { key: 'roster', name: 'دفتر حضور و غیاب ماهانه', description: 'جدول چاپی حضور و غیاب روزانهٔ کلاس برای یک ماه' },
    { key: 'verify', name: 'استعلام اصالت سند', description: 'صفحهٔ عمومی بررسی اصالت با کد چاپ‌شده روی سند' },
    { key: 'revoke', name: 'ابطال سند', description: 'ابطال سند صادرشده با ثبت دلیل؛ در استعلام «باطل» نمایش داده می‌شود' },
    { key: 'student_view', name: 'مشاهدهٔ اسناد توسط دانش‌آموز/ولی', description: 'فهرست و چاپ مجدد اسناد صادرشدهٔ خود' }
  ],
  menu: [
    { title: 'اسناد و گواهی‌ها', href: '/documents', icon: 'bi-file-earmark-ruled', roles: ['admin'], permission: 'documents.issue' },
    { title: 'گواهی‌های من', href: '/documents/my', icon: 'bi-file-earmark-ruled', roles: ['student', 'parent'], feature: 'student_view' }
  ],
  routes: require('./routes')
};
