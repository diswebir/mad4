'use strict';
/**
 * اجرای همهٔ تست‌های یکپارچه روی یک نمونهٔ در حال اجرا (پیش‌فرض http://localhost:3000)
 *   BASE_URL=http://localhost:3000 npm test
 * پیش‌نیاز: نصب با دادهٔ نمونه (admin/admin123، teacher1/123456، 40001/123456)
 */
const { spawnSync } = require('child_process');
const path = require('path');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PAGES = {
  admin: ['/dashboard', '/users', '/academic/classes', '/academic/schedule', '/academic/year-close', '/academic/promote', '/teachers', '/students', '/students/1', '/attendance', '/attendance/report/daily', '/exams', '/exams/analytics', '/homework', '/tickets', '/tickets?sla=overdue', '/tickets/stats', '/messages', '/announcements', '/notifications', '/discipline', '/discipline/report', '/health', '/health/alerts', '/counseling', '/calendar', '/polls', '/finance', '/finance/invoices', '/finance/reports', '/library', '/library/loans', '/library/overdue', '/transport', '/hr/leaves', '/reports', '/reports/students', '/reports/attendance', '/reports/grades', '/reports/teachers', '/search?q=%D8%B9%D9%84%DB%8C', '/system/settings', '/system/modules', '/system/backup', '/system/activity', '/system/jobs', '/system/sms-log', '/users/positions', '/parents', '/academic/years', '/academic/terms', '/exams/changes', '/enrollments', '/enrollments/promote', '/students/1?tab=enrollments', '/documents', '/documents/new?type=certificate&student_id=1', '/documents/report-card/1', '/documents/roster/1', '/system/settings?tab=documents', '/admissions', '/admissions?status=accepted', '/admissions/1', '/admissions/export.csv', '/system/settings?tab=admissions', '/lessons', '/lessons/today', '/lessons/new', '/lessons/class/1', '/lessons/coverage?class_id=1', '/lessons/missing', '/lessons/syllabus', '/lessons/export.csv'],
  teacher: ['/dashboard', '/teachers/me', '/attendance', '/exams', '/exams/changes', '/homework', '/tickets', '/messages', '/announcements', '/calendar', '/discipline', '/health/alerts', '/library', '/hr/leaves', '/polls', '/lessons', '/lessons/today', '/lessons/coverage', '/lessons/missing'],
  student: ['/dashboard', '/students/me', '/attendance/my', '/exams/my', '/homework', '/tickets', '/messages', '/announcements', '/notifications', '/calendar', '/polls', '/finance/my', '/library/my', '/transport/my', '/discipline/my', '/health/my', '/documents/my', '/lessons/my'],
  staff: ['/dashboard', '/students', '/students/1', '/students/1?tab=parents', '/parents', '/teachers', '/academic/classes', '/academic/schedule', '/attendance', '/attendance/report/daily', '/attendance/alerts', '/exams', '/homework', '/lessons', '/lessons/missing', '/lessons/syllabus', '/tickets', '/messages', '/announcements', '/calendar', '/documents', '/reports', '/users', '/system/settings', '/finance'],
  parent: ['/dashboard', '/parents/panel', '/students/me', '/students/me?tab=parents', '/attendance/my', '/exams/my', '/homework/my', '/lessons/my', '/tickets', '/messages', '/announcements', '/notifications', '/calendar', '/documents/my', '/finance/my', '/polls', '/lessons', '/students', '/system/settings']
};
(async () => {
  try { const r = await fetch(BASE + '/healthz'); const j = await r.json(); if (!j.installed) throw new Error('not installed'); console.log(`سرور در دسترس است (${j.db}, v${j.version})`); }
  catch (e) { console.error(`سرور روی ${BASE} در دسترس نیست یا نصب نشده است: ${e.message}`); process.exit(1); }
  let failed = 0;
  for (const [role, paths] of Object.entries(PAGES)) {
    const r = spawnSync(process.execPath, [path.join(__dirname, 'smoke-pages.js'), role, ...paths], { encoding: 'utf8', env: Object.assign({}, process.env, { BASE_URL: BASE }) });
    // ۴۰۳ برای نقش‌های غیرمدیر پاسخ درست سامانهٔ مجوزهاست؛ برای مدیر هر ۴xx/۵xx خطاست
    const bad = (r.stdout || '').split('\n').filter((l) => /^(4(0[0-9]|[1-9][0-9])|5\d\d) /.test(l) && !(role !== 'admin' && /^403 /.test(l)) && !/^(403|404) .*\/(system|finance|library|hr|discipline|health|counseling|transport|reports)\b/.test(l));
    console.log(`[pages:${role}] ${paths.length} صفحه، ${bad.length} خطا`); bad.forEach((l) => console.log('   ' + l.slice(0, 160)));
    if (bad.length || r.status) failed++;
  }
  for (const f of ['flow-academic', 'flow-attendance', 'flow-tickets', 'flow-exams', 'flow-homework', 'flow-comm', 'flow-records', 'flow-ops', 'flow-parents', 'flow-permissions', 'flow-scheduler', 'flow-gradelock', 'flow-recovery', 'flow-documents', 'flow-admissions', 'flow-lessons', 'flow-yearclose', 'flow-sla', 'flow-bulk']) {
    const r = spawnSync(process.execPath, [path.join(__dirname, f + '.js')], { encoding: 'utf8', env: Object.assign({}, process.env, { BASE_URL: BASE }) });
    const fails = (r.stdout || '').split('\n').filter((l) => l.startsWith('FAIL'));
    const oks = (r.stdout || '').split('\n').filter((l) => l.startsWith('ok')).length;
    console.log(`[${f}] ${oks} موفق، ${fails.length} ناموفق${r.status ? ' (خروج ' + r.status + ')' : ''}`); fails.forEach((l) => console.log('   ' + l)); if (r.status && r.stderr) console.log('   ' + r.stderr.split('\n')[0]);
    if (fails.length || r.status) failed++;
  }
  console.log(failed ? `\n${failed} مجموعه ناموفق` : '\nهمهٔ تست‌ها با موفقیت اجرا شدند ✓');
  process.exit(failed ? 1 : 0);
})();
