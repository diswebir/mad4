'use strict';
const notify = require('../../core/notify');
const modules = require('../../core/modules');
const utils = require('../../core/utils');

module.exports = [
  {
    key: 'attendance_sms', name: 'پیامک غیبت به اولیا', description: 'ارسال یک پیامک تجمیعی برای غیبت‌ها/تأخیرهای اطلاع‌داده‌نشدهٔ امروز و دیروز هر دانش‌آموز به ولی (و اعلان درون‌برنامه‌ای به حساب ولی)؛ ردیف‌ها با notified=1 علامت می‌خورند', schedule: 'daily', defaultTime: '09:30',
    async run({ db, settings, J }) {
      if (!settings.getBool('attendance_absent_notify')) return 'اطلاع‌رسانی غیبت در تنظیمات غیرفعال است';
      const today = J.todayISO();
      const rows = await db.table('attendance as a').join('students as s', 's.id', 'a.student_id').leftJoin('class_subjects as cs', 'cs.id', 'a.class_subject_id').leftJoin('subjects as sb', 'sb.id', 'cs.subject_id')
        .select('a.id', 'a.date', 'a.student_id', 'a.status', 'a.session_key', 'a.period', 'sb.title as subject_title', 's.first_name', 's.last_name', 's.user_id', 's.father_phone', 's.mother_phone', 's.guardian_phone', 's.guardian_type')
        .whereBetween('a.date', J.addDays(today, -1), today).whereIn('a.status', ['absent', 'late']).where('a.notified', 0).all();
      if (!rows.length) return 'غیبتی برای اطلاع‌رسانی نبود';
      const byStudent = new Map();
      for (const r of rows) { if (!byStudent.has(r.student_id)) byStudent.set(r.student_id, { s: r, items: [] }); byStudent.get(r.student_id).items.push(r); }
      const parentsSvc = require('../parents/service');
      const tpl = settings.get('sms_template_absent');
      const school = settings.get('school_name', 'مدرسه');
      let sms = 0, inapp = 0;
      for (const { s, items } of byStudent.values()) {
        const name = `${s.first_name} ${s.last_name}`;
        const dateFa = J.formatDate(items[0].date || today);
        const absents = items.filter((i) => i.status === 'absent'); const lates = items.filter((i) => i.status === 'late');
        const detail = [absents.length ? (absents.some((i) => i.session_key === 'daily') ? 'غیبت روزانه' : `غیبت در ${absents.map((i) => i.subject_title || 'زنگ ' + i.period).join('، ')}`) : null, lates.length ? `تأخیر ${lates.length > 1 ? lates.length + ' مورد' : ''}`.trim() : null].filter(Boolean).join(' و ');
        const text = notify.template(tpl, { name, date: dateFa, school }) + (detail ? `\n(${detail})` : '');
        const targets = modules.isEnabled('parents') ? await parentsSvc.parentPhonesOfStudent(s.student_id) : [{ phone: s.guardian_type === 'mother' ? s.mother_phone : (s.guardian_type === 'other' ? s.guardian_phone : s.father_phone) || s.father_phone || s.mother_phone, user_id: null }];
        const seen = new Set();
        for (const t of targets) {
          if (t.phone && !seen.has(t.phone) && settings.getBool('sms_enabled')) { seen.add(t.phone); const r = await notify.sms(t.phone, text, 'attendance'); if (r && r.ok !== false) sms++; }
          if (t.user_id) { await notify.push([t.user_id], { title: 'غیبت/تأخیر فرزند', body: `${name} — ${dateFa}: ${detail || utils.ATT_STATUS[items[0].status]}`, link: '/attendance/my', type: 'warning' }); inapp++; }
        }
        await db.table('attendance').whereIn('id', items.map((i) => i.id)).update({ notified: 1 });
      }
      return `${byStudent.size} دانش‌آموز، ${sms} پیامک، ${inapp} اعلان ولی`;
    }
  }
];
