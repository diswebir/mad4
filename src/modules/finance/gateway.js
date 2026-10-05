'use strict';
/**
 * درگاه پرداخت آنلاین — زرین‌پال (REST نسخهٔ ۴)
 *  - request → هدایت کاربر به صفحهٔ پرداخت → callback → verify → ثبت پرداخت در جدول payments
 *  - واحد مبلغ: مطابق تنظیم currency_unit (تومان → IRT، ریال → IRR)
 *  - آدرس پایهٔ درگاه قابل تنظیم است (sandbox / production / آزمایش محلی)
 */
const db = require('../../core/db');
const settings = require('../../core/settings');
const J = require('../../core/jalali');
const logger = require('../../core/logger');

const PROD_URL = 'https://payment.zarinpal.com';
const SANDBOX_URL = 'https://sandbox.zarinpal.com';
const STATUSES = { pending: 'در انتظار پرداخت', paid: 'پرداخت موفق', failed: 'ناموفق', cancelled: 'انصراف کاربر', expired: 'منقضی' };
/** پیام‌های خطای رایج زرین‌پال */
const ERRORS = {
  '-9': 'خطای اعتبارسنجی (مبلغ یا مرچنت نامعتبر)', '-10': 'مرچنت‌کد نامعتبر است', '-11': 'مرچنت‌کد فعال نیست', '-12': 'تلاش بیش از حد در بازهٔ زمانی کوتاه', '-15': 'درگاه در حالت تعلیق است',
  '-16': 'سطح تأیید پذیرنده پایین‌تر از نقره‌ای است', '-17': 'محدودیت پذیرنده در سطح آبی', '-30': 'پذیرنده اجازهٔ دسترسی به سرویس تسویهٔ اشتراکی ندارد', '-31': 'حساب بانکی تسویه معرفی نشده',
  '-33': 'درصدهای تسهیم صحیح نیست', '-34': 'مبلغ از کل تراکنش بیشتر است', '-40': 'پارامترهای اضافی نامعتبر', '-50': 'مبلغ پرداخت‌شده با مبلغ ارسالی در verify متفاوت است', '-51': 'پرداخت ناموفق',
  '-52': 'خطای غیرمنتظره؛ با پشتیبانی تماس بگیرید', '-53': 'اتوریتی برای این مرچنت‌کد نیست', '-54': 'اتوریتی نامعتبر است', '-55': 'تراکنش یافت نشد', '101': 'تراکنش قبلاً تأیید شده است'
};

function enabled() { return settings.get('payment_gateway', 'none') === 'zarinpal'; }
function configured() { return enabled() && /^[0-9a-f-]{36}$/i.test(settings.get('zarinpal_merchant_id', '') || ''); }
function baseUrl() {
  const custom = (settings.get('zarinpal_base_url', '') || '').trim().replace(/\/$/, '');
  if (custom) return custom;
  return settings.getBool('zarinpal_sandbox') ? SANDBOX_URL : PROD_URL;
}
function currency() { return /ریال/.test(settings.get('currency_unit', 'تومان')) ? 'IRR' : 'IRT'; }
function minAmount() { const n = Number(settings.get('payment_min_amount', '')); if (Number.isFinite(n) && n > 0) return n; return currency() === 'IRR' ? 10000 : 1000; }
function startPayUrl(authority) { return `${baseUrl()}/pg/StartPay/${encodeURIComponent(authority)}`; }
function siteUrl(req) {
  const s = (settings.get('site_url', '') || '').trim().replace(/\/$/, '');
  if (s) return s;
  if (req) return `${req.protocol}://${req.get('host')}`;
  return '';
}

async function postJson(url, payload) {
  const u = new URL(url);
  const mod = u.protocol === 'http:' ? require('http') : require('https');
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const rq = mod.request({ hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443), path: u.pathname + u.search, method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 20000 }, (res) => {
      let data = ''; res.on('data', (c) => (data += c)); res.on('end', () => { let json = null; try { json = JSON.parse(data); } catch (e) { /* not json */ } resolve({ status: res.statusCode, json, raw: data }); });
    });
    rq.on('error', reject); rq.on('timeout', () => rq.destroy(new Error('مهلت اتصال به درگاه تمام شد'))); rq.write(body); rq.end();
  });
}
function errorOf(res) {
  if (!res) return 'پاسخی از درگاه دریافت نشد';
  const err = res.json && res.json.errors;
  if (err && !Array.isArray(err) && err.code != null) return `${ERRORS[String(err.code)] || err.message || 'خطای درگاه'} (کد ${err.code})`;
  if (Array.isArray(err) && err.length) return String(err[0].message || err[0]);
  if (res.status >= 400) return 'خطای HTTP ' + res.status + ' از درگاه';
  return 'پاسخ نامعتبر از درگاه';
}

/**
 * ایجاد تراکنش و دریافت نشانی پرداخت
 * @returns {{ ok: boolean, id?: number, url?: string, error?: string }}
 */
async function request(req, { invoice, student, amount, user }) {
  if (!configured()) return { ok: false, error: 'درگاه پرداخت پیکربندی نشده است' };
  const now = db.now();
  const id = await db.insert('online_payments', { invoice_id: invoice.id, student_id: student.id, user_id: user ? user.id : null, amount, gateway: 'zarinpal', status: 'pending', created_at: now, updated_at: now });
  const callback = `${siteUrl(req)}/finance/pay/callback`;
  const description = require('../../core/notify').template(settings.get('payment_description', 'پرداخت {title} — {school}') || 'پرداخت {title} — {school}', { title: invoice.title, number: invoice.number, name: `${student.first_name} ${student.last_name}`, school: settings.get('school_name', 'مدرسه') });
  const payload = { merchant_id: settings.get('zarinpal_merchant_id'), amount: Math.round(Number(amount)), currency: currency(), description: description.slice(0, 250), callback_url: callback, metadata: { order_id: String(id) } };
  const mobile = (student.mobile || student.father_phone || '').replace(/\D/g, ''); if (/^09\d{9}$/.test(mobile)) payload.metadata.mobile = mobile;
  if (student.email) payload.metadata.email = student.email;
  let res = null; let netErr = null;
  try { res = await postJson(`${baseUrl()}/pg/v4/payment/request.json`, payload); } catch (e) { netErr = e.message; }
  const data = res && res.json && res.json.data;
  if (data && (data.code === 100 || data.code === '100') && data.authority) {
    await db.update('online_payments', { authority: data.authority, callback_url: callback, updated_at: db.now() }, { id });
    return { ok: true, id, authority: data.authority, url: startPayUrl(data.authority) };
  }
  const error = netErr ? ('اتصال به درگاه برقرار نشد: ' + netErr) : errorOf(res);
  await db.update('online_payments', { status: 'failed', error: error.slice(0, 255), updated_at: db.now() }, { id });
  logger.warn('zarinpal request failed', { error, invoice: invoice.id });
  return { ok: false, id, error };
}

/**
 * تأیید تراکنش پس از بازگشت از درگاه. در صورت موفقیت، پرداخت در جدول payments ثبت می‌شود.
 * @returns {{ ok: boolean, payment, invoice, refId?, error?, already? }}
 */
async function verify(authority, statusParam) {
  const p = await db.table('online_payments').where('authority', authority).orderBy('id', 'desc').first();
  if (!p) return { ok: false, error: 'تراکنش یافت نشد' };
  const invoice = await db.findById('invoices', p.invoice_id);
  if (p.status === 'paid') return { ok: true, already: true, payment: p, invoice, refId: p.ref_id };
  if (statusParam && String(statusParam).toUpperCase() !== 'OK') {
    await db.update('online_payments', { status: 'cancelled', error: 'کاربر از پرداخت منصرف شد', updated_at: db.now() }, { id: p.id });
    return { ok: false, payment: p, invoice, error: 'پرداخت توسط شما لغو شد یا ناموفق بود' };
  }
  let res; let netErr = null;
  try { res = await postJson(`${baseUrl()}/pg/v4/payment/verify.json`, { merchant_id: settings.get('zarinpal_merchant_id'), amount: Math.round(Number(p.amount)), authority }); } catch (e) { netErr = e.message; }
  const data = res && res.json && res.json.data;
  const code = data && Number(data.code);
  if (code === 100 || code === 101) {
    const refId = data.ref_id != null ? String(data.ref_id) : null;
    const now = db.now();
    let paymentId = p.payment_id;
    if (!paymentId && invoice) {
      paymentId = await db.insert('payments', { invoice_id: invoice.id, student_id: invoice.student_id, amount: p.amount, method: 'online', reference: refId ? 'ZP-' + refId : 'ZP-' + authority.slice(-8), paid_at: J.todayISO(), note: 'پرداخت آنلاین زرین‌پال' + (data.card_pan ? ' — کارت ' + data.card_pan : ''), recorded_by: null, created_at: now });
      await recalcInvoice(invoice.id);
    }
    await db.update('online_payments', { status: 'paid', ref_id: refId, card_pan: data.card_pan || null, fee: data.fee != null ? Number(data.fee) : null, payment_id: paymentId, verified_at: now, updated_at: now, error: null }, { id: p.id });
    return { ok: true, payment: Object.assign({}, p, { status: 'paid', ref_id: refId, payment_id: paymentId }), invoice, refId };
  }
  const error = netErr ? ('اتصال به درگاه برقرار نشد: ' + netErr) : errorOf(res);
  // خطای شبکه: در انتظار بماند تا استعلام بعدی؛ خطای قطعی: ناموفق
  const final = !netErr && !(res && res.status >= 500);
  await db.update('online_payments', { status: final ? 'failed' : 'pending', error: error.slice(0, 255), updated_at: db.now() }, { id: p.id });
  logger.warn('zarinpal verify failed', { error, authority });
  return { ok: false, payment: p, invoice, error };
}

async function recalcInvoice(invoiceId) {
  const inv = await db.findById('invoices', invoiceId); if (!inv) return;
  const paid = Number(await db.table('payments').where('invoice_id', inv.id).sum('amount')) || 0;
  const due = Number(inv.amount) - Number(inv.discount || 0);
  const status = inv.status === 'cancelled' ? 'cancelled' : (paid >= due - 0.5 ? 'paid' : paid > 0 ? 'partial' : 'unpaid');
  await db.update('invoices', { paid_amount: paid, status, updated_at: db.now() }, { id: inv.id });
}

/** استعلام تراکنش‌های پرداخت‌شدهٔ تأییدنشده (کاربر پرداخت کرده ولی به سایت برنگشته) و تأیید آن‌ها */
async function reconcile() {
  if (!configured()) return { checked: 0, verified: 0, expired: 0, error: 'درگاه پیکربندی نشده' };
  const out = { checked: 0, verified: 0, expired: 0 };
  // منقضی‌کردن در انتظارهای قدیمی (بیش از ۲ ساعت)
  const cutoff = new Date(Date.now() - 2 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  let unverified = [];
  try { const res = await postJson(`${baseUrl()}/pg/v4/payment/unVerified.json`, { merchant_id: settings.get('zarinpal_merchant_id') }); unverified = (res.json && res.json.data && res.json.data.authorities) || []; } catch (e) { out.error = e.message; }
  const pending = await db.table('online_payments').where('status', 'pending').whereNotNull('authority').all();
  for (const p of pending) {
    out.checked++;
    if (unverified.some((u) => u.authority === p.authority)) { const r = await verify(p.authority, 'OK'); if (r.ok) out.verified++; continue; }
    if (p.created_at < cutoff) { await db.update('online_payments', { status: 'expired', error: 'بدون پرداخت منقضی شد', updated_at: db.now() }, { id: p.id }); out.expired++; }
  }
  return out;
}

module.exports = { enabled, configured, baseUrl, currency, minAmount, request, verify, reconcile, startPayUrl, siteUrl, STATUSES, ERRORS, PROD_URL, SANDBOX_URL };
