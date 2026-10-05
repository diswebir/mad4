'use strict';
module.exports = {
  key: 'calendar', name: 'تقویم و رویدادها', description: 'تقویم شمسی مدرسه: رویدادها، تعطیلات، آزمون‌ها و مهلت تکالیف در نمای ماهانه', icon: 'bi-calendar3', category: 'communication', order: 66,
  features: [
    { key: 'events', name: 'رویدادها', description: 'تعریف رویداد با نوع، رنگ، مخاطب و بازهٔ زمانی', locked: true },
    { key: 'holidays', name: 'تعطیلات', description: 'ثبت روزهای تعطیل (در حضور و غیاب نیز لحاظ می‌شود)' },
    { key: 'exam_days', name: 'نمایش آزمون‌ها', description: 'آزمون‌های ثبت‌شده در تقویم نمایش داده می‌شوند' },
    { key: 'homework_due', name: 'نمایش مهلت تکالیف', description: 'سررسید تکالیف در تقویم دانش‌آموز' },
    { key: 'birthdays', name: 'نمایش تولدها', description: 'تولد دانش‌آموزان در تقویم (مدیر: همه، معلم: کلاس‌های خود، دانش‌آموز/ولی: خودش) و کادر «این هفته / هفتهٔ آینده»' },
    { key: 'monthly_view', name: 'نمای ماهانه', description: 'جدول ماه شمسی با رویدادها' },
    { key: 'ical', name: 'خروجی iCal', description: 'دانلود رویدادها برای تقویم گوشی' }
  ],
  menu: [{ title: 'تقویم', href: '/calendar', icon: 'bi-calendar3', roles: ['admin', 'staff', 'teacher', 'student', 'parent'] }],
  routes: require('./routes')
};
