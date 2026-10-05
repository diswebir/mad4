'use strict';
const notify = require('../../core/notify');
module.exports = [
  {
    key: 'homework_reminder', name: 'یادآوری مهلت تکالیف', description: 'اعلان به دانش‌آموزانی که تکلیفِ با مهلت فردا را تحویل نداده‌اند (و به ولی آن‌ها)', schedule: 'daily', defaultTime: '16:00',
    async run({ db, J, settings }) {
      const tomorrow = J.addDays(J.todayISO(), Math.max(0, settings.getInt('homework_reminder_days', 1)));
      const hws = await db.table('homework as h').leftJoin('subjects as s', 's.id', 'h.subject_id').select('h.id', 'h.title', 'h.class_id', 's.title as subject_title').where('h.due_date', tomorrow).all();
      if (!hws.length) return 'تکلیفی با مهلت در روز یادآوری نیست';
      let n = 0;
      for (const h of hws) {
        const done = new Set(await db.table('homework_submissions').where('homework_id', h.id).pluck('student_id'));
        const studs = await db.table('students').select('id', 'user_id').where({ class_id: h.class_id, status: 'active' }).whereNotNull('user_id').all();
        const pending = studs.filter((s) => !done.has(s.id));
        if (!pending.length) continue;
        await notify.push(pending.map((s) => s.user_id), { title: 'یادآوری تکلیف', body: `مهلت تحویل «${h.title}»${h.subject_title ? ' (' + h.subject_title + ')' : ''} فرداست.`, link: '/homework/' + h.id, type: 'warning' });
        const parentIds = await db.table('student_parents as sp').join('parents as p', 'p.id', 'sp.parent_id').whereIn('sp.student_id', pending.map((s) => s.id)).whereNotNull('p.user_id').pluck('p.user_id');
        if (parentIds.length) await notify.push([...new Set(parentIds)], { title: 'یادآوری تکلیف فرزند', body: `مهلت تحویل «${h.title}» فرداست و هنوز تحویل داده نشده است.`, link: '/homework/my', type: 'info' });
        n += pending.length;
      }
      return `${hws.length} تکلیف، ${n} یادآوری`;
    }
  }
];
