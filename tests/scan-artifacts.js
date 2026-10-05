'use strict';
/** اسکن صفحات برای آثار باگ در خروجی HTML: undefined / NaN / null / [object Object] / <%= خام / خطای EJS */
const { Client, SUPER } = require('./client');
const roles = { admin: ['admin', 'admin123'], teacher: ['teacher1', '123456'], student: ['40001', '123456'], staff: ['staff1', '123456'], parent: [null, '123456'] };
const lists = require('./smoke.test.js').PAGES || null;
async function main() {
  const pages = lists || JSON.parse(process.argv[2] || '{}');
  let bad = 0;
  for (const [role, paths] of Object.entries(pages)) {
    const c = new Client();
    if (role === 'parent' && !roles.parent[0]) { const lp = await c.get('/auth/login'); roles.parent[0] = (lp.text.match(/data-u="(09\d{9})"/) || [])[1]; }
    let r; if (role === 'super') { await c.get('/console/login'); r = await c.post('/console/login', { username: SUPER.user, password: SUPER.pass }); } else r = await c.login(roles[role][0], roles[role][1]); if (r.status !== 302) { console.log('login failed', role); continue; }
    for (const p of paths) {
      const res = await c.get(p); if (res.status !== 200) continue;
      const text = res.text.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
      const visible = text.replace(/<[^>]+>/g, ' ').replace(/\/dev\/null/g, '');
      const hits = [];
      for (const re of [/\bundefined\b/, /\bNaN\b/, /\[object Object\]/, /<%[=-]?/, /&lt;%/, /\bnull\b/]) { const m = re.exec(visible); if (m) hits.push(m[0] + ' @ …' + visible.slice(Math.max(0, m.index - 60), m.index + 40).replace(/\s+/g, ' ') + '…'); }
      const attr = /(?:href|src|action)="[^"]*(?:undefined|NaN|null)[^"]*"/.exec(text); if (attr) hits.push(attr[0]);
      if (hits.length) { bad++; console.log(`[${role}] ${p}\n   ` + hits.join('\n   ')); }
    }
  }
  console.log(bad ? `${bad} صفحه با آثار مشکوک` : 'بدون آثار مشکوک ✓');
  if (bad) process.exitCode = 2;
}
main().catch((e) => { console.error(e); process.exit(1); });
