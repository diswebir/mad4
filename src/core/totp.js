'use strict';
/**
 * رمز یکبارمصرف زمان‌محور (TOTP — RFC 6238) برای ورود دومرحله‌ای کنسول سازنده
 *  - HMAC-SHA1، گام ۳۰ ثانیه، ۶ رقم، پنجرهٔ تحمل ±۱ گام (ساعت ناهماهنگ گوشی)
 *  - سازگار با Google Authenticator / Microsoft Authenticator / Aegis / FreeOTP
 *  - کلید مخفی با AES-256-GCM و کلید مشتق از appKey پیکربندی رمز می‌شود تا در پشتیبان پایگاه داده به‌صورت خام نماند
 *  - کدهای پشتیبان یکبارمصرف به‌صورت هش SHA-256 نگهداری می‌شوند
 */
const crypto = require('crypto');
const config = require('./config');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** کلید مخفی تازه (۲۰ بایت = ۳۲ کاراکتر base32) */
function generateSecret() { return base32Encode(crypto.randomBytes(20)); }

/** کد ۶ رقمی برای یک شمارندهٔ زمانی مشخص */
function hotp(secret, counter, digits) {
  const key = base32Decode(secret);
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  msg.writeUInt32BE(counter >>> 0, 4);
  const h = crypto.createHmac('sha1', key).update(msg).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | ((h[off + 1] & 0xff) << 16) | ((h[off + 2] & 0xff) << 8) | (h[off + 3] & 0xff);
  return String(bin % Math.pow(10, digits || 6)).padStart(digits || 6, '0');
}
function code(secret, atMs, opts) {
  opts = opts || {};
  const step = opts.step || 30;
  return hotp(secret, Math.floor((atMs == null ? Date.now() : atMs) / 1000 / step), opts.digits || 6);
}
/** بررسی کد با پنجرهٔ ±window گام؛ مقایسهٔ زمان-ثابت */
function verify(secret, token, opts) {
  opts = opts || {};
  const t = String(token || '').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/\D/g, '');
  if (!secret || t.length !== (opts.digits || 6)) return false;
  const step = opts.step || 30, win = opts.window == null ? 1 : opts.window;
  const now = Math.floor((opts.now || Date.now()) / 1000 / step);
  for (let i = -win; i <= win; i++) {
    const expected = hotp(secret, now + i, opts.digits || 6);
    if (expected.length === t.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(t))) return true;
  }
  return false;
}
/** نشانی otpauth برای ساخت QR در برنامهٔ احراز هویت */
function otpauthUrl(secret, account, issuer) {
  const enc = (s) => encodeURIComponent(String(s || '').replace(/[:]/g, ' '));
  return `otpauth://totp/${enc(issuer)}:${enc(account)}?secret=${secret}&issuer=${enc(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// ---------- رمزگذاری کلید مخفی در پایگاه داده ----------
function encKey() {
  const k = (config.get() || {}).appKey || 'madrese-temp-key';
  return crypto.createHash('sha256').update('totp:' + k).digest();
}
function sealSecret(secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const enc = Buffer.concat([cipher.update(String(secret), 'utf8'), cipher.final()]);
  return 'v1:' + iv.toString('base64') + ':' + cipher.getAuthTag().toString('base64') + ':' + enc.toString('base64');
}
function openSecret(sealed) {
  if (!sealed) return null;
  const s = String(sealed);
  if (!s.startsWith('v1:')) return s; // سازگاری با مقدار خام
  try {
    const [, iv, tag, data] = s.split(':');
    const d = crypto.createDecipheriv('aes-256-gcm', encKey(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  } catch (e) { return null; }
}

// ---------- کدهای پشتیبان ----------
const hashCode = (c) => crypto.createHash('sha256').update(String(c).replace(/[^A-Za-z0-9]/g, '').toUpperCase()).digest('hex');
function generateBackupCodes(n) {
  const out = [];
  for (let i = 0; i < (n || 8); i++) { const raw = crypto.randomBytes(5).toString('hex').toUpperCase(); out.push(raw.slice(0, 5) + '-' + raw.slice(5)); }
  return out;
}
/** مصرف یک کد پشتیبان: اگر معتبر بود فهرست جدید (بدون آن کد) برمی‌گردد، وگرنه null */
function consumeBackupCode(storedJson, candidate) {
  let list; try { list = JSON.parse(storedJson || '[]'); } catch (e) { list = []; }
  const h = hashCode(candidate || '');
  const idx = list.findIndex((x) => x.length === h.length && crypto.timingSafeEqual(Buffer.from(x), Buffer.from(h)));
  if (idx < 0) return null;
  list.splice(idx, 1);
  return list;
}

module.exports = { base32Encode, base32Decode, generateSecret, code, verify, otpauthUrl, sealSecret, openSecret, generateBackupCodes, consumeBackupCode, hashCode };
