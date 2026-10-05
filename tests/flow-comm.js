'use strict';
// جریان ارتباطات: اعلان‌ها، اطلاعیه‌ها، پیام‌ها، نظرسنجی
const { Client } = require('./client');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 2; } else console.log('ok:', m); };
(async () => {
  const a = new Client(); let r = await a.login('admin', 'admin123'); assert(r.status === 302, 'admin login');
  const s = new Client(); r = await s.login('40001', '123456'); assert(r.status === 302, 'student login');
  const t = new Client(); r = await t.login('teacher1', '123456'); assert(r.status === 302, 'teacher login');
  r = await s.get('/students/me'); if (r.status === 302) r = await s.get(r.location); const classId = (r.text.match(/\/academic\/classes\/(\d+)/) || [])[1]; assert(classId, 'student class id ' + classId);
  // ---- اعلان‌ها
  r = await a.get('/notifications/send'); assert(r.status === 200 && /audience/.test(r.text), 'send form');
  r = await a.post('/notifications/send', { audience: 'class', class_id: classId, title: 'اعلان آزمایشی کلاس', body: 'متن اعلان', type: 'warning' }); assert(r.status === 302, 'send to class');
  r = await s.get('/notifications'); assert(/اعلان آزمایشی کلاس/.test(r.text), 'student sees notification');
  r = await s.get('/notifications/latest'); const j = r.json(); assert(j && j.items && j.items.some((n) => /اعلان آزمایشی/.test(n.title)), 'latest JSON');
  const nid = (r.text.match(/"id":(\d+)/) || [])[1];
  r = await s.post(`/notifications/${nid}/read`, {}); assert(r.status === 302, 'mark read');
  r = await s.post('/notifications/read-all', {}); assert(r.status === 302, 'read all');
  r = await s.get('/notifications/latest'); assert(r.json().unread === 0, 'unread 0 after read-all');
  r = await s.post('/notifications/clear', {}); assert(r.status === 302, 'clear read');
  r = await s.get('/notifications'); assert(!/اعلان آزمایشی کلاس/.test(r.text), 'cleared');
  r = await a.post('/notifications/send', { audience: 'user', user_id: '1', title: 'اعلان شخصی', body: 'x', type: 'info', sms: '1' }); assert(r.status === 302, 'send to user (+sms attempt)');
  r = await a.get('/notifications'); assert(/اعلان شخصی/.test(r.text), 'admin sees own notification');
  // ---- اطلاعیه‌ها
  r = await a.post('/announcements', { title: 'اطلاعیهٔ تستی عمومی', body: 'بدنهٔ اطلاعیه', audience: 'all', is_active: '1', is_pinned: '1' }); assert(r.status === 302, 'create announcement');
  r = await a.get('/announcements'); assert(/اطلاعیهٔ تستی عمومی/.test(r.text) && /bi-pin-angle-fill|سنجاق/.test(r.text), 'listed + pinned');
  const aid = (r.text.match(/\/announcements\/(\d+)[^\d]/g) || []).map((x) => Number(x.match(/\d+/)[0])).sort((x, y) => y - x)[0];
  r = await s.get('/announcements/' + aid); assert(r.status === 200 && /بدنهٔ اطلاعیه/.test(r.text), 'student reads announcement');
  r = await a.get('/announcements/' + aid); assert(/۱|بازدید/.test(r.text), 'views counter');
  r = await t.post('/announcements', { title: 'اطلاعیهٔ کلاس معلم', body: 'فقط کلاس', audience: 'class', class_id: classId, is_active: '1' }); assert(r.status === 302, 'teacher class announcement');
  r = await s.get('/announcements'); assert(/اطلاعیهٔ کلاس معلم/.test(r.text), 'student of class sees teacher announcement');
  const s2 = new Client(); await s2.login('40002', '123456'); r = await s2.get('/students/me'); if (r.status === 302) r = await s2.get(r.location); const class2 = (r.text.match(/\/academic\/classes\/(\d+)/) || [])[1];
  if (class2 && class2 !== classId) { r = await s2.get('/announcements'); assert(!/اطلاعیهٔ کلاس معلم/.test(r.text), 'other class does not see it'); }
  r = await a.post(`/announcements/${aid}/pin`, {}); assert(r.status === 302, 'unpin');
  r = await a.post(`/announcements/${aid}`, { title: 'اطلاعیهٔ تستی ویرایش', body: 'بدنهٔ اطلاعیه', audience: 'all', is_active: '1', expires_at: '1400/01/01' }); assert(r.status === 302, 'edit + expire');
  r = await s.get('/announcements'); assert(!/اطلاعیهٔ تستی ویرایش/.test(r.text), 'expired hidden from students');
  r = await a.post(`/announcements/${aid}/delete`, {}); assert(r.status === 302, 'delete');
  // ---- پیام‌ها
  r = await s.get('/messages/compose'); assert(r.status === 200 && /receiver_id/.test(r.text), 'student compose form');
  const sel = (r.text.match(/<select[^>]*name="receiver_id"[\s\S]*?<\/select>/) || [''])[0]; const optIds = [...sel.matchAll(/<option value="(\d+)"/g)].map((m) => m[1]); assert(optIds.length, 'student has recipients ' + optIds.length);
  r = await s.post('/messages/compose', { receiver_id: optIds[0], subject: 'سلام معلم', body: 'یک سؤال داشتم' }); assert(r.status === 302, 'student sends message');
  r = await s.post('/messages/compose', { receiver_id: '99999', subject: 'x', body: 'y' }); assert(r.status === 302 && /compose/.test(r.location), 'invalid recipient rejected');
  r = await a.post('/messages/compose', { mode: 'class', class_id: classId, subject: 'پیام گروهی کلاس', body: 'به همهٔ کلاس' }); assert(r.status === 302, 'admin broadcast to class');
  r = await s.get('/messages'); assert(/پیام گروهی کلاس/.test(r.text), 'student inbox has broadcast');
  const mid = (r.text.match(/\/messages\/(\d+)"/) || [])[1];
  r = await s.get('/messages/' + mid); assert(r.status === 200 && /به همهٔ کلاس/.test(r.text), 'open message');
  r = await s.post('/messages/compose', { receiver_id: '1', subject: 'Re: پیام گروهی کلاس', body: 'دریافت شد', parent_id: mid }); assert(r.status === 302, 'reply');
  r = await a.get('/messages'); assert(/دریافت شد|Re: پیام گروهی/.test(r.text), 'admin inbox has reply');
  r = await a.get('/messages?box=sent'); assert(/پیام گروهی کلاس/.test(r.text), 'sent box');
  r = await s.post(`/messages/${mid}/delete`, {}); assert(r.status === 302, 'delete message');
  r = await s.get('/messages'); assert(!new RegExp(`/messages/${mid}"`).test(r.text), 'deleted from inbox');
  r = await a.post('/messages/compose', { mode: 'role', role: 'teacher', subject: 'به همکاران', body: 'جلسه فردا' }); assert(r.status === 302, 'broadcast to teachers');
  r = await t.get('/messages'); assert(/به همکاران/.test(r.text), 'teacher got broadcast');
  // ---- نظرسنجی
  r = await a.post('/polls', { question: 'بهترین روز اردو؟', audience: 'students', options: ['شنبه', 'دوشنبه', 'چهارشنبه'], multiple: '0' }); assert(r.status === 302, 'create poll');
  r = await s.get('/polls'); assert(/بهترین روز اردو/.test(r.text), 'student sees poll');
  const pid = (r.text.match(/\/polls\/(\d+)"/g) || []).map((x) => Number(x.match(/\d+/)[0])).sort((x, y) => y - x)[0];
  r = await s.post(`/polls/${pid}/vote`, { option: '1' }); assert(r.status === 302, 'vote');
  r = await s.get('/polls/' + pid); assert(/شما رأی داده‌اید|رأی شما/.test(r.text) && /۱۰۰/.test(r.text), 'result shown after vote');
  r = await s.post(`/polls/${pid}/vote`, { option: '2' }); r = await a.get('/polls/' + pid); assert(/۱ رأی|۱ نفر|۱<\/strong>|>۱</.test(r.text), 'single vote counted once');
  r = await a.post(`/polls/${pid}/toggle`, {}); assert(r.status === 302, 'close poll');
  r = await s2.post(`/polls/${pid}/vote`, { option: '0' }); r = await a.get('/polls/' + pid); assert(!/۲ رأی/.test(r.text), 'closed poll rejects votes');
  r = await a.post(`/polls/${pid}/delete`, {}); assert(r.status === 302, 'delete poll');
  console.log(process.exitCode ? 'SOME FAILED' : 'ALL PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
