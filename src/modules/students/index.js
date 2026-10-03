'use strict';
module.exports = {
  key: 'students', name: 'دانش‌آموزان و پرونده', description: 'پروندهٔ کامل دانش‌آموز: هویتی، اولیا، تماس، پزشکی، مدارک، یادداشت‌ها، سوابق', icon: 'bi-people', category: 'people', core: true, order: 40,
  features: [
    { key: 'manage', name: 'مدیریت دانش‌آموزان', description: 'ثبت‌نام، ویرایش، حذف', locked: true },
    { key: 'user_account', name: 'ساخت خودکار حساب کاربری', description: 'نام کاربری = شماره دانش‌آموزی با رمز پیش‌فرض', locked: true },
    { key: 'auto_number', name: 'شماره دانش‌آموزی خودکار', description: 'تولید شمارهٔ یکتا هنگام ثبت‌نام' },
    { key: 'parents', name: 'اطلاعات اولیا (پدر، مادر، سرپرست)', description: 'نام، کد ملی، شغل، تحصیلات و تماس' },
    { key: 'emergency', name: 'تماس اضطراری', description: 'فرد و شمارهٔ تماس در مواقع اضطراری' },
    { key: 'medical', name: 'اطلاعات پزشکی', description: 'گروه خونی، حساسیت‌ها، بیماری‌ها، داروها، بیمه' },
    { key: 'photo', name: 'عکس دانش‌آموز', description: 'بارگذاری و نمایش عکس در پرونده و کارت' },
    { key: 'documents', name: 'مدارک و فایل‌های پرونده', description: 'شناسنامه، کارت ملی، کارنامهٔ قبلی و…' },
    { key: 'notes', name: 'یادداشت‌های پرونده', description: 'یادداشت‌های مدیر/معلم (خصوصی یا قابل مشاهده برای دانش‌آموز)' },
    { key: 'transfer', name: 'انتقال بین کلاس‌ها', description: 'جابه‌جایی با ثبت تاریخچه' },
    { key: 'status', name: 'وضعیت تحصیلی', description: 'فعال، فارغ‌التحصیل، انتقالی، ترک تحصیل، تعلیق' },
    { key: 'import', name: 'ورود گروهی از CSV/اکسل', description: 'ثبت‌نام دسته‌جمعی با فایل نمونه' },
    { key: 'export', name: 'خروجی CSV', description: 'دانلود فهرست با فیلترهای فعال' },
    { key: 'id_card', name: 'کارت دانش‌آموزی', description: 'چاپ کارت شناسایی با عکس و بارکد Code 128 شمارهٔ دانش‌آموزی (قابل اسکن با بارکدخوان)' },
    { key: 'card_qr', name: 'کارت هوشمند: QR استعلام اصالت', description: 'کد QR روی کارت که به صفحهٔ عمومی استعلام کارت (/students/verify/کد) می‌رود: نام، کلاس، وضعیت و اعتبار کارت؛ هر کارت یک کد یکتا دارد و با «ابطال و صدور مجدد» کارت‌های قبلی بی‌اعتبار می‌شوند' },
    { key: 'profile_print', name: 'چاپ پروندهٔ کامل', description: 'نسخهٔ چاپی پرونده' },
    { key: 'search', name: 'جستجوی پیشرفته', description: 'بر اساس نام، شماره، کد ملی، نام پدر، تلفن' },
    { key: 'panel', name: 'پنل دانش‌آموز', description: 'مشاهدهٔ پروندهٔ شخصی توسط دانش‌آموز', locked: true },
    { key: 'timeline', name: 'خط زمانی پرونده', description: 'آخرین رویدادها: غیبت، نمره، انضباطی، تیکت در یک نگاه' },
    { key: 'bulk', name: 'عملیات گروهی', description: 'انتخاب چند دانش‌آموز (یا همهٔ نتایج فیلتر) و انجام یک‌جا: انتقال کلاس، تغییر وضعیت، اعلان، پیامک به اولیا، خروجی CSV، چاپ کارت و بازنشانی رمز' },
    { key: 'siblings', name: 'تشخیص خواهر/برادر', description: 'نمایش دانش‌آموزان با کد ملی پدر/مادر مشترک' }
  ],
  menu: [
    { title: 'دانش‌آموزان', href: '/students', icon: 'bi-people', roles: ['admin', 'teacher'], permission: ['students.view', 'students.manage'] },
    { title: 'پروندهٔ من', href: '/students/me', icon: 'bi-person-vcard', roles: ['student', 'parent'], feature: 'panel' }
  ],
  routes: require('./routes')
};
