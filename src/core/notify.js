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
async function pushRole(role, payload) {
  const ids = await db.table('users').where({ role, status: 'active' }).pluck('id');
  return push(ids, payload);
}
async function unreadCount(userId) { return db.count('notifications', { user_id: userId, is_read: 0 }); }

/** ارسال پیامک از طریق درگاه (کاوه‌نگار / وب‌سرویس عمومی). در حالت غیرفعال فقط لاگ می‌شود. */
async function sms(to, text) {
  if (!modules.isEnabled('notifications.sms') || !settings.getBool('sms_enabled')) return { ok: false, skipped: true };
  const provider = settings.get('sms_provider');
  const apiKey = settings.get('sms_api_key');
  const sender = settings.get('sms_sender');
  if (!apiKey) return { ok: false, error: 'کلید API تنظیم نشده است' };
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!recipients.length) return { ok: false, error: 'گیرنده‌ای وجود ندارد' };
  try {
    if (provider === 'kavenegar') {
      const url = `https://api.kavenegar.com/v1/${encodeURIComponent(apiKey)}/sms/send.json?receptor=${encodeURIComponent(recipients.join(','))}&sender=${encodeURIComponent(sender)}&message=${encodeURIComponent(text)}`;
      const res = await httpGet(url);
      return { ok: res.status < 400, status: res.status };
    }
    if (provider === 'webhook') {
      const url = settings.get('sms_webhook_url', '');
      if (!url) return { ok: false, error: 'آدرس وب‌هوک تنظیم نشده' };
      const res = await httpPostJson(url, { apiKey, sender, to: recipients, text });
      return { ok: res.status < 400, status: res.status };
    }
    return { ok: false, error: 'درگاه پیامک ناشناخته' };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function email(to, subject, html) {
  if (!modules.isEnabled('notifications.email') || !settings.getBool('email_enabled')) return { ok: false, skipped: true };
  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: settings.get('smtp_host'), port: settings.getInt('smtp_port', 587), secure: settings.getBool('smtp_secure'),
      auth: settings.get('smtp_user') ? { user: settings.get('smtp_user'), pass: settings.get('smtp_pass') } : undefined
    });
    await transporter.sendMail({ from: settings.get('smtp_from') || settings.get('smtp_user'), to, subject, html });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

function template(str, vars) { return String(str || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m)); }

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 10000 }, (res) => { let data = ''; res.on('data', (c) => (data += c)); res.on('end', () => resolve({ status: res.statusCode, body: data })); }).on('error', reject);
  });
}
function httpPostJson(url, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const u = new URL(url);
    const req = https.request({ hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 10000 }, (res) => {
      let data = ''; res.on('data', (c) => (data += c)); res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

module.exports = { push, pushRole, unreadCount, sms, email, template };
