'use strict';
module.exports = {
  key: 'homework', name: 'تکالیف و محتوای آموزشی', description: 'تعریف تکلیف با مهلت، ارسال پاسخ توسط دانش‌آموز، نمره‌دهی و بازخورد، اشتراک جزوه و لینک', icon: 'bi-journal-check', category: 'academic', order: 57,
  features: [
    { key: 'manage', name: 'تعریف تکلیف', description: 'عنوان، شرح، مهلت، فایل پیوست و بارم', locked: true },
    { key: 'submit', name: 'ارسال پاسخ توسط دانش‌آموز', description: 'ارسال متن یا فایل از پنل دانش‌آموز' },
    { key: 'late', name: 'پذیرش ارسال با تأخیر', description: 'ارسال پس از مهلت با برچسب «با تأخیر» (طبق تنظیمات)' },
    { key: 'grade', name: 'نمره و بازخورد', description: 'نمره‌دهی به پاسخ‌ها همراه با بازخورد متنی' },
    { key: 'materials', name: 'محتوای آموزشی', description: 'اشتراک جزوه، فایل و لینک برای هر کلاس/درس' },
    { key: 'notify', name: 'اعلان تکلیف', description: 'اطلاع به دانش‌آموزان هنگام تعریف تکلیف و ثبت نمره' },
    { key: 'reminder', name: 'یادآوری مهلت', description: 'نمایش تکالیف نزدیک به مهلت در داشبورد دانش‌آموز' },
    { key: 'stats', name: 'آمار تحویل', description: 'درصد ارسال و میانگین نمره برای هر تکلیف' }
  ],
  menu: [
    { title: 'تکالیف', href: '/homework', icon: 'bi-journal-check', roles: ['admin', 'teacher'], permission: 'homework.view_all' },
    { title: 'تکالیف من', href: '/homework/my', icon: 'bi-journal-check', roles: ['student', 'parent'] },
    { title: 'محتوای آموزشی', href: '/homework/materials', icon: 'bi-folder2-open', roles: ['admin', 'staff', 'teacher', 'student', 'parent'], feature: 'materials' }
  ],
  jobs: require('./jobs'),
  routes: require('./routes')
};
