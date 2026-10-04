'use strict';
/**
 * اسکن کیفیت/دسترس‌پذیری HTML همهٔ صفحات (بر پایهٔ فهرست صفحات smoke.test.js):
 *  - شناسه‌های تکراری (id)
 *  - تصویر بدون alt
 *  - کنترل فرم بدون برچسب (label/aria-label/aria-labelledby/placeholder/title)
 *  - دکمه/لینک بدون متن قابل خواندن (فقط آیکون، بدون aria-label/title)
 *  - فرم POST بدون فیلد _csrf
 *  - نبود lang/dir روی <html> یا <title> خالی
 * اجرا: node tests/scan-html.js  (سرور باید در حال اجرا باشد)
 */
const { Client, SUPER } = require('./client');
const roles = { admin: ['admin', 'admin123'], teacher: ['teacher1', '123456'], student: ['40001', '123456'], staff: ['staff1', '123456'], parent: [null, '123456'] };
const { PAGES } = require('./smoke.test.js');

function attrs(tag) { const o = {}; for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) { if (m.index === 0) continue; o[m[1].toLowerCase()] = m[2] != null ? m[2] : m[3] != null ? m[3] : m[4] != null ? m[4] : ''; } return o; }
const text = (h) => h.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();

function check(html) {
  const issues = [];
  const body = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<template[\s\S]*?<\/template>/g, '');
  if (!/<html[^>]*\blang=/.test(html)) issues.push('html بدون lang');
  if (!/<html[^>]*\bdir="rtl"/.test(html)) issues.push('html بدون dir=rtl');
  const title = (/<title>([\s\S]*?)<\/title>/.exec(html) || [])[1]; if (!title || !title.trim()) issues.push('title خالی');
  // ids
  const ids = {}; for (const m of body.matchAll(/<[a-zA-Z][^>]*\sid="([^"]+)"/g)) ids[m[1]] = (ids[m[1]] || 0) + 1;
  const dups = Object.entries(ids).filter(([, n]) => n > 1).map(([k, n]) => k + '×' + n); if (dups.length) issues.push('id تکراری: ' + dups.slice(0, 5).join(', '));
  // images
  for (const m of body.matchAll(/<img\b[^>]*>/g)) { const a = attrs(m[0]); if (!('alt' in a)) issues.push('img بدون alt: ' + (a.src || '').slice(0, 60)); }
  // labels
  const labelFor = new Set(); for (const m of body.matchAll(/<label\b[^>]*\sfor="([^"]+)"/g)) labelFor.add(m[1]);
  const wrapped = new Set(); for (const m of body.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)) for (const x of m[1].matchAll(/<(?:input|select|textarea)\b[^>]*\sname="([^"]+)"/g)) wrapped.add(x[1]);
  for (const m of body.matchAll(/<(input|select|textarea)\b[^>]*>/g)) {
    const a = attrs(m[0]); const type = (a.type || (m[1] === 'input' ? 'text' : m[1])).toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) continue;
    if (a['aria-label'] || a['aria-labelledby'] || a.placeholder || a.title) continue;
    if (a.id && labelFor.has(a.id)) continue;
    if (a.name && wrapped.has(a.name)) continue;
    issues.push(`${m[1]}[${type}] بدون برچسب: ${a.name || a.id || '?'}`);
  }
  // buttons / links without text
  for (const m of body.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
    const a = attrs('<' + m[1] + m[2] + '>'); if (a['aria-label'] || a.title || a['aria-labelledby'] || a['aria-hidden'] === 'true') continue;
    const inner = m[3]; if (text(inner)) continue;
    if (/<img\b[^>]*\balt="[^"]+"/.test(inner)) continue;
    if (m[1] === 'a' && !a.href) continue;
    issues.push(`${m[1]} بدون متن: ${(a.href || a.class || '').slice(0, 50)}`);
  }
  // csrf
  for (const m of body.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)) {
    const a = attrs('<form' + m[1] + '>'); if ((a.method || 'get').toLowerCase() !== 'post') continue;
    if (/^https?:\/\//.test(a.action || '')) continue;
    if (!/name="_csrf"/.test(m[2])) issues.push('فرم POST بدون _csrf: ' + (a.action || '').slice(0, 60));
  }
  return issues;
}

async function main() {
  let bad = 0; let total = 0; const counts = {};
  for (const [role, paths] of Object.entries(PAGES)) {
    const c = new Client();
    if (role === 'parent' && !roles.parent[0]) { const lp = await c.get('/auth/login'); roles.parent[0] = (lp.text.match(/data-u="(09\d{9})"/) || [])[1]; }
    let r; if (role === 'super') { await c.get('/console/login'); r = await c.post('/console/login', { username: SUPER.user, password: SUPER.pass }); } else r = await c.login(roles[role][0], roles[role][1]); if (r.status !== 302) { console.log('login failed', role); continue; }
    for (const p of paths) {
      const res = await c.get(p); if (res.status !== 200 || !/text\/html/.test(res.headers['content-type'] || '')) continue; total++;
      const issues = check(res.text);
      if (issues.length) { bad++; console.log(`[${role}] ${p}\n   ` + issues.slice(0, 8).join('\n   ') + (issues.length > 8 ? `\n   … و ${issues.length - 8} مورد دیگر` : '')); issues.forEach((i) => { const k = i.split(':')[0].replace(/\[.*?\]/, '').trim(); counts[k] = (counts[k] || 0) + 1; }); }
    }
  }
  // صفحه‌های عمومی بدون ورود
  const g = new Client();
  for (const p of ['/auth/login', '/auth/forgot', '/documents/verify', '/students/verify', '/admissions/apply', '/admissions/track', '/offline']) {
    const res = await g.get(p); if (res.status !== 200) continue; total++;
    const issues = check(res.text); if (issues.length) { bad++; console.log(`[public] ${p}\n   ` + issues.slice(0, 8).join('\n   ')); issues.forEach((i) => { const k = i.split(':')[0].replace(/\[.*?\]/, '').trim(); counts[k] = (counts[k] || 0) + 1; }); }
  }
  if (bad) console.log('خلاصه:', Object.entries(counts).map(([k, n]) => `${k} (${n})`).join(' · '));
  console.log(bad ? `${bad} از ${total} صفحه مشکل دارند` : `بدون مشکل در ${total} صفحه ✓`);
  if (bad) process.exitCode = 2;
}
main().catch((e) => { console.error(e); process.exit(1); });
