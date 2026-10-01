'use strict';
module.exports = {
  key: 'transport', name: 'سرویس مدرسه', description: 'مسیرهای سرویس، راننده و خودرو، تخصیص دانش‌آموزان و فهرست سرنشینان', icon: 'bi-bus-front', category: 'services', order: 76,
  features: [
    { key: 'routes', name: 'مسیرهای سرویس', description: 'تعریف مسیر با راننده، خودرو، پلاک، ظرفیت و ساعت حرکت', locked: true },
    { key: 'assign', name: 'تخصیص دانش‌آموز', description: 'انتخاب مسیر سرویس هر دانش‌آموز و کنترل ظرفیت' },
    { key: 'roster', name: 'فهرست سرنشینان', description: 'لیست چاپی سرنشینان هر سرویس با شماره تماس اولیا' },
    { key: 'student_view', name: 'نمایش به دانش‌آموز', description: 'مشاهدهٔ مسیر، راننده و ساعت حرکت در پنل دانش‌آموز' }
  ],
  menu: [
    { title: 'سرویس مدرسه', href: '/transport', icon: 'bi-bus-front', roles: ['admin'], permission: 'transport.manage' },
    { title: 'سرویس من', href: '/transport/my', icon: 'bi-bus-front', roles: ['student', 'parent'], feature: 'student_view' }
  ],
  routes: require('./routes')
};
