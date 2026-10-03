'use strict';
/** جریان: PWA (system.pwa) — مانیفست پویا، آیکون PNG، سرویس‌ورکر، صفحهٔ آفلاین، تگ‌های قالب، خاموش‌کردن */
const { Client } = require('./client');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 2; } else console.log('ok:', m); };
const BASE = process.env.BASE_URL || 'http://localhost:3000';

(async () => {
  const a = new Client(); let r = await a.login('admin', 'admin123'); assert(r.status === 302, 'admin login');
  await a.post('/system/modules/toggle', { key: 'system.pwa', enabled: '1' });

  // مانیفست (بدون نشست هم در دسترس است)
  let res = await fetch(BASE + '/manifest.webmanifest'); assert(res.status === 200 && /manifest\+json/.test(res.headers.get('content-type') || ''), 'manifest served with proper type');
  const man = await res.json();
  assert(man.dir === 'rtl' && man.lang === 'fa' && man.display === 'standalone' && man.start_url.startsWith('/dashboard'), 'manifest basics');
  assert(/شهید بهشتی|مدرسه/.test(man.name) && man.short_name.length <= 30, 'manifest name from school settings');
  assert(man.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable') && man.icons.some((i) => i.sizes === '192x192' && i.purpose === 'any'), 'manifest has any + maskable icons');
  assert(Array.isArray(man.shortcuts) && man.shortcuts.length >= 2, 'manifest shortcuts');

  // آیکون‌ها
  for (const size of [192, 512, 180]) {
    res = await fetch(BASE + `/pwa/icon-${size}.png`); const buf = Buffer.from(await res.arrayBuffer());
    assert(res.status === 200 && res.headers.get('content-type').includes('image/png') && buf.slice(0, 8).toString('hex') === '89504e470d0a1a0a', `icon ${size} is PNG`);
    assert(buf.readUInt32BE(16) === size && buf.readUInt32BE(20) === size, `icon ${size} dimensions`);
  }
  res = await fetch(BASE + '/pwa/icon-512.png?maskable=1'); assert(res.status === 200, 'maskable icon');
  res = await fetch(BASE + '/pwa/icon-999.png'); assert(res.status === 404, 'unknown icon size -> 404');
  res = await fetch(BASE + '/pwa/evil.txt'); assert(res.status === 404, 'other /pwa/ files -> 404');

  // رنگ برند در مانیفست و آیکون
  const before = await a.get('/system/settings?tab=appearance'); const curColor = (/name="primary_color" value="([^"]*)"/.exec(before.text) || [])[1] || '#2563eb';
  r = await a.post('/system/settings/appearance', { primary_color: '#16a34a' });
  res = await fetch(BASE + '/manifest.webmanifest'); assert((await res.json()).theme_color === '#16a34a', 'theme_color follows primary_color');
  res = await fetch(BASE + '/pwa/icon-192.png'); const green = Buffer.from(await res.arrayBuffer());
  res = await fetch(BASE + '/sw.js'); const swGreen = await res.text(); assert(/16a34a/.test(swGreen), 'service worker version changes with color (cache bust)');
  await a.post('/system/settings/appearance', { primary_color: curColor });
  res = await fetch(BASE + '/pwa/icon-192.png'); const blue = Buffer.from(await res.arrayBuffer()); assert(!green.equals(blue), 'icon re-rendered with brand color');

  // سرویس‌ورکر
  res = await fetch(BASE + '/sw.js'); const sw = await res.text();
  assert(res.status === 200 && /javascript/.test(res.headers.get('content-type')) && res.headers.get('service-worker-allowed') === '/', 'sw.js headers');
  assert(/addEventListener\('fetch'/.test(sw) && /\/offline/.test(sw) && /req\.mode === 'navigate'/.test(sw), 'sw has fetch handler + offline fallback');
  assert(!/dashboard/.test(sw.replace(/\/\*[\s\S]*?\*\//, '')), 'sw never precaches authenticated pages');

  // صفحهٔ آفلاین
  res = await fetch(BASE + '/offline'); const off = await res.text(); assert(res.status === 200 && /اتصال اینترنت برقرار نیست/.test(off) && /تلاش دوباره/.test(off), 'offline page');

  // تگ‌های قالب
  r = await a.get('/dashboard'); assert(/rel="manifest" href="\/manifest.webmanifest"/.test(r.text) && /name="theme-color"/.test(r.text) && /apple-touch-icon/.test(r.text), 'layout has manifest/theme/apple tags');
  assert(/serviceWorker\.register\('\/sw\.js'\)/.test(r.text) && /data-pwa-install/.test(r.text), 'layout registers SW + install menu item');
  const lp = await new Client().get('/auth/login'); assert(/rel="manifest"/.test(lp.text), 'login layout has manifest too');

  // خاموش
  await a.post('/system/modules/toggle', { key: 'system.pwa', enabled: '0' });
  res = await fetch(BASE + '/manifest.webmanifest'); assert(res.status === 404, 'feature off -> manifest 404');
  res = await fetch(BASE + '/sw.js'); assert(res.status === 404, 'feature off -> sw 404');
  r = await a.get('/dashboard'); assert(!/rel="manifest"/.test(r.text) && !/serviceWorker\.register/.test(r.text), 'feature off -> no tags');
  await a.post('/system/modules/toggle', { key: 'system.pwa', enabled: '1' });
  console.log('done');
})().catch((e) => { console.error(e); process.exit(1); });
