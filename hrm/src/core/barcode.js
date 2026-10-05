'use strict';
/**
 * تولید بارکد Code 128 (SVG، بدون وابستگی) و QR (با بستهٔ qrcode، جاوااسکریپت خالص)
 * - code128(text): SVG قابل اسکن با بارکدخوان‌های USB و اپلیکیشن‌های موبایل (مجموعهٔ C برای رشته‌های عددی زوج، در غیر این صورت B)
 * - qr(text, {size}): SVG کد QR (سطح تصحیح خطای M)، همگام — نتیجه در حافظه کش می‌شود
 */
const QRCode = require('qrcode');
const svgTag = require('qrcode/lib/renderer/svg-tag');

// الگوهای عرض ۶تایی (میله/فاصله) برای ۱۰۷ نماد Code 128 — نماد ۱۰۶ (Stop) با میلهٔ پایانی، ۷ عنصر دارد
const PATTERNS = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 ' +
  '221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 ' +
  '231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 ' +
  '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 ' +
  '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 ' +
  '114131 311141 411131 211412 211214 211232 2331112').split(' ');
const START_B = 104; const START_C = 105; const STOP = 106;

/** محاسبهٔ دنبالهٔ نمادها (با چک‌سام) برای متن ورودی */
function symbols(text) {
  const s = String(text == null ? '' : text);
  const out = [];
  if (/^\d+$/.test(s) && s.length % 2 === 0 && s.length > 0) {
    out.push(START_C);
    for (let i = 0; i < s.length; i += 2) out.push(Number(s.slice(i, i + 2)));
  } else {
    out.push(START_B);
    for (const ch of s) {
      const code = ch.charCodeAt(0);
      if (code < 32 || code > 126) throw new Error('Code 128: only printable ASCII is supported');
      out.push(code - 32);
    }
  }
  let sum = out[0];
  for (let i = 1; i < out.length; i++) sum += out[i] * i;
  out.push(sum % 103);
  out.push(STOP);
  return out;
}

/**
 * SVG بارکد Code 128
 * @param {string} text متن (ASCII قابل چاپ)
 * @param {{height?:number, module?:number, quiet?:number, label?:boolean, color?:string}} [opt]
 */
function code128(text, opt = {}) {
  const height = opt.height || 36; const mod = opt.module || 1; const quiet = opt.quiet == null ? 10 : opt.quiet; const color = opt.color || '#111';
  const seq = symbols(text);
  const rects = []; let x = quiet;
  for (const sym of seq) {
    const widths = PATTERNS[sym];
    for (let i = 0; i < widths.length; i++) {
      const w = Number(widths[i]) * mod;
      if (i % 2 === 0) rects.push(`<rect x="${x}" y="0" width="${w}" height="${height}"/>`);
      x += w;
    }
  }
  const width = x + quiet;
  const labelH = opt.label === false ? 0 : 10;
  const label = labelH ? `<text x="${width / 2}" y="${height + 9}" font-family="monospace" font-size="9" text-anchor="middle" fill="${color}">${escapeXml(String(text))}</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height + labelH}" width="${width}" height="${height + labelH}" shape-rendering="crispEdges" role="img" aria-label="${escapeXml(String(text))}"><rect width="${width}" height="${height + labelH}" fill="#fff"/><g fill="${color}">${rects.join('')}</g>${label}</svg>`;
}

const qrCache = new Map();
/** SVG کد QR (سطح M) — همگام (قابل استفاده در قالب‌ها)؛ کش حداکثر ۵۰۰ مورد */
function qr(text, opt = {}) {
  const key = text + '|' + (opt.color || '') + '|' + (opt.margin == null ? 0 : opt.margin) + '|' + (opt.level || 'M') + '|' + (opt.size || '');
  if (qrCache.has(key)) return qrCache.get(key);
  const data = QRCode.create(String(text), { errorCorrectionLevel: opt.level || 'M' });
  let svg = svgTag.render(data, { margin: opt.margin == null ? 0 : opt.margin, color: { dark: opt.color || '#111111', light: '#ffffff' } });
  if (opt.size) svg = svg.replace('<svg ', `<svg width="${opt.size}" height="${opt.size}" `);
  if (qrCache.size > 500) qrCache.clear();
  qrCache.set(key, svg);
  return svg;
}

function escapeXml(s) { return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c])); }

module.exports = { code128, qr, symbols, PATTERNS };
