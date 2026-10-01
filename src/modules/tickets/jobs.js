'use strict';
module.exports = [
  {
    key: 'tickets_autoclose', name: 'بستن خودکار تیکت‌های پاسخ‌داده‌شده', description: 'تیکت‌هایی که پس از پاسخ، به اندازهٔ «روزهای بستن خودکار» (تنظیمات) بی‌پاسخ مانده‌اند بسته می‌شوند', schedule: 'daily', defaultTime: '01:00',
    async run({ db, settings, J }) {
      const days = Number(settings.get('ticket_auto_close_days', 7)) || 0;
      if (!days) return 'بستن خودکار غیرفعال است (۰ روز)';
      const before = J.addDays(J.todayISO(), -days) + ' 23:59:59';
      const rows = await db.table('tickets').where('status', 'answered').where('last_reply_at', '<', before).all();
      for (const t of rows) await db.update('tickets', { status: 'closed', closed_at: J.nowISO(), updated_at: J.nowISO() }, { id: t.id });
      return `${rows.length} تیکت بسته شد`;
    }
  }
];
