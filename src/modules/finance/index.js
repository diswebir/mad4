'use strict';
module.exports = {
  key: 'finance', name: 'امور مالی و شهریه', description: 'تعریف شهریه و هزینه‌ها، صدور صورت‌حساب گروهی، ثبت پرداخت، تخفیف، اقساط و گزارش‌های مالی', icon: 'bi-cash-stack', category: 'finance', order: 70,
  features: [
    { key: 'fees', name: 'تعریف شهریه و هزینه', description: 'شهریه، سرویس، کتاب و… به تفکیک پایه/کلاس', locked: true },
    { key: 'invoices', name: 'صورت‌حساب', description: 'صدور صورت‌حساب برای دانش‌آموز', locked: true },
    { key: 'bulk_invoice', name: 'صدور گروهی', description: 'صدور صورت‌حساب برای همهٔ دانش‌آموزان یک پایه/کلاس با یک کلیک' },
    { key: 'payments', name: 'ثبت پرداخت', description: 'نقدی، کارت، انتقال، آنلاین؛ پرداخت جزئی و اقساط' },
    { key: 'discount', name: 'تخفیف', description: 'اعمال تخفیف روی صورت‌حساب' },
    { key: 'receipt', name: 'رسید چاپی', description: 'چاپ رسید پرداخت و صورت‌حساب' },
    { key: 'reports', name: 'گزارش مالی', description: 'وصولی، معوقات، به تفکیک کلاس و نوع هزینه با نمودار' },
    { key: 'overdue_notify', name: 'یادآوری بدهی', description: 'ارسال اعلان/پیامک به بدهکاران' },
    { key: 'student_view', name: 'نمایش به دانش‌آموز/اولیا', description: 'مشاهدهٔ صورت‌حساب‌ها و پرداخت‌ها در پنل دانش‌آموز' },
    { key: 'export', name: 'خروجی CSV', description: 'دانلود صورت‌حساب‌ها و پرداخت‌ها' }
  ],
  menu: [
    { title: 'امور مالی', href: '/finance', icon: 'bi-cash-stack', roles: ['admin', 'staff'] },
    { title: 'شهریه و پرداخت‌ها', href: '/finance/my', icon: 'bi-cash-stack', roles: ['student'], feature: 'student_view' }
  ],
  routes: require('./routes')
};
