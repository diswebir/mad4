'use strict';
/**
 * اعلان‌ها: درون‌برنامه‌ای، پیامک (درگاه قابل تنظیم) و ایمیل (SMTP)
 */
const https = require('https');
const db = require('./db');
const settings = require('./settings');
const modules = require('./modules');

async function push(userIds, { title, body, link, type }) {
  if (!modules.isEnabled('notifications.inapp')) return 0;
  const ids = [...new Set((Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean))];
  if (!ids.length) return 0;
  const now = db.now();
  await db.insert('notifications', ids.map((user_id) => ({ user_id, title: String(title).slice(0, 200), body: body || null, link: link || null, type: type || 'info', is_read: 0, created_at: now })));
  return ids.length;
}
/** اعلان به همهٔ کاربران فعال یک نقش (حساب سازنده مستثناست — نامرئی برای سامانهٔ مدرسه) */
async function pushRole(role, payload) {
  const ids = await db.table('users').where({ role, status: 'active' }).where('is_super', 0).pluck('id');
  return push(ids, payload);
}
/** شناسهٔ حساب‌های سازنده (super admin) */
async function superIds() { try { return await db.table('users').where({ is_super: 1, status: 'active' }).pluck('id'); } catch (e) { return []; } }
/** اعلان درون‌برنامه‌ای به سازنده + ایمیل هشدار (در صورت تنظیم superadmin_alert_email و SMTP) */
async function pushSuper(payload, opts) {
  const ids = await superIds();
  let n = 0;
  if (ids.length && (!opts || opts.inapp !== false)) n = await push(ids, payload);
  const to = settings.get('superadmin_alert_email');
  if (to && (!opts || opts.email !== false)) {
    const subject = `[${settings.get('school_name')}] ${payload.title}`;
    const html = `<p>${payload.title}</p><p>${payload.body || ''}</p>` + (payload.link ? `<p><a href="${(settings.get('site_url') || '').replace(/\/$/, '')}${payload.link}">${payload.link}</a></p>` : '');
    try { await email(to, subject, html, { context: 'console' }); } catch (e) { /* ignore */ }
  }
  return n;
}
async function unreadCount(userId) { return db.count('notifications', { user_id: userId, is_read: 0 }); }

/** خطاهایی که با تلاش مجدد حل نمی‌شوند (پیکربندی) */
const CONFIG_ERRORS = ['کلید API تنظیم نشده است', 'آدرس وب‌هوک تنظیم نشده', 'درگاه پیامک ناشناخته', 'گیرنده‌ای وجود ندارد', 'پیامک غیرفعال است'];
const isTransient = (err) => !!err && !CONFIG_ERRORS.includes(String(err));

/** ارسال واقعی پیامک به درگاه (بدون لاگ/صف) — توسط sms() و صف تلاش مجدد استفاده می‌شود */
async function deliverSms(recipients, text) {
  const provider = settings.get('sms_provider') || 'log';
  const apiKey = settings.get('sms_api_key');
  const sender = settings.get('sms_sender');
  if (!recipients.length) return { ok: false, error: 'گیرنده‌ای وجود ندارد', provider };
  let result;
  try {
    if (provider === 'log') result = { ok: true, status: 200, logged: true };
    else if (!apiKey) result = { ok: false, error: 'کلید API تنظیم نشده است' };
    else if (provider === 'kavenegar') {
      const url = `https://api.kavenegar.com/v1/${encodeURIComponent(apiKey)}/sms/send.json?receptor=${encodeURIComponent(recipients.join(','))}&sender=${encodeURIComponent(sender)}&message=${encodeURIComponent(text)}`;
      const res = await httpGet(url);
      result = { ok: res.status < 400, status: res.status, error: res.status >= 400 ? 'HTTP ' + res.status : null };
    } else if (provider === 'webhook') {
      const url = settings.get('sms_webhook_url', '');
      if (!url) result = { ok: false, error: 'آدرس وب‌هوک تنظیم نشده' };
      else { const res = await httpPostJson(url, { apiKey, sender, to: recipients, text }); result = { ok: res.status < 400, status: res.status, error: res.status >= 400 ? 'HTTP ' + res.status : null }; }
    } else result = { ok: false, error: 'درگاه پیامک ناشناخته' };
  } catch (e) { result = { ok: false, error: e.message }; }
  result.provider = provider;
  return result;
}

/**
 * ارسال پیامک از طریق درگاه (کاوه‌نگار / وب‌سرویس عمومی). در حالت «log» فقط ثبت می‌شود.
 * خطاهای گذرا (شبکه، HTTP 5xx، …) در صورت فعال بودن «صف تلاش مجدد» صف می‌شوند و بعداً دوباره ارسال می‌شوند.
 * opts: { logText, noQueue }
 */
async function sms(to, text, context, opts) {
  opts = opts || {};
  const recipients = [...new Set((Array.isArray(to) ? to : [to]).map((x) => String(x || '').trim()).filter(Boolean))];
  if (!modules.isEnabled('notifications.sms') || !settings.getBool('sms_enabled')) return { ok: false, skipped: true, error: 'پیامک غیرفعال است' };
  if (!recipients.length) return { ok: false, error: 'گیرنده‌ای وجود ندارد' };
  const result = await deliverSms(recipients, text);
  const provider = result.provider;
  if (!result.ok && provider !== 'log') require('./logger').warn('sms failed', { provider, to: recipients.length, error: result.error, context });
  let queued = [];
  if (!result.ok && !opts.noQueue && isTransient(result.error) && modules.isEnabled('notifications.retry_queue')) {
    try { queued = await require('./notifyQueue').enqueue('sms', recipients.map((r) => ({ recipient: r, payload: { text }, context: context || null, error: result.error }))); } catch (e) { require('./logger').warn('notify queue failed', { error: e.message }); }
  }
  try {
    const now = db.now();
    const logText = (provider !== 'log' && opts.logText) ? opts.logText : text;
    await db.insert('sms_log', recipients.map((r, i) => ({ recipient: r, message: String(logText).slice(0, 1000), provider, status: result.ok ? 'sent' : (queued.length ? 'queued' : 'failed'), error: result.error ? String(result.error).slice(0, 255) : null, context: context || null, queue_id: queued[i] || null, created_at: now })));
  } catch (e) { /* جدول لاگ در دسترس نیست */ }
  result.count = recipients.length;
  if (queued.length) { result.queued = true; result.queueIds = queued; }
  return result;
}

/** ارسال واقعی ایمیل (SMTP) */
async function deliverEmail(to, subject, html) {
  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: settings.get('smtp_host'), port: settings.getInt('smtp_port', 587), secure: settings.getBool('smtp_secure'),
      connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
      auth: settings.get('smtp_user') ? { user: settings.get('smtp_user'), pass: settings.get('smtp_pass') } : undefined
    });
    await transporter.sendMail({ from: settings.get('smtp_from') || settings.get('smtp_user'), to, subject, html });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

/** ایمیل؛ در صورت خطا و فعال بودن صف، برای تلاش مجدد صف می‌شود. opts: { context, noQueue } */
async function email(to, subject, html, opts) {
  opts = opts || {};
  if (!modules.isEnabled('notifications.email') || !settings.getBool('email_enabled')) return { ok: false, skipped: true };
  if (!settings.get('smtp_host')) return { ok: false, error: 'SMTP تنظیم نشده است' };
  const result = await deliverEmail(to, subject, html);
  if (!result.ok) {
    require('./logger').warn('email failed', { to, subject, error: result.error });
    if (!opts.noQueue && modules.isEnabled('notifications.retry_queue')) {
      try { const ids = await require('./notifyQueue').enqueue('email', [{ recipient: String(to), payload: { subject, html }, context: opts.context || null, error: result.error }]); result.queued = true; result.queueIds = ids; } catch (e) { /* ignore */ }
    }
  }
  return result;
}

function template(str, vars) { return String(str || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m)); }

function httpGet(url) {
  const mod = /^http:/i.test(url) ? require('http') : https;
  return new Promise((resolve, reject) => {
    const rq = mod.get(url, { timeout: 15000 }, (res) => { let data = ''; res.on('data', (c) => (data += c)); res.on('end', () => resolve({ status: res.statusCode, body: data })); }).on('error', reject);
    rq.on('timeout', () => rq.destroy(new Error('timeout')));
  });
}
function httpPostJson(url, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const u = new URL(url);
    const mod = u.protocol === 'http:' ? require('http') : https;
    const req = mod.request({ hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443), path: u.pathname + u.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 15000 }, (res) => {
      let data = ''; res.on('data', (c) => (data += c)); res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout'))); req.write(body); req.end();
  });
}

module.exports = { push, pushRole, pushSuper, superIds, unreadCount, sms, email, template, deliverSms, deliverEmail, isTransient, httpGet, httpPostJson };
