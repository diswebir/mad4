'use strict';
/**
 * PWA: مانیفست پویا، آیکون PNG تولیدشده (بدون وابستگی)، سرویس‌ورکر و صفحهٔ آفلاین
 * - آیکون: مربع گرد به رنگ برند + نماد کلاه فارغ‌التحصیلی (همان favicon) — رسترایز ساده با چندضلعی‌ها
 * - اگر لوگوی مدرسه PNG/JPG باشد، به‌عنوان آیکون اضافی در مانیفست می‌آید
 */
const zlib = require('zlib');
const path = require('path');
const fs = require('fs');
const express = require('express');
const settings = require('./settings');
const modules = require('./modules');
const config = require('./config');
const pkg = require('../../package.json');

// ---------- PNG encoder ----------
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 4 + 1)] = 0; rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- rasterizer ----------
function hexToRgb(hex) { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim()); if (!m) return [37, 99, 235]; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function inPoly(x, y, poly) { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside; } return inside; }
function inRoundedRect(x, y, s, r) { const cx = Math.min(Math.max(x, r), s - r), cy = Math.min(Math.max(y, r), s - r); return (x - cx) ** 2 + (y - cy) ** 2 <= r * r; }
/** آیکون s×s؛ maskable: پس‌زمینهٔ تمام‌مربع برای ناحیهٔ امن اندروید */
function renderIcon(size, color, maskable) {
  const [br, bg, bb] = hexToRgb(color);
  const u = size / 64; // مختصات بر مبنای viewBox 64
  const pad = maskable ? 8 : 0; // در حالت maskable نماد کوچک‌تر در مرکز
  const sc = (64 - 2 * pad) / 64;
  const T = (p) => [(p[0] * sc + pad) * u, (p[1] * sc + pad) * u];
  const cap = [[32, 14], [8, 26], [32, 38], [56, 26]].map(T);
  const bowlL = [[16, 32], [32, 40], [32, 50], [16, 42]].map(T);
  const bowlR = [[32, 40], [48, 32], [48, 42], [32, 50]].map(T);
  const tassel = [[50.5, 27], [53.5, 27], [53.5, 39], [50.5, 39]].map(T);
  const r = maskable ? 0 : 14 * u;
  const SS = 3; // supersampling
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let aBg = 0, aFg = 0, aFg2 = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS;
      if (maskable || inRoundedRect(px, py, size, r)) aBg++;
      if (inPoly(px, py, cap) || inPoly(px, py, tassel)) aFg++;
      else if (inPoly(px, py, bowlL) || inPoly(px, py, bowlR)) aFg2++;
    }
    const n = SS * SS; const bgA = aBg / n; const fg = aFg / n; const fg2 = (aFg2 / n) * 0.85;
    // ترکیب: پس‌زمینه → سفید نماد
    const w = Math.min(1, fg + fg2);
    const o = (y * size + x) * 4;
    out[o] = Math.round(br * (1 - w) + 255 * w); out[o + 1] = Math.round(bg * (1 - w) + 255 * w); out[o + 2] = Math.round(bb * (1 - w) + 255 * w);
    out[o + 3] = Math.round(255 * Math.max(bgA, w));
  }
  return encodePNG(size, size, out);
}
const iconCache = new Map();
function icon(size, maskable) {
  const color = settings.get('primary_color') || '#2563eb';
  const key = `${size}:${maskable ? 1 : 0}:${color}`;
  if (!iconCache.has(key)) { if (iconCache.size > 12) iconCache.clear(); iconCache.set(key, renderIcon(size, color, maskable)); }
  return iconCache.get(key);
}

// ---------- manifest ----------
function manifest() {
  const name = settings.get('school_name') || 'سامانهٔ مدیریت مدرسه';
  const color = settings.get('primary_color') || '#2563eb';
  const icons = [
    { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/pwa/icon-192.png?maskable=1', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: '/pwa/icon-512.png?maskable=1', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
  ];
  const logo = settings.get('school_logo');
  if (logo && /\.(png|jpe?g)$/i.test(logo)) icons.push({ src: logo.startsWith('/') ? logo : '/' + logo, sizes: 'any', type: /png$/i.test(logo) ? 'image/png' : 'image/jpeg', purpose: 'any' });
  return {
    name, short_name: name.length > 18 ? (settings.get('school_short_name') || name.split(/\s+/).slice(0, 2).join(' ')) : name,
    description: 'سامانهٔ مدیریت مدرسه — حضور و غیاب، نمرات، تکالیف، تیکت و ارتباط با اولیا',
    lang: 'fa', dir: 'rtl', start_url: '/dashboard?source=pwa', scope: '/', display: 'standalone', orientation: 'portrait',
    background_color: '#ffffff', theme_color: color, icons,
    shortcuts: [
      { name: 'داشبورد', url: '/dashboard?source=pwa', icons: [{ src: '/pwa/icon-192.png', sizes: '192x192' }] },
      { name: 'اعلان‌ها', url: '/notifications?source=pwa' },
      { name: 'تیکت‌ها', url: '/tickets?source=pwa' }
    ]
  };
}

// ---------- service worker ----------
function serviceWorker() {
  const v = `v${pkg.version}-${(settings.get('primary_color') || '').replace('#', '')}`;
  return `/* سرویس‌ورکر سامانهٔ مدیریت مدرسه — ${v} */
const VERSION = '${v}';
const STATIC = 'static-' + VERSION;
const PRECACHE = ['/offline', '/assets/css/app.css?v=${pkg.version}', '/assets/js/app.js?v=${pkg.version}', '/assets/vendor/bootstrap/bootstrap.rtl.min.css', '/assets/vendor/bootstrap-icons/bootstrap-icons.min.css', '/assets/img/favicon.svg', '/pwa/icon-192.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(STATIC).then((c) => Promise.allSettled(PRECACHE.map((u) => c.add(u)))).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== STATIC).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // دارایی‌های ایستا: cache-first
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/pwa/')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(STATIC).then((c) => c.put(req, copy)); } return res; })));
    return;
  }
  // صفحه‌ها: network-first، در صورت قطع شبکه صفحهٔ آفلاین (محتوای کاربران هرگز کش نمی‌شود)
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/offline')));
  }
});
`;
}

function router() {
  const r = express.Router();
  const guard = (req, res, next) => (modules.isEnabled('system.pwa') ? next() : res.status(404).end());
  r.get('/manifest.webmanifest', guard, (req, res) => { res.set('Cache-Control', 'public, max-age=3600'); res.type('application/manifest+json').send(JSON.stringify(manifest())); });
  r.get('/sw.js', guard, (req, res) => { res.set({ 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' }); res.type('application/javascript').send(serviceWorker()); });
  r.get('/pwa/:file', guard, (req, res, next) => {
    const m = /^icon-(192|512|180)\.png$/.exec(req.params.file); if (!m) return next();
    res.set('Cache-Control', 'public, max-age=86400'); res.type('image/png').send(icon(Number(m[1]), req.query.maskable === '1'));
  });
  r.get('/offline', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.render('errors/offline', { title: 'آفلاین', layout: false, schoolName: settings.get('school_name') || 'سامانهٔ مدیریت مدرسه', color: settings.get('primary_color') || '#2563eb' });
  });
  return r;
}

module.exports = { router, manifest, icon, renderIcon, encodePNG, serviceWorker };
