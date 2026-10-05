'use strict';
/**
 * رمز یکبارمصرف پیامکی (OTP) برای ورود متقاضیان
 *  - کد به‌صورت هش (sha256 + کلید برنامه) ذخیره می‌شود؛ متن کد فقط برای پیامک استفاده می‌شود.
 *  - محدودیت: فاصلهٔ ارسال مجدد، سقف ارسال در ساعت (به ازای شماره و IP)، سقف تلاش برای هر کد، انقضا.
 */
const crypto = require('crypto');
const db = require('./db');
const settings = require('./settings');
const config = require('./config');
const sms = require('./sms');
const utils = require('./utils');

function hash(mobile, code) { return crypto.createHmac('sha256', String(config.get().appKey || 'otp')).update(mobile + ':' + code).digest('hex'); }
function genCode(len) { const digits = utils.randomDigits(len); return /^0/.test(digits) ? String(1 + Math.floor(Math.random() * 9)) + digits.slice(1) : digits; }
const ipCounters = new Map();

/**
 * درخواست کد: برمی‌گرداند { ok, waitSec?, error?, devCode? }
 * purpose: login | verify
 */
async function request(mobile, ip, purpose) {
  mobile = utils.normalizePhone(mobile);
  if (!utils.isValidMobile(mobile)) return { ok: false, error: 'شمارهٔ موبایل معتبر نیست (مثال: ۰۹۱۲۳۴۵۶۷۸۹)' };
  purpose = purpose || 'login';
  const now = Date.now();
  const resend = settings.getInt('otp_resend_seconds', 90);
  const last = await db.table('otp_codes').where('mobile', mobile).where('purpose', purpose).orderBy('id', 'desc').first();
  if (last && last.created_at) {
    const age = (now - new Date(last.created_at.replace(' ', 'T') + (last.created_at.includes('Z') ? '' : 'Z')).getTime()) / 1000;
    if (age < resend && !last.used_at) return { ok: false, waitSec: Math.ceil(resend - age), error: `لطفاً ${utils.num(Math.ceil(resend - age))} ثانیه دیگر دوباره تلاش کنید` };
  }
  const maxPerHour = settings.getInt('otp_max_per_hour', 5);
  const since = new Date(now - 3600000).toISOString().slice(0, 19).replace('T', ' ');
  const recent = await db.table('otp_codes').where('mobile', mobile).where('created_at', '>=', since).count();
  if (recent >= maxPerHour) return { ok: false, error: 'سقف ارسال کد برای این شماره پر شده است؛ لطفاً یک ساعت دیگر تلاش کنید' };
  // محدودیت IP (در حافظه)
  const ipc = ipCounters.get(ip) || { count: 0, ts: now };
  if (now - ipc.ts > 3600000) { ipc.count = 0; ipc.ts = now; }
  if (ipc.count >= Math.max(10, maxPerHour * 4)) return { ok: false, error: 'تعداد درخواست‌ها از این آدرس زیاد است؛ بعداً تلاش کنید' };
  ipc.count++; ipCounters.set(ip, ipc); if (ipCounters.size > 5000) ipCounters.clear();

  const len = Math.min(8, Math.max(4, settings.getInt('otp_length', 5)));
  const code = genCode(len);
  const ttl = Math.max(1, settings.getInt('otp_ttl_minutes', 3));
  const expires = new Date(now + ttl * 60000).toISOString().slice(0, 19).replace('T', ' ');
  // کدهای قبلی باطل می‌شوند
  await db.table('otp_codes').where('mobile', mobile).where('purpose', purpose).whereNull('used_at').update({ used_at: db.now() });
  await db.insert('otp_codes', { mobile, code_hash: hash(mobile, code), purpose, expires_at: expires, attempts: 0, ip: ip || null, created_at: db.now() });
  const r = await sms.sendOtp(mobile, code);
  const out = { ok: true, ttlMin: ttl, resendSec: resend, sent: !!r.ok, smsError: r.ok ? null : r.error };
  // در حالت توسعه/درگاه log، کد برای تست نمایش داده می‌شود (قابل تنظیم)
  if (settings.getBool('otp_dev_show') || (settings.get('sms_provider') || 'log') === 'log' || !settings.getBool('sms_enabled')) out.devCode = code;
  return out;
}

/** تأیید کد: { ok, error } */
async function verify(mobile, code, purpose) {
  mobile = utils.normalizePhone(mobile);
  code = String(code || '').replace(/\D/g, '');
  if (!code) return { ok: false, error: 'کد را وارد کنید' };
  const row = await db.table('otp_codes').where('mobile', mobile).where('purpose', purpose || 'login').whereNull('used_at').orderBy('id', 'desc').first();
  if (!row) return { ok: false, error: 'کدی برای این شماره ثبت نشده است؛ دوباره درخواست کنید' };
  const exp = new Date(String(row.expires_at).replace(' ', 'T') + (String(row.expires_at).includes('Z') ? '' : 'Z')).getTime();
  if (Date.now() > exp) { await db.table('otp_codes').where('id', row.id).update({ used_at: db.now() }); return { ok: false, error: 'کد منقضی شده است؛ کد جدید درخواست کنید', expired: true }; }
  const max = settings.getInt('otp_max_attempts', 5);
  if (row.attempts >= max) { await db.table('otp_codes').where('id', row.id).update({ used_at: db.now() }); return { ok: false, error: 'تعداد تلاش بیش از حد مجاز؛ کد جدید درخواست کنید', expired: true }; }
  const expected = Buffer.from(hash(mobile, code)); const actual = Buffer.from(String(row.code_hash));
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    await db.table('otp_codes').where('id', row.id).update({ attempts: (row.attempts || 0) + 1 });
    return { ok: false, error: 'کد وارد شده صحیح نیست' + (max - row.attempts - 1 > 0 ? ` (${utils.num(max - row.attempts - 1)} تلاش باقی مانده)` : '') };
  }
  await db.table('otp_codes').where('id', row.id).update({ used_at: db.now() });
  return { ok: true };
}

async function cleanup() { try { await db.table('otp_codes').where('created_at', '<', new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 19).replace('T', ' ')).delete(); } catch (e) { /* ignore */ } }

module.exports = { request, verify, cleanup, genCode };
