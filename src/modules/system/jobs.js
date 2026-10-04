'use strict';
const backup = require('../../core/backup');
const notify = require('../../core/notify');
const offsite = require('../../core/offsite');
module.exports = [
  {
    key: 'backup_auto', name: 'پشتیبان‌گیری خودکار', description: 'ساخت نسخهٔ پشتیبان روزانه در storage/backups و نگه‌داشتن آخرین N نسخه (تنظیم backup_keep)', schedule: 'daily', defaultTime: '02:00',
    async run({ db, settings }) {
      if (!require('../../core/modules').isEnabled('system.auto_backup')) return 'قابلیت پشتیبان‌گیری خودکار غیرفعال است';
      const name = await backup.create(db.info.client === 'sqlite' ? 'file' : 'json', 'auto');
      const removed = backup.prune(Number(settings.get('backup_keep', 7)) || 7, 'auto');
      let off = '';
      if (require('../../core/modules').isEnabled('system.backup_offsite') && offsite.mode() !== 'none') {
        const r = await offsite.send(require('path').join(backup.dir(), name));
        off = r.ok ? `؛ ارسال به بیرون: ${r.detail}` : `؛ ارسال به بیرون ناموفق: ${r.error}`;
        if (!r.ok) await notify.pushRole('admin', { title: 'ارسال پشتیبان به بیرون ناموفق بود', body: `پشتیبان ${name} ساخته شد اما ارسال آن به مقصد بیرونی (${offsite.MODES[offsite.mode()]}) با خطا مواجه شد: ${r.error}`, link: '/system/backup', type: 'warning' });
      }
      return `ساخته شد: ${name}${removed.length ? `؛ حذف ${removed.length} نسخهٔ قدیمی` : ''}${off}`;
    }
  },
  {
    key: 'cleanup', name: 'پاک‌سازی داده‌های موقت', description: 'حذف نشست‌های منقضی، کدهای بازیابی منقضی، لاگ اجرای کارهای قدیمی‌تر از ۳۰ روز، اعلان‌های خوانده‌شدهٔ قدیمی‌تر از ۹۰ روز و لاگ ورود قدیمی‌تر از ۱۸۰ روز', schedule: 'daily', defaultTime: '03:00',
    async run({ db, J }) {
      const now = db.now();
      const r = {};
      r.sessions = await db.table('sessions').where('expires_at', '<', Date.now()).delete().catch(() => 0);
      r.resets = await db.table('password_resets').where('expires_at', '<', now).delete();
      r.runs = await db.table('job_runs').where('started_at', '<', J.addDays(J.todayISO(), -30)).delete();
      r.notifs = await db.table('notifications').where('is_read', 1).where('created_at', '<', J.addDays(J.todayISO(), -90)).delete();
      r.logins = await db.table('login_logs').where('created_at', '<', J.addDays(J.todayISO(), -180)).delete();
      r.logfiles = require('../../core/logger').prune(require('../../core/settings').getInt('log_keep_days', 14));
      return Object.entries(r).map(([k, v]) => `${k}: ${Number(v) || 0}`).join('، ');
    }
  },
  {
    key: 'admin_digest', name: 'خلاصهٔ روزانه برای مدیر', description: 'اعلان صبحگاهی: غیبت‌های دیروز، تیکت‌های باز، درخواست‌های موجه در انتظار، شهریهٔ معوق و تولد امروز دانش‌آموزان', schedule: 'daily', defaultTime: '07:30',
    async run({ db, J }) {
      const today = J.todayISO(); const y = J.addDays(today, -1);
      const parts = [];
      const abs = await db.table('attendance').where({ date: y, session_key: 'daily', status: 'absent' }).count(); if (abs) parts.push(`غیبت دیروز: ${J.toPersianDigits(abs)}`);
      const open = await db.table('tickets').where('status', 'open').count(); if (open) parts.push(`تیکت باز: ${J.toPersianDigits(open)}`);
      const exc = await db.table('absence_excuses').where('status', 'pending').count().catch(() => 0); if (exc) parts.push(`درخواست موجه در انتظار: ${J.toPersianDigits(exc)}`);
      const due = await db.table('invoices').whereIn('status', ['unpaid', 'partial']).where('due_date', '<', today).count(); if (due) parts.push(`صورت‌حساب معوق: ${J.toPersianDigits(due)}`);
      const bd = await db.table('students').where('status', 'active').where('birth_date', 'like', `%${today.slice(5)}`).all();
      if (bd.length) parts.push(`تولد امروز: ${bd.slice(0, 5).map((s) => s.first_name + ' ' + s.last_name).join('، ')}${bd.length > 5 ? ' و…' : ''}`);
      if (!parts.length) return 'موردی برای گزارش نبود';
      await notify.pushRole('admin', { title: `خلاصهٔ ${J.formatDate(today)}`, body: parts.join(' | '), link: '/dashboard', type: 'info' });
      // تولد: اعلان به معلم راهنما
      for (const s of bd) { if (!s.class_id) continue; const hr = await db.table('classes as c').join('teachers as t', 't.id', 'c.teacher_id').select('t.user_id').where('c.id', s.class_id).first(); if (hr && hr.user_id) await notify.push([hr.user_id], { title: 'تولد دانش‌آموز', body: `امروز تولد ${s.first_name} ${s.last_name} است 🎂`, link: '/students/' + s.id, type: 'info' }); }
      return parts.join(' | ');
    }
  }
];
