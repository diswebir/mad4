'use strict';
module.exports = {
  key: 'system', name: 'تنظیمات و سیستم', description: 'تنظیمات مدرسه، مدیریت ماژول‌ها، پشتیبان‌گیری، گزارش فعالیت و اطلاعات سامانه', icon: 'bi-gear', category: 'system', core: true, order: 800,
  features: [
    { key: 'school_info', name: 'اطلاعات و لوگوی مدرسه', description: 'نام، مقطع، تلفن، آدرس و لوگو', locked: true },
    { key: 'appearance', name: 'شخصی‌سازی ظاهر (رنگ اصلی و پوسته)', description: 'رنگ برند و پوستهٔ پیش‌فرض' },
    { key: 'modules', name: 'مدیریت ماژول‌ها و قابلیت‌ها', description: 'فعال/غیرفعال‌سازی هر ماژول و قابلیت', locked: true },
    { key: 'backup', name: 'پشتیبان‌گیری از پایگاه داده', description: 'دانلود نسخهٔ پشتیبان (SQLite / JSON)' },
    { key: 'scheduler', name: 'زمان‌بند کارهای پس‌زمینه', description: 'اجرای خودکار کارهای روزانه (پیامک غیبت، یادآوری‌ها، پشتیبان‌گیری، پاک‌سازی) با تیک داخلی، cron هاست یا URL' },
    { key: 'auto_backup', name: 'پشتیبان‌گیری خودکار روزانه', description: 'نسخهٔ پشتیبان شبانه با نگه‌داری N نسخهٔ آخر' },
    { key: 'backup_offsite', name: 'ارسال پشتیبان به بیرون از سرور', description: 'ارسال خودکار نسخهٔ پشتیبان فشرده (gzip) پس از هر پشتیبان‌گیری شبانه به ایمیل، FTP/FTPS یا WebDAV (Nextcloud و…) + ارسال دستی هر فایل و آزمایش اتصال؛ تا اگر هاست از دست رفت، نسخه‌ای بیرون از سرور داشته باشید' },
    { key: 'sms_report', name: 'گزارش مصرف پیامک', description: 'آمار پیامک‌های ارسال‌شده در بازهٔ دلخواه: به تفکیک روز (نمودار)، نوع پیامک، درگاه و پرمصرف‌ترین شماره‌ها؛ شمارش بخش‌های پیامک فارسی (۷۰/۶۷ نویسه) و برآورد هزینه بر اساس نرخ تنظیم‌شده؛ خروجی CSV' },
    { key: 'sms_log', name: 'لاگ پیامک‌ها', description: 'ثبت همهٔ پیامک‌های ارسالی (گیرنده، متن، وضعیت، سرویس‌دهنده) و ارائه‌دهندهٔ «لاگ» برای تست بدون هزینه' },
    { key: 'activity_log', name: 'گزارش فعالیت کاربران', description: 'ثبت ایجاد/ویرایش/حذف و سایر اقدامات' },
    { key: 'error_log', name: 'گزارش خطاها و لاگ سامانه', description: 'ثبت خطاهای سرور، استثناها، شکست کارهای زمان‌بندی‌شده و پیامک/ایمیل در فایل‌های روزانه (storage/logs) با نمایش، فیلتر، دانلود و پاک‌سازی خودکار' },
    { key: 'sms_settings', name: 'تنظیمات درگاه پیامک', description: 'کاوه‌نگار یا وب‌هوک سفارشی' },
    { key: 'email_settings', name: 'تنظیمات ایمیل (SMTP)', description: 'ارسال ایمیل از طریق سرور SMTP' },
    { key: 'security_settings', name: 'تنظیمات امنیتی', description: 'تعداد تلاش ورود، مدت قفل، کپچا و طول نشست' },
    { key: 'demo_data', name: 'بارگذاری/حذف دادهٔ نمونه', description: 'برای آشنایی با سامانه' },
    { key: 'system_info', name: 'اطلاعات سامانه و سلامت سرویس', description: 'نسخهٔ Node، پایگاه داده، حافظه و زمان اجرا' },
    { key: 'jalali', name: 'تقویم شمسی و انتخابگر تاریخ', description: 'همیشه فعال', locked: true },
    { key: 'rtl_vazir', name: 'رابط راست‌چین با فونت وزیرمتن', description: 'همیشه فعال', locked: true },
    { key: 'dark_mode', name: 'حالت تاریک', description: 'دکمهٔ تغییر پوسته در نوار بالا' },
    { key: 'pwa', name: 'نصب به‌عنوان اپلیکیشن (PWA)', description: 'مانیفست وب‌اپ با نام/رنگ مدرسه، آیکون تولیدشده، سرویس‌ورکر (کش دارایی‌های ایستا و صفحهٔ آفلاین) و گزینهٔ «نصب روی گوشی» برای دانش‌آموزان و اولیا' },
    { key: 'installer', name: 'ویزارد نصب وب و بازیابی اتصال', description: 'همیشه فعال', locked: true },
    { key: 'maintenance', name: 'حالت تعمیر و نگهداری', description: 'بستن موقت سامانه روی غیرمدیران با پیام و زمان بازگشت دلخواه (صفحهٔ ۵۰۳)، IPهای مجاز، فعال‌سازی خودکار هنگام به‌روزرسانی و نوار هشدار برای مدیر' },
    { key: 'disk_alert', name: 'پایش فضای دیسک و هشدار پرشدن', description: 'بررسی ساعتی فضای آزاد پارتیشن storage و حجم پوشه‌های آپلود/پشتیبان/لاگ؛ هشدار به مدیر (اعلان + نوار بالای صفحه) هنگام عبور از آستانهٔ تنظیم‌شده' },
    { key: 'advanced_settings', name: 'ویرایشگر همهٔ تنظیمات (پیشرفته)', description: 'زبانهٔ «همهٔ تنظیمات»: فهرست کامل کلیدها با برچسب فارسی و گروه، جستجو، ویرایش تکی هر کلید، بازگشت به پیش‌فرض، خروجی و ورودی JSON برای انتقال تنظیمات بین مدارس' },
    { key: 'updates', name: 'به‌روزرسانی نسخه از پنل', description: 'نمایش نسخهٔ نصب‌شده و تاریخچه، بارگذاری بستهٔ نسخهٔ جدید (ZIP)، اجرای npm install و همگام‌سازی جدول‌ها در پس‌زمینه با گزارش زنده و ری‌استارت خودکار روی cPanel' }
  ],
  menu: [
    { title: 'تنظیمات مدرسه', href: '/system/settings', icon: 'bi-sliders', roles: ['admin'], permission: 'system.settings' },
    // بخش‌های فنی (super: true) فقط در گروه «کنسول سازنده» برای حساب سازنده نمایش داده می‌شوند
    { title: 'ماژول‌ها و قابلیت‌ها', href: '/system/modules', icon: 'bi-grid-1x2', roles: ['admin'], super: true },
    { title: 'گزارش فعالیت', href: '/system/activity', icon: 'bi-clock-history', roles: ['admin'], permission: 'system.logs', feature: 'activity_log' },
    { title: 'پشتیبان‌گیری', href: '/system/backup', icon: 'bi-cloud-arrow-down', roles: ['admin'], permission: 'system.backup', feature: 'backup' },
    { title: 'کارهای زمان‌بندی‌شده', href: '/system/jobs', icon: 'bi-alarm', roles: ['admin'], permission: 'system.jobs', feature: 'scheduler' },
    { title: 'لاگ پیامک', href: '/system/sms-log', icon: 'bi-chat-left-dots', roles: ['admin'], permission: 'system.logs', feature: 'sms_log' },
    { title: 'گزارش خطاها', href: '/system/logs', icon: 'bi-bug', roles: ['admin'], feature: 'error_log', super: true },
    { title: 'اطلاعات سامانه', href: '/system/info', icon: 'bi-info-circle', roles: ['admin'], feature: 'system_info', super: true },
    { title: 'به‌روزرسانی سامانه', href: '/system/update', icon: 'bi-arrow-repeat', roles: ['admin'], feature: 'updates', super: true }
  ],
  jobs: require('./jobs'),
  routes: require('./routes')
};
