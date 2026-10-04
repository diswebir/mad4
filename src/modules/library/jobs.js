'use strict';
const notify = require('../../core/notify');
module.exports = [
  {
    key: 'library_overdue', name: 'یادآوری کتاب‌های دیرکرد', description: 'اعلان به دانش‌آموزان دارای امانتِ سررسیدگذشته و به‌روزرسانی وضعیت امانت به «دیرکرد»', schedule: 'daily', defaultTime: '08:30',
    async run({ db, J }) {
      const today = J.todayISO();
      const rows = await db.table('book_loans as l').join('books as b', 'b.id', 'l.book_id').leftJoin('students as s', 's.id', 'l.student_id').select('l.*', 'b.title', 's.user_id').whereNull('l.returned_at').where('l.due_at', '<', today).all();
      if (!rows.length) return 'امانت دیرکردی نیست';
      const ids = rows.filter((r) => r.status !== 'overdue').map((r) => r.id);
      if (ids.length) await db.table('book_loans').whereIn('id', ids).update({ status: 'overdue' });
      let n = 0;
      for (const r of rows) { if (!r.user_id) continue; const days = J.diffDays(r.due_at, today); const every = Math.max(1, require('../../core/settings').getInt('reminder_interval_days', 7)); if (days !== 1 && days % every !== 1) continue; await notify.push([r.user_id], { title: 'دیرکرد کتاب', body: `کتاب «${r.title}» ${J.toPersianDigits(days)} روز دیرکرد دارد؛ لطفاً به کتابخانه برگردانید.`, link: '/library/my', type: 'warning' }); n++; }
      return `${rows.length} دیرکرد، ${ids.length} به‌روزرسانی وضعیت، ${n} اعلان`;
    }
  }
];
