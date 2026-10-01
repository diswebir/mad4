'use strict';
module.exports = {
  key: 'enrollments', name: 'سوابق تحصیلی و ارتقای پایه', description: 'ثبت‌نام سالانه، تاریخچهٔ سال‌به‌سال هر دانش‌آموز، ارتقا/تکرار پایه و فارغ‌التحصیلی گروهی در پایان سال', icon: 'bi-mortarboard', category: 'academic', order: 36,
  features: [
    { key: 'history', name: 'تاریخچهٔ تحصیلی', description: 'ردیف سال/پایه/کلاس/وضعیت برای هر دانش‌آموز (زبانهٔ «سوابق تحصیلی» در پرونده)', locked: true },
    { key: 'auto', name: 'ثبت خودکار', description: 'ایجاد/به‌روزرسانی ردیف سال جاری هنگام ثبت‌نام، تغییر کلاس و تغییر وضعیت' },
    { key: 'promote', name: 'ارتقای پایان سال', description: 'ارتقا، تکرار پایه یا فارغ‌التحصیلی گروهی با انتخاب کلاس مقصد' },
    { key: 'backfill', name: 'پر کردن سوابق', description: 'ساخت ردیف سال جاری برای دانش‌آموزان فعال بدون سابقه' },
    { key: 'export', name: 'خروجی CSV', description: 'سوابق تحصیلی با فیلتر سال/وضعیت' }
  ],
  menu: [
    { title: 'سوابق تحصیلی', href: '/enrollments', icon: 'bi-mortarboard', roles: ['admin'], permission: 'academic.manage' }
  ],
  routes: require('./routes')
};
