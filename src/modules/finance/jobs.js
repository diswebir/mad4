'use strict';
const notify = require('../../core/notify');
const utils = require('../../core/utils');
module.exports = [
  {
    key: 'online_payments_reconcile', name: 'استعلام پرداخت‌های آنلاین', description: 'تأیید تراکنش‌های پرداخت‌شده‌ای که کاربر به سایت برنگشته و منقضی‌کردن تراکنش‌های نیمه‌کاره (هر ساعت)', schedule: 'hourly',
    async run() {
      if (!require('../../core/modules').isEnabled('finance.online_payment')) return 'پرداخت آنلاین غیرفعال است';
      const gw = require('./gateway'); if (!gw.configured()) return 'درگاه پیکربندی نشده است';
      const r = await gw.reconcile();
      return `${r.checked} تراکنش در انتظار بررسی شد: ${r.verified} تأیید، ${r.expired} منقضی${r.error ? ' — خطا: ' + r.error : ''}`;
    }
  },
  {
    key: 'finance_overdue', name: 'یادآوری شهریهٔ معوق', description: 'اعلان به دانش‌آموز و ولی برای صورت‌حساب‌های سررسیدگذشته (هر ۷ روز یک بار برای هر صورت‌حساب)', schedule: 'daily', defaultTime: '08:00',
    async run({ db, settings, J }) {
      const today = J.todayISO();
      const rows = await db.table('invoices as i').join('students as s', 's.id', 'i.student_id').select('i.*', 's.user_id').whereIn('i.status', ['unpaid', 'partial']).where('i.due_date', '<', today).all();
      if (!rows.length) return 'صورت‌حساب معوقی نیست';
      const unit = settings.get('currency_unit', 'تومان');
      let n = 0;
      for (const inv of rows) {
        const days = J.diffDays(inv.due_date, today);
        const every = Math.max(1, settings.getInt('reminder_interval_days', 7));
        if (days % every !== 1 && days !== 1) continue; // روز اول و سپس هر N روز
        const remain = Number(inv.amount) - Number(inv.discount || 0) - Number(inv.paid_amount || 0);
        const body = `ماندهٔ «${inv.title}» به مبلغ ${utils.money(remain, unit)} ${J.toPersianDigits(days)} روز از سررسید گذشته است.`;
        if (inv.user_id) await notify.push([inv.user_id], { title: 'یادآوری پرداخت', body, link: '/finance/my', type: 'warning' });
        const parentIds = await db.table('student_parents as sp').join('parents as p', 'p.id', 'sp.parent_id').where('sp.student_id', inv.student_id).whereNotNull('p.user_id').pluck('p.user_id');
        if (parentIds.length) await notify.push(parentIds, { title: 'یادآوری پرداخت شهریه', body, link: '/finance/my', type: 'warning' });
        n++;
      }
      return `${rows.length} معوق، ${n} یادآوری`;
    }
  }
];
