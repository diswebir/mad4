'use strict';
/** باز کردن فهرستی از صفحات با نقش‌های مختلف و گزارش کدهای غیر ۲۰۰/۳۰۲ به همراه خطا */
const { Client } = require('./client');
const roles = { admin: ['admin', 'admin123'], teacher: ['teacher1', '123456'], student: ['40001', '123456'] };
async function main() {
  const role = process.argv[2] || 'admin';
  const paths = process.argv.slice(3);
  const c = new Client();
  const r = await c.login(roles[role][0], roles[role][1]);
  if (r.status !== 302 || !/dashboard/.test(r.location || '')) { console.log('LOGIN FAILED', r.status, r.location, r.text.slice(0, 300)); process.exit(1); }
  let bad = 0;
  for (const p of paths) {
    const t = Date.now();
    const res = await c.get(p);
    const ms = Date.now() - t;
    let note = '';
    if (res.status >= 400 || res.status === 500) {
      bad++;
      const m = /<pre[^>]*>([\s\S]*?)<\/pre>/.exec(res.text) || /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(res.text);
      note = m ? m[1].replace(/\s+/g, ' ').slice(0, 400) : res.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300);
    } else if (res.status === 302) note = '-> ' + res.location;
    else note = (res.text.length / 1024).toFixed(0) + 'KB';
    console.log(`${res.status} ${ms}ms ${p} ${note}`);
  }
  if (bad) process.exitCode = 2;
}
main().catch((e) => { console.error(e); process.exit(1); });
