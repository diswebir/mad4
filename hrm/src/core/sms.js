'use strict';
/**
 * درگاه پیامک — IPPanel Edge API (https://ippanelcom.github.io/Edge-Document/docs/)
 *   POST {base}/api/send   Authorization: <API KEY>   Content-Type: application/json
 *   webservice: { sending_type:'webservice', from_number, message, params:{ recipients:[+98…] } }
 *   pattern:    { sending_type:'pattern', from_number, code:<pattern code>, recipients:[+98…], params:{ code:'1234' } }
 * در حالت «log» چیزی ارسال نمی‌شود و فقط در جدول sms_logs ثبت می‌شود (مناسب تست و توسعه).
 */
const https = require('https');
const http = require('http');
const db = require('./db');
const settings = require('./settings');
const utils = require('./utils');

function template(str, vars) { return String(str || '').replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? vars[k] : m)); }

function postJson(url, payload, headers) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const u = new URL(url);
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.request({ hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443), path: u.pathname + u.search, method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Accept: 'application/json' }, headers || {}), timeout: 20000 }, (res) => {
      let data = ''; res.on('data', (c) => (data += c)); res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout'))); req.write(body); req.end();
  });
}

function parseEdge(res) {
  let json = null; try { json = JSON.parse(res.body); } catch (e) { /* ignore */ }
  const meta = json && json.meta;
  const ok = res.status < 400 && (!meta || meta.status !== false);
  const ids = json && json.data && (json.data.message_outbox_ids || json.data.bulk_id || json.data.id);
  return { ok, status: res.status, error: ok ? null : ((meta && (meta.message || (meta.errors && JSON.stringify(meta.errors)))) || ('HTTP ' + res.status)), providerId: Array.isArray(ids) ? String(ids[0] || '') : (ids ? String(ids) : null), raw: json };
}

/** ارسال واقعی — opts: { pattern: 'کد الگو', params: {...} } → ارسال الگو (OTP)؛ در غیر این صورت وب‌سرویس */
async function deliver(recipients, text, opts) {
  opts = opts || {};
  const provider = settings.get('sms_provider') || 'log';
  const apiKey = String(settings.get('sms_api_key') || '').trim();
  const sender = String(settings.get('sms_sender') || '').trim();
  const base = String(settings.get('sms_api_base') || 'https://edge.ippanel.com/v1').replace(/\/$/, '');
  if (!recipients.length) return { ok: false, error: 'گیرنده‌ای وجود ندارد', provider };
  if (provider === 'log') return { ok: true, provider, logged: true };
  if (provider !== 'ippanel') return { ok: false, error: 'درگاه پیامک ناشناخته', provider };
  if (!apiKey) return { ok: false, error: 'کلید API تنظیم نشده است', provider };
  if (!sender) return { ok: false, error: 'شمارهٔ فرستنده تنظیم نشده است', provider };
  const from = sender.startsWith('+') ? sender : (sender.startsWith('98') ? '+' + sender : (sender.startsWith('0') ? '+98' + sender.slice(1) : '+' + sender));
  try {
    let payload;
    if (opts.pattern) payload = { sending_type: 'pattern', from_number: from, code: opts.pattern, recipients: [recipients[0]], params: opts.params || {} };
    else payload = { sending_type: 'webservice', from_number: from, message: text, params: { recipients } };
    const res = await postJson(base + '/api/send', payload, { Authorization: apiKey });
    const out = parseEdge(res); out.provider = provider; return out;
  } catch (e) { return { ok: false, error: e.message, provider }; }
}

/**
 * ارسال پیامک + ثبت در sms_logs. to: شماره یا آرایه (09…)؛ opts: { kind, userId, pattern, params, logText }
 * برمی‌گرداند { ok, error, count, skipped }
 */
async function send(to, text, opts) {
  opts = opts || {};
  const list = [...new Set((Array.isArray(to) ? to : [to]).map((x) => utils.normalizePhone(x)).filter((x) => utils.isValidMobile(x)))];
  if (!list.length) return { ok: false, error: 'شمارهٔ موبایل معتبر نیست', count: 0 };
  const enabled = settings.getBool('sms_enabled');
  let result;
  if (!enabled) result = { ok: false, skipped: true, error: 'پیامک غیرفعال است', provider: settings.get('sms_provider') || 'log' };
  else result = await deliver(list.map(utils.toE164), text, opts);
  try {
    const now = db.now();
    const logText = opts.logText || text;
    await db.insert('sms_logs', list.map((m) => ({ mobile: m, message: String(logText).slice(0, 1000), kind: opts.kind || 'general', status: result.ok ? 'sent' : (result.skipped ? 'skipped' : 'failed'), provider: result.provider || null, provider_id: result.providerId || null, error: result.error ? String(result.error).slice(0, 255) : null, cost: result.ok ? settings.getInt('sms_price', 0) : 0, user_id: opts.userId || null, created_at: now, sent_at: result.ok ? now : null })));
  } catch (e) { /* ignore */ }
  if (!result.ok && !result.skipped) { try { require('./logger').warn('sms failed', { to: list.length, error: result.error, kind: opts.kind }); } catch (e) { /* ignore */ } }
  result.count = list.length;
  return result;
}

/** ارسال کد یکبارمصرف: اگر الگوی OTP تنظیم شده باشد از pattern استفاده می‌شود، وگرنه متن قالب */
async function sendOtp(mobile, code) {
  const pattern = String(settings.get('sms_pattern_otp') || '').trim();
  const text = template(settings.get('sms_template_otp'), { code, company: settings.get('company_short_name') || settings.get('company_name') });
  const opts = { kind: 'otp', logText: text.replace(code, '*****') };
  if (pattern) { opts.pattern = pattern; opts.params = { [settings.get('sms_pattern_otp_var') || 'code']: String(code) }; }
  return send(mobile, text, opts);
}

/** وضعیت پیکربندی برای نمایش در تنظیمات */
function status() {
  const provider = settings.get('sms_provider') || 'log';
  return { enabled: settings.getBool('sms_enabled'), provider, configured: provider === 'log' || (!!settings.get('sms_api_key') && !!settings.get('sms_sender')), pattern: !!settings.get('sms_pattern_otp') };
}

module.exports = { send, sendOtp, deliver, template, status, postJson };
