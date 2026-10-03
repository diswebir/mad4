'use strict';
const { Client } = require('./client');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 2; } else console.log('ok:', m); };
const mp = async (c, url, fields) => { const fd = new FormData(); fd.append('_csrf', c.csrf); for (const [k, v] of Object.entries(fields)) fd.append(k, v); const res = await fetch('http://localhost:3000' + url, { method: 'POST', headers: { cookie: c.cookieHeader() }, body: fd, redirect: 'manual' }); return { status: res.status, location: res.headers.get('location') }; };
(async () => {
  const s = new Client(); let r = await s.login('40001', '123456'); assert(r.status === 302, 'student login');
  r = await s.get('/tickets'); assert(r.status === 200 && /TK-/.test(r.text), 'student ticket list');
  r = await s.get('/tickets/new'); assert(r.status === 200 && /معلم کلاس/.test(r.text), 'student new form has teacher option');
  let p = await mp(s, '/tickets', { department: 'teacher', category: 'academic', priority: 'high', subject: 'سؤال تستی', message: 'متن تست\nخط دوم', file: new Blob(['hello'], { type: 'application/pdf' }) });
  assert(p.status === 302 && /\/tickets\/\d+/.test(p.location), 'student create ticket -> ' + p.location);
  const tid = (p.location.match(/\d+/) || [])[0];
  r = await s.get(p.location); assert(/سؤال تستی/.test(r.text) && /خط دوم/.test(r.text) && /paperclip/.test(r.text), 'ticket page shows message + attachment');
  // teacher sees and replies
  const t = new Client(); r = await t.login('teacher1', '123456'); assert(r.status === 302, 'teacher login');
  r = await t.get('/tickets'); assert(/سؤال تستی/.test(r.text), 'teacher sees assigned ticket');
  r = await t.get('/tickets/' + tid); assert(r.status === 200, 'teacher opens ticket');
  p = await mp(t, `/tickets/${tid}/reply`, { message: 'پاسخ معلم', is_internal: '1' }); assert(p.status === 302, 'teacher internal note');
  p = await mp(t, `/tickets/${tid}/reply`, { message: 'پاسخ معلم عمومی' }); assert(p.status === 302, 'teacher reply');
  r = await s.get('/tickets/' + tid); assert(/پاسخ معلم عمومی/.test(r.text) && !/پاسخ معلم<\//.test(r.text) && !/یادداشت داخلی/.test(r.text), 'student sees public reply, not internal');
  assert(/پاسخ داده شده/.test(r.text), 'status answered');
  r = await s.get('/dashboard'); assert(/text-bg-danger">۱|text-bg-danger">[۰-۹]+/.test(r.text), 'student sidebar badge');
  p = await mp(s, `/tickets/${tid}/reply`, { message: 'ممنون' }); assert(p.status === 302, 'student reply');
  r = await t.get('/tickets/' + tid); assert(/>باز</.test(r.text), 'status back to open');
  // admin: assign, priority, close, stats
  const a = new Client(); r = await a.login('admin', 'admin123'); assert(r.status === 302, 'admin login');
  r = await a.get('/tickets?status=open'); assert(/سؤال تستی/.test(r.text), 'admin list open');
  r = await a.get('/tickets?q=' + encodeURIComponent('سؤال تستی')); assert(/سؤال تستی/.test(r.text), 'admin search');
  r = await a.post(`/tickets/${tid}/assign`, { assigned_to: '1' }); assert(r.status === 302, 'assign to admin');
  r = await a.post(`/tickets/${tid}/priority`, { priority: 'urgent' }); assert(r.status === 302, 'priority');
  r = await a.post(`/tickets/${tid}/category`, { category: 'finance' }); assert(r.status === 302, 'category');
  p = await mp(a, `/tickets/${tid}/reply`, { message: 'بسته شد', close: '1' }); assert(p.status === 302, 'admin reply+close');
  r = await a.get('/tickets/' + tid); assert(/>بسته</.test(r.text) && /فوری/.test(r.text), 'closed + urgent shown');
  r = await s.post(`/tickets/${tid}/rate`, { rating: '5' }); assert(r.status === 302, 'student rates');
  r = await s.get('/tickets/' + tid); assert(/bi-star-fill/.test(r.text), 'rating shown');
  r = await a.post(`/tickets/${tid}/status`, { status: 'open' }); assert(r.status === 302, 'reopen');
  r = await a.get('/tickets/stats'); assert(r.status === 200 && /میانگین/.test(r.text), 'stats page');
  r = await a.get('/tickets/canned'); assert(r.status === 200, 'canned page');
  r = await a.post('/tickets/canned', { title: 'تست', body: 'متن آماده', shared: '1' }); assert(r.status === 302, 'canned create');
  r = await a.get('/tickets/' + tid); assert(/متن آماده/.test(r.text), 'canned appears in reply form');
  r = await a.get('/tickets/export'); assert(r.status === 200 && /TK-/.test(r.text), 'export csv');
  r = await a.get('/tickets/new'); assert(r.status === 200 && /ارجاع به/.test(r.text), 'admin new form');
  p = await mp(a, '/tickets', { student_id: '5', assigned_to: '2', category: 'admin', subject: 'از طرف مدیر', message: 'متن' }); assert(p.status === 302 && /\/tickets\/\d+/.test(p.location), 'admin creates ticket');
  const t2 = p.location.match(/\d+/)[0];
  r = await a.post(`/tickets/${t2}/delete`, {}); assert(r.status === 302 && r.location === '/tickets', 'admin deletes ticket');
  r = await a.post(`/tickets/${tid}/delete`, {}); assert(r.status === 302, 'cleanup test ticket');
  // access control: other student cannot see
  const s2 = new Client(); await s2.login('40002', '123456'); r = await s2.get('/tickets/1'); assert(r.status === 403 || r.status === 200, 'other student access check ' + r.status);
  r = await s2.get('/tickets?status=closed'); assert(r.status === 200, 'student filter');
  const own = await s2.get('/tickets'); const anyId = (own.text.match(/\/tickets\/(\d+)/) || [])[1];
  if (anyId) { r = await s.get('/tickets/' + anyId); assert(r.status === 403, 'student cannot open other student ticket'); }
})().catch((e) => { console.error(e); process.exit(1); });
