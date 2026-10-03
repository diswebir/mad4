'use strict';
module.exports = [
  {
    key: 'tickets_sla_alert', name: 'هشدار تیکت‌های خارج از مهلت پاسخ (SLA)', description: 'برای تیکت‌های بازی که از مهلت پاسخ اول (بر اساس اولویت) گذشته‌اند، به مسئول تیکت (یا همهٔ مدیران اگر ارجاع نشده) اعلان می‌فرستد؛ هر تیکت حداکثر یک بار در روز.', schedule: 'hourly',
    async run({ db, settings }) {
      const modules = require('../../core/modules'); const notify = require('../../core/notify');
      if (!modules.isEnabled('tickets.sla')) return 'قابلیت SLA غیرفعال است';
      if (!settings.getBool('ticket_sla_notify')) return 'هشدار SLA در تنظیمات خاموش است';
      const sla = require('./sla');
      const cls = await sla.classify(db.table('tickets as t'));
      if (!cls.overdue.length) return 'تیکت خارج از مهلت وجود ندارد';
      const since = new Date(Date.now() - 24 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
      const rows = await db.table('tickets').whereIn('id', cls.overdue).where((b) => b.whereNull('sla_alerted_at').orWhere('sla_alerted_at', '<', since)).all();
      if (!rows.length) return `${cls.overdue.length} تیکت خارج از مهلت — همه در ۲۴ ساعت اخیر اطلاع‌رسانی شده‌اند`;
      let sent = 0;
      for (const t of rows) {
        const info = sla.info(t);
        const payload = { title: 'تیکت خارج از مهلت پاسخ', body: `${t.code}: ${t.subject} — ${info.label}`, link: '/tickets/' + t.id + '#sla', type: 'warning' };
        if (t.assigned_to) sent += await notify.push([t.assigned_to], payload); else sent += await notify.pushRole('admin', payload);
        await db.update('tickets', { sla_alerted_at: db.now() }, { id: t.id });
      }
      return `${rows.length} تیکت خارج از مهلت، ${sent} اعلان ارسال شد`;
    }
  },
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
