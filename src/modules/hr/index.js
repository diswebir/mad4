'use strict';
module.exports = {
  key: 'hr', name: 'امور اداری و مرخصی', description: 'درخواست مرخصی کارکنان و معلمان، تأیید/رد توسط مدیر، سوابق و خلاصهٔ حضور کارکنان', icon: 'bi-person-badge', category: 'people', order: 48,
  features: [
    { key: 'leaves', name: 'درخواست مرخصی', description: 'ثبت درخواست مرخصی توسط معلم/کارمند', locked: true },
    { key: 'approval', name: 'تأیید مرخصی', description: 'گردش کار تأیید/رد با یادداشت مدیر' },
    { key: 'notify', name: 'اعلان نتیجه', description: 'اطلاع به درخواست‌کننده پس از بررسی' },
    { key: 'balance', name: 'ماندهٔ مرخصی', description: 'محاسبهٔ روزهای استفاده‌شده از سقف سالانه (تنظیمات)' },
    { key: 'documents', name: 'مدارک پرسنلی', description: 'پیوند به پروندهٔ معلم و مدارک' }
  ],
  menu: [
    { title: 'مرخصی‌ها', href: '/hr/leaves', icon: 'bi-person-badge', roles: ['admin', 'staff', 'teacher'] }
  ],
  routes: require('./routes')
};
