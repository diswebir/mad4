'use strict';
module.exports = {
  key: 'search', name: 'جستجوی سراسری', description: 'جستجوی یکپارچه در دانش‌آموزان، معلمان، کلاس‌ها، تیکت‌ها، کتاب‌ها و اطلاعیه‌ها با میانبر Ctrl+K', icon: 'bi-search', category: 'system', order: 95,
  features: [
    { key: 'global', name: 'جستجوی سراسری', description: 'کادر جستجو در نوار بالا برای کارکنان و معلمان', locked: true },
    { key: 'live', name: 'پیشنهاد زنده', description: 'نمایش نتایج هنگام تایپ (AJAX)' }
  ],
  menu: [],
  routes: require('./routes')
};
