'use strict';
const { Client } = require('./client');
(async () => {
  const a = new Client(); await a.login('admin', 'admin123');
  const re = /vendor(?!\/)|پشتیبانی سامانه/;
  for (const p of ['/users?q=vendor', '/users?q=پشتیبانی', '/users', '/users/export.csv', '/dashboard', '/system/activity', '/search?q=vendor', '/notifications/send', '/messages/compose', '/tickets/new', '/system/settings?tab=sms']) { const r = await a.get(p); const m = re.exec(r.text); console.log('admin', p, r.status, m ? 'LEAK: ' + r.text.slice(Math.max(0, m.index - 80), m.index + 40).replace(/\s+/g, ' ') : 'clean'); }
  const t = new Client(); await t.login('teacher1', '123456');
  for (const p of ['/messages/compose', '/search?q=vendor', '/tickets/new']) { const r = await t.get(p); const m = re.exec(r.text); console.log('teacher', p, r.status, m ? 'LEAK' : 'clean'); }
  const r = await a.post('/auth/impersonate/2'); const d = await a.get('/dashboard'); console.log('after admin impersonate super:', r.status, r.location, /مدیر مدرسه/.test(d.text) ? 'still admin' : '??', /vendor(?!\/)/.test(d.text) ? 'LEAK' : 'clean');
  process.exit(0);
})();
