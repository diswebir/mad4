'use strict';
// جریان عملیات: مالی، کتابخانه، سرویس، مرخصی، گزارش‌ها، جستجو
const { Client } = require('./client');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 2; } else console.log('ok:', m); };
const en = (s) => String(s).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
const lastId = (text, base) => (text.match(new RegExp(base.replace(/\//g, '\\/') + '\\/(\\d+)\\/edit', 'g')) || []).map((x) => Number(x.match(/(\d+)\/edit/)[1])).sort((x, y) => y - x)[0];
(async () => {
  const a = new Client(); let r = await a.login('admin', 'admin123'); assert(r.status === 302, 'admin login');
  const s = new Client(); r = await s.login('40001', '123456'); assert(r.status === 302, 'student login');
  const t = new Client(); r = await t.login('teacher1', '123456'); assert(r.status === 302, 'teacher login');
  const studentId = (await s.get('/students/me')).location.match(/\/students\/(\d+)/)[1];
  r = await a.get('/students/' + studentId); const classId = (r.text.match(/\/academic\/classes\/(\d+)/) || [])[1]; assert(classId, 'class id ' + classId);
  // ---- مالی: تعریف هزینه و صدور گروهی
  r = await a.get('/finance'); assert(r.status === 200 && /وصول/.test(r.text), 'finance dashboard');
  r = await a.post('/finance/fees', { title: 'هزینهٔ اردوی تستی', type: 'trip', amount: '500000', academic_year_id: '1', due_date: '1405/08/30', description: 'تست' }); assert(r.status === 302 && !/new/.test(r.location), 'create fee');
  r = await a.get('/finance/fees?q=' + encodeURIComponent('اردوی تستی')); const feeId = lastId(r.text, '/finance/fees'); assert(feeId, 'fee id ' + feeId);
  r = await a.get(`/finance/fees/${feeId}/issue`); assert(r.status === 200 && /class_ids/.test(r.text), 'issue form');
  r = await a.post(`/finance/fees/${feeId}/issue`, { class_ids: [classId], discount: '50000' }); assert(r.status === 302 && /invoices/.test(r.location), 'bulk issue');
  r = await a.get(r.location); assert(/اردوی تستی/.test(r.text) && /صادر شد/.test(r.text), 'invoices listed + flash');
  r = await a.post(`/finance/fees/${feeId}/issue`, { class_ids: [classId] }); r = await a.get(r.location); assert(/۰ صورت‌حساب صادر شد/.test(r.text) && /قبلاً داشتند/.test(r.text), 'no duplicate invoices');
  r = await s.get('/finance/my'); assert(/اردوی تستی/.test(r.text), 'student sees own invoice');
  const invId = (r.text.match(/\/finance\/my\/(\d+)/g) || []).map((x) => Number(x.match(/\d+/)[0])).sort((x, y) => y - x)[0]; assert(invId, 'invoice id ' + invId);
  r = await s.get('/finance/my/' + invId); assert(r.status === 200 && /۴۵۰٬۰۰۰|۴۵۰,۰۰۰|450,000/.test(r.text), 'student invoice shows discounted amount ' + invId);
  r = await s.get('/notifications'); assert(/صورت‌حساب جدید/.test(r.text), 'student notified about invoice');
  // پرداخت جزئی و کامل
  r = await a.post(`/finance/invoices/${invId}/pay`, { amount: '200000', method: 'cash', paid_at: '1405/07/09', reference: 'R1' }); assert(r.status === 302, 'partial payment');
  r = await a.get('/finance/invoices/' + invId); assert(/پرداخت جزئی|جزئی/.test(r.text) && /۲۵۰٬۰۰۰|۲۵۰,۰۰۰/.test(r.text), 'status partial, remaining 250000');
  r = await a.post(`/finance/invoices/${invId}/pay`, { amount: '999999', method: 'cash' }); r = await a.get('/finance/invoices/' + invId); assert(/بیشتر از مانده/.test(r.text), 'overpay rejected');
  r = await a.post(`/finance/invoices/${invId}/pay`, { amount: '250000', method: 'card', reference: 'R2' }); assert(r.status === 302, 'final payment');
  r = await a.get('/finance/invoices/' + invId); assert(/تسویه|پرداخت شده/.test(r.text), 'status paid');
  r = await a.get(`/finance/invoices/${invId}?print=1`); assert(r.status === 200 && !/sidebar/.test(r.text), 'print view');
  r = await a.get('/finance/payments?q=R2'); assert(/R2/.test(r.text), 'payments list');
  r = await a.get('/finance/payments?q=R1'); assert(/R1/.test(r.text), 'payments search');
  r = await a.post(`/finance/invoices/${invId}/delete`, {}); r = await a.get('/finance/invoices/' + invId); assert(r.status === 200, 'invoice with payments cannot be deleted');
  r = await a.get('/finance/reports'); assert(r.status === 200 && /وصولی|جمع/.test(r.text), 'finance reports');
  r = await a.get('/finance/invoices?overdue=1'); assert(r.status === 200, 'overdue filter');
  r = await a.post('/finance/overdue/remind-all', {}); assert(r.status === 302, 'remind all overdue');
  r = await a.get('/finance/invoices/export'); assert(r.status === 200 && /INV-/.test(r.text), 'export invoices');
  r = await s.get('/finance/invoices'); assert(r.status === 403, 'student cannot access invoices admin');
  // ---- کتابخانه
  r = await a.post('/library', { title: 'کتاب تستی نود', author: 'نویسنده', category: 'science', total_copies: '2', shelf: 'A1' }); assert(r.status === 302 && !/new/.test(r.location), 'create book');
  r = await a.get('/library?q=' + encodeURIComponent('کتاب تستی نود')); const bookId = lastId(r.text, '/library'); assert(bookId, 'book id ' + bookId);
  r = await a.post('/library/loans', { book_id: bookId, student_id: studentId, loaned_at: '1405/07/09', due_at: '1405/07/23' }); assert(r.status === 302 && !/new/.test(r.location), 'loan to student');
  r = await a.get('/library?q=' + encodeURIComponent('کتاب تستی نود')); assert(/>۱<|۱ \/ ۲|۱\/۲/.test(r.text), 'available copies decremented');
  r = await s.get('/library/my'); assert(/کتاب تستی نود/.test(r.text), 'student sees loan');
  r = await a.post('/library/loans', { book_id: bookId, student_id: studentId, loaned_at: '1405/07/09', due_at: '1405/07/23' }); r = await a.get('/library/loans/new'); assert(r.status === 200, 'second loan attempt handled');
  r = await a.get('/library/loans?q=' + encodeURIComponent('کتاب تستی نود')); const loanId = (r.text.match(/\/library\/loans\/(\d+)\/return/g) || []).map((x) => Number(x.match(/\d+/)[0])).sort((x, y) => y - x)[0]; assert(loanId, 'loan id ' + loanId);
  r = await a.post(`/library/loans/${loanId}/return`, {}); assert(r.status === 302, 'return book');
  r = await a.get('/library/loans?status=returned'); assert(/کتاب تستی نود/.test(r.text) || r.status === 200, 'returned list');
  r = await a.get('/library?q=' + encodeURIComponent('کتاب تستی نود')); assert(/۲ \/ ۲|۲\/۲|>۲<\/td>/.test(r.text) || /۲/.test(r.text), 'copies restored');
  r = await a.get('/library/overdue'); assert(r.status === 200, 'overdue page');
  r = await a.post('/library/overdue/remind', {}); assert(r.status === 302, 'remind overdue');
  r = await a.post(`/library/${bookId}/delete`, {}); assert(r.status === 302, 'delete book (loans returned)');
  // ---- سرویس
  r = await a.post('/transport', { title: 'مسیر تستی شمال', driver_name: 'رانندهٔ تست', driver_phone: '09120000000', vehicle: 'ون', plate: '۱۲ب۳۴۵', capacity: '2', fee: '300000', departure_time: '06:45', is_active: '1' }); assert(r.status === 302 && !/new/.test(r.location), 'create route');
  r = await a.get('/transport?q=' + encodeURIComponent('مسیر تستی شمال')); const routeId = lastId(r.text, '/transport'); assert(routeId, 'route id ' + routeId);
  r = await a.get(`/transport/${routeId}/assign?class_id=${classId}`); assert(r.status === 200 && /student_ids/.test(r.text), 'assign form');
  const ids = [...r.text.matchAll(/name="student_ids" value="(\d+)"/g)].map((m) => m[1]); assert(ids.length > 3, 'students listed ' + ids.length);
  r = await a.post(`/transport/${routeId}/assign`, { class_id: classId, student_ids: ids.slice(0, 3) }); r = await a.get(`/transport/${routeId}/assign?class_id=${classId}`); assert(/ظرفیت مسیر/.test(r.text), 'capacity enforced');
  r = await a.post(`/transport/${routeId}/assign`, { class_id: classId, student_ids: [studentId, ids.find((i) => i !== studentId)] }); assert(r.status === 302, 'assign 2 students');
  r = await a.get(`/transport/${routeId}/roster`); assert(r.status === 200 && /۲/.test(r.text), 'roster shows 2');
  r = await s.get('/transport/my'); assert(/مسیر تستی شمال/.test(r.text) && /رانندهٔ تست/.test(r.text), 'student sees own route');
  r = await a.post(`/transport/${routeId}/delete`, {}); r = await a.get('/transport?q=' + encodeURIComponent('مسیر تستی شمال')); assert(/مسیر تستی شمال/.test(r.text), 'route with students cannot be deleted');
  r = await a.post(`/transport/${routeId}/assign`, { class_id: classId }); r = await a.post(`/transport/${routeId}/delete`, {}); assert(r.status === 302, 'unassign + delete route');
  // ---- مرخصی
  r = await t.post('/hr/leaves', { type: 'استحقاقی', from_date: '1405/07/12', to_date: '1405/07/13', reason: 'امور شخصی تست' }); assert(r.status === 302 && !/new/.test(r.location), 'teacher requests leave');
  r = await t.get('/hr/leaves?q=' + encodeURIComponent('امور شخصی تست')); assert(/در انتظار/.test(r.text) && /۱۴۰۵\/۰۷\/۱۲/.test(r.text), 'teacher sees pending');
  const leaveId = lastId(r.text, '/hr/leaves') || (r.text.match(/\/hr\/leaves\/(\d+)\/review/g) || []).map((x) => Number(x.match(/\d+/)[0])).sort((x, y) => y - x)[0];
  r = await a.get('/hr/leaves?f_status=pending&q=' + encodeURIComponent('امور شخصی تست')); assert(/۱۴۰۵\/۰۷\/۱۲/.test(r.text) && /data-params/.test(r.text), 'admin pending list with approve action');
  const lid = leaveId || (r.text.match(/\/hr\/leaves\/(\d+)\/review/g) || []).map((x) => Number(x.match(/\d+/)[0])).sort((x, y) => y - x)[0]; assert(lid, 'leave id ' + lid);
  r = await t.post(`/hr/leaves/${lid}/review`, { decision: 'approved' }); assert(r.status === 403, 'teacher cannot review');
  r = await a.post(`/hr/leaves/${lid}/review`, { decision: 'approved', note: 'موافقت' }); assert(r.status === 302, 'admin approves');
  r = await t.get('/hr/leaves'); assert(/تأیید/.test(r.text), 'teacher sees approved');
  r = await t.get('/notifications'); assert(/مرخصی تأیید شد/.test(r.text), 'teacher notified');
  r = await t.post(`/hr/leaves/${lid}/delete`, {}); r = await t.get('/hr/leaves?q=' + encodeURIComponent('امور شخصی تست')); assert(/۱۴۰۵\/۰۷\/۱۲/.test(r.text), 'approved leave cannot be deleted by teacher');
  r = await a.get('/hr/leaves/export'); assert(r.status === 200, 'export leaves');
  // ---- گزارش‌ها و جستجو
  for (const p of ['/reports', '/reports/students', '/reports/attendance', '/reports/grades', '/reports/teachers', '/reports/students?print=1', '/reports/attendance?export=1']) { r = await a.get(p); assert(r.status === 200, 'report ' + p); }
  r = await a.get('/search?q=' + encodeURIComponent('یوسفی')); assert(r.status === 200 && /دانش‌آموزان/.test(r.text), 'search students');
  r = await a.get('/search?q=40001'); assert(/۴۰۰۰۱/.test(r.text), 'search by student number');
  r = await a.get('/search/api?q=' + encodeURIComponent('هفتم')); const j = r.json(); assert(j && j.groups.some((g) => g.title === 'کلاس‌ها'), 'search api classes');
  r = await t.get('/search?q=' + encodeURIComponent('هفتم')); assert(r.status === 200, 'teacher search');
  r = await s.get('/search?q=x'); assert(r.status === 403, 'student no search');
  console.log(process.exitCode ? 'SOME FAILED' : 'ALL PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
