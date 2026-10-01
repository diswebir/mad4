'use strict';
module.exports = {
  key: 'announcements', name: 'اطلاعیه‌ها', description: 'تابلوی اعلانات مدرسه با تعیین مخاطب، سنجاق، زمان‌بندی انتشار و انقضا', icon: 'bi-megaphone', category: 'communication', order: 62,
  features: [
    { key: 'manage', name: 'مدیریت اطلاعیه', description: 'ایجاد، ویرایش و حذف اطلاعیه توسط مدیر و معلمان', locked: true },
    { key: 'audience', name: 'تعیین مخاطب', description: 'همه، دانش‌آموزان، معلمان، کارکنان یا یک کلاس خاص' },
    { key: 'pin', name: 'سنجاق‌کردن', description: 'نمایش اطلاعیه‌های مهم در بالای فهرست و داشبورد' },
    { key: 'schedule', name: 'زمان‌بندی انتشار و انقضا', description: 'انتشار در تاریخ آینده و حذف خودکار پس از انقضا' },
    { key: 'views', name: 'شمارش بازدید', description: 'تعداد مشاهدهٔ هر اطلاعیه' },
    { key: 'teacher_post', name: 'اطلاعیهٔ معلم برای کلاس', description: 'معلم می‌تواند برای کلاس‌های خود اطلاعیه بگذارد' },
    { key: 'notify', name: 'اعلان انتشار', description: 'ارسال اعلان درون‌برنامه‌ای به مخاطبان هنگام انتشار' }
  ],
  menu: [{ title: 'اطلاعیه‌ها', href: '/announcements', icon: 'bi-megaphone', roles: ['admin', 'staff', 'teacher', 'student'] }],
  routes: require('./routes')
};
