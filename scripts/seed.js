#!/usr/bin/env node
'use strict';
/** بارگذاری دادهٔ نمونه روی پایگاه دادهٔ نصب‌شده:  node scripts/seed.js [--force] */
const { boot } = require('./_boot');
(async () => {
  const { db } = await boot();
  const force = process.argv.includes('--force');
  const n = await db.count('students');
  if (n > 0 && !force) { console.error(`پایگاه داده خالی نیست (${n} دانش‌آموز). برای افزودن مجدد از --force استفاده کنید یا ابتدا scripts/reset.js را اجرا کنید.`); process.exit(1); }
  const admin = await db.table('users').where('role', 'admin').orderBy('id').first();
  if (!admin) { console.error('حساب مدیر یافت نشد.'); process.exit(1); }
  let year = await db.findOne('academic_years', { is_current: 1 });
  if (!year) {
    const J = require('../src/core/jalali'); const ay = J.currentAcademicYear();
    const id = await db.insert('academic_years', { title: ay.title, start_date: ay.startDate, end_date: ay.endDate, is_current: 1, created_at: db.now() });
    year = { id };
  }
  const t = Date.now();
  const stats = await require('../database/seeds/demo').run({ db, log: (m) => console.log(m), adminId: admin.id, yearId: year.id, adminUsername: admin.username });
  console.log(`انجام شد در ${((Date.now() - t) / 1000).toFixed(1)} ثانیه`, stats);
  await db.close();
})().catch((e) => { console.error(e); process.exit(1); });
