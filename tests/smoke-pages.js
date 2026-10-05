'use strict';
/** باز کردن فهرستی از صفحات با نقش‌های مختلف و گزارش کدهای غیر ۲۰۰/۳۰۲ به همراه خطا */
const { Client, SUPER } = require('./client');
const roles = { admin: ['admin', 'admin123'], teacher: ['teacher1', '123456'], student: ['40001', '123456'], staff: ['staff1', '123456'], parent: [null, '123456'] };
async function main() {
  const role = process.argv[2] || 'admin';
  const paths = process.argv.slice(3);
  const c = new Client();
  if (role === 'parent' && !roles.parent[0]) { const lp = await c.get('/auth/login'); roles.parent[0] = (lp.text.match(/data-u="(09\d{9})"/) || [])[1] || process.env.PARENT_USER; }
  let r;
  if (role === 'super') { await c.get('/console/login'); r = await c.post('/console/login', { username: SUPER.user, password: SUPER.pass }); }
  else r = await c.login(roles[role][0], roles[role][1]);
  if (r.status !== 302 || !/dashboard|console/.test(r.location || '')) { console.log('LOGIN FAILED', r.status, r.location, r.text.slice(0, 300)); process.exit(1); }
  let bad = 0;
  for (const p of paths) {
    const t = Date.now();
    const res = await c.get(p);
    const ms = Date.now() - t;
    let note = '';
    if (res.status >= 400 || res.status === 500) {
      if (!(res.status === 403 && role !== 'admin' && role !== 'super')) bad++; // ۴۰۳ برای نقش‌های محدود پاسخ درست است
      const m = /<pre[^>]*>([\s\S]*?)<\/pre>/.exec(res.text) || /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(res.text);
      note = m ? m[1].replace(/\s+/g, ' ').slice(0, 400) : res.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300);
    } else if (res.status === 302) note = '-> ' + res.location;
    else note = (res.text.length / 1024).toFixed(0) + 'KB';
    console.log(`${res.status} ${ms}ms ${p} ${note}`);
  }
  if (bad) process.exitCode = 2;
}
main().catch((e) => { console.error(e); process.exit(1); });
