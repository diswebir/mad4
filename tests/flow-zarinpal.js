'use strict';
/** جریان: درگاه پرداخت آنلاین زرین‌پال (finance.online_payment) با درگاه ساختگی محلی — تنظیمات، شروع پرداخت، بازگشت موفق/ناموفق/تکراری، ثبت پرداخت و به‌روزرسانی صورت‌حساب، استعلام، صفحهٔ مدیر */
const http = require('http');
const { Client, superPost } = require('./client');
const J = require('../src/core/jalali');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 2; } else console.log('ok:', m); };
const en = (s) => String(s).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';

(async () => {
  // ---------- درگاه ساختگی زرین‌پال ----------
  const mock = { mode: 'ok', calls: [], seq: 0, verified: 0, unverified: [], refBase: 1000000 + Math.floor(Math.random() * 8e6) };
  const server = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      let body = {}; try { body = JSON.parse(b || '{}'); } catch (e) { /* ignore */ }
      mock.calls.push({ url: req.url, body });
      res.setHeader('Content-Type', 'application/json');
      if (req.url.endsWith('/request.json')) {
        if (mock.mode === 'reject') { res.statusCode = 400; return res.end(JSON.stringify({ data: [], errors: { code: -10, message: 'merchant invalid', validations: [] } })); }
        mock.seq++; const authority = 'A' + String(Date.now()).slice(-9) + String(Math.floor(Math.random() * 1e9)).padStart(9, '0') + String(mock.seq).padStart(17, '0');
        return res.end(JSON.stringify({ data: { code: 100, message: 'Success', authority, fee_type: 'Merchant', fee: 0 }, errors: [] }));
      }
      if (req.url.endsWith('/verify.json')) {
        if (mock.mode === 'verify-fail') return res.end(JSON.stringify({ data: [], errors: { code: -51, message: 'Payment failed', validations: [] } }));
        if (mock.mode === 'down') { res.statusCode = 503; return res.end('{}'); }
        return res.end(JSON.stringify({ data: { code: 100, message: 'Verified', card_hash: 'x', card_pan: '603799******1234', ref_id: mock.refBase + mock.seq, fee_type: 'Merchant', fee: 0 }, errors: [] }));
      }
      if (req.url.endsWith('/unVerified.json')) return res.end(JSON.stringify({ data: { code: 100, message: 'Success', authorities: mock.unverified }, errors: [] }));
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const MOCK = `http://127.0.0.1:${port}`;

  // ---------- پیکربندی توسط مدیر ----------
  const a = new Client(); let r = await a.login('admin', 'admin123'); assert(r.status === 302, 'admin login');
  for (const k of ['finance.online_payment', 'finance.student_view', 'finance.invoices', 'finance.payments', 'notifications.inapp']) await superPost('/system/modules/toggle', { key: k, enabled: '1' });
  r = await a.get('/system/settings?tab=payment'); assert(r.status === 200 && /درگاه پرداخت/.test(r.text) && /finance\/pay\/callback/.test(r.text), 'payment settings tab with callback hint');
  const prevSite = (/name="site_url" value="([^"]*)"/.exec(r.text) || [, ''])[1];
  const prevGateway = (/name="payment_gateway"[\s\S]*?<option value="([a-z]+)" selected/.exec(r.text) || [, 'none'])[1];
  r = await a.post('/system/settings/payment', { payment_gateway: 'zarinpal', zarinpal_merchant_id: 'not-a-uuid', zarinpal_sandbox: '0', zarinpal_base_url: MOCK, payment_min_amount: '1000', payment_allow_partial: '1', payment_description: 'پرداخت {title} — {name}', site_url: prevSite });
  r = await a.get('/finance/online'); assert(r.status === 200 && /مرچنت‌کد زرین‌پال نامعتبر/.test(r.text), 'admin page warns about invalid merchant id');
  const MERCHANT = '11111111-2222-3333-4444-555555555555';
  r = await a.post('/system/settings/payment', { payment_gateway: 'zarinpal', zarinpal_merchant_id: MERCHANT, zarinpal_sandbox: '0', zarinpal_base_url: MOCK, payment_min_amount: '1000', payment_allow_partial: '1', payment_description: 'پرداخت {title} — {name}', site_url: prevSite });
  r = await a.get('/system/settings?tab=payment'); assert(r.text.includes(MERCHANT) && r.text.includes(MOCK), 'gateway settings saved');
  r = await a.get('/finance/online'); assert(r.status === 200 && !/مرچنت‌کد زرین‌پال نامعتبر/.test(r.text) && /استعلام تراکنش‌های در انتظار/.test(r.text), 'admin page configured');

  // صورت‌حساب تازه برای دانش‌آموز ۱ (۴۰۰۰۱)
  const tag = 'ZP' + Math.floor(Math.random() * 1e6);
  const due = J.toJalali(J.addDays(J.todayISO(), 30));
  r = await a.post('/finance/invoices', { student_id: '1', title: 'شهریهٔ آزمایشی ' + tag, amount: '300000', discount: '0', due_date: due, status: 'unpaid' });
  assert(r.status === 302 && /\/finance\/invoices\/\d+$/.test(r.location || ''), 'invoice created');
  const invId = Number((r.location || '').split('/').pop());

  // ---------- دانش‌آموز: شروع پرداخت ----------
  const s = new Client(); r = await s.login('40001', '123456'); assert(r.status === 302, 'student login');
  r = await s.get('/finance/my'); assert(r.status === 200 && r.text.includes(tag) && /پرداخت آنلاین/.test(r.text) && /id="payModal"/.test(r.text) && new RegExp(`data-id="${invId}"`).test(r.text), 'student sees online pay button + modal');
  // مبلغ بیشتر از مانده → به مانده محدود می‌شود؛ مبلغ کمتر از حداقل → خطا
  r = await s.post(`/finance/pay/${invId}`, { amount: '500' }); assert(r.status === 302 && /\/finance\/my$/.test(r.location || ''), 'below minimum → redirected back');
  r = await s.get('/finance/my'); assert(/حداقل مبلغ پرداخت آنلاین/.test(r.text), 'flash: minimum amount');
  // پرداخت بخشی (۱۰۰٬۰۰۰)
  r = await s.post(`/finance/pay/${invId}`, { amount: '۱۰۰۰۰۰' }); assert(r.status === 302 && (r.location || '').startsWith(MOCK + '/pg/StartPay/'), 'redirected to gateway StartPay: ' + r.location);
  const auth1 = (r.location || '').split('/').pop();
  const reqCall = mock.calls.find((c) => c.url.endsWith('/request.json'));
  assert(reqCall && reqCall.body.merchant_id === MERCHANT && reqCall.body.amount === 100000 && reqCall.body.currency === 'IRT' && /finance\/pay\/callback$/.test(reqCall.body.callback_url) && /شهریهٔ آزمایشی/.test(reqCall.body.description) && /سارا/.test(reqCall.body.description), 'request payload (merchant, amount, currency, callback, description)');
  assert(reqCall.body.metadata && /^\d+$/.test(reqCall.body.metadata.order_id), 'metadata.order_id set');
  r = await s.get('/finance/my'); assert(/در انتظار پرداخت/.test(r.text), 'pending transaction listed for student');

  // ---------- بازگشت از درگاه (بدون ورود) ----------
  const g = new Client();
  r = await g.get(`/finance/pay/callback?Authority=${auth1}&Status=OK`);
  assert(r.status === 200 && /پرداخت با موفقیت انجام شد/.test(r.text) && /کد پیگیری/.test(r.text) && en(r.text).includes(String(mock.refBase + 1)), 'callback OK → success page with ref id (public layout)');
  const verifyCall = mock.calls.find((c) => c.url.endsWith('/verify.json')); assert(verifyCall && verifyCall.body.amount === 100000 && verifyCall.body.authority === auth1 && verifyCall.body.merchant_id === MERCHANT, 'verify payload');
  // صورت‌حساب و پرداخت
  r = await a.get(`/finance/invoices/${invId}`);
  assert(/پرداخت جزئی/.test(r.text) && en(r.text).includes('ZP-' + (mock.refBase + 1)) && /تراکنش‌های آنلاین/.test(r.text) && /پرداخت موفق/.test(r.text) && /603799\*\*\*\*\*\*1234/.test(r.text), 'invoice: partial, online payment row, online tx section');
  assert(/۱۰۰,۰۰۰|100,000/.test(en(r.text).replace(/۱۰۰,۰۰۰/, '100,000')), 'paid amount visible');
  // تکراری
  r = await g.get(`/finance/pay/callback?Authority=${auth1}&Status=OK`); assert(r.status === 200 && /قبلاً تأیید شده/.test(r.text), 'duplicate callback → already verified, no double payment');
  r = await a.get(`/finance/payments?q=ZP-${mock.refBase + 1}`); const cnt = (en(r.text).match(new RegExp('ZP-' + (mock.refBase + 1), 'g')) || []).length; assert(cnt >= 1, 'payments list has the online payment once per row (' + cnt + ')');
  // اعلان‌ها
  r = await s.get('/notifications'); assert(/پرداخت آنلاین موفق/.test(r.text), 'student notified');
  r = await a.get('/notifications'); assert(/پرداخت آنلاین جدید/.test(r.text), 'admin notified');

  // ---------- انصراف کاربر (Status=NOK) ----------
  r = await s.post(`/finance/pay/${invId}`, { amount: '50000' }); const auth2 = (r.location || '').split('/').pop(); assert(auth2 !== auth1 && auth2.length === 36, 'second transaction started');
  r = await s.get(`/finance/pay/callback?Authority=${auth2}&Status=NOK`); assert(r.status === 402 && /پرداخت انجام نشد/.test(r.text) && /لغو شد/.test(r.text) && /شهریه و پرداخت‌ها/.test(r.text), 'NOK → cancelled page (logged-in layout, link to my)');
  const verifyCalls = mock.calls.filter((c) => c.url.endsWith('/verify.json')).length; assert(verifyCalls === 1, 'no verify call for cancelled transaction');

  // ---------- خطای درگاه هنگام verify ----------
  mock.mode = 'verify-fail';
  r = await s.post(`/finance/pay/${invId}`, { amount: '50000' }); const auth3 = (r.location || '').split('/').pop();
  r = await g.get(`/finance/pay/callback?Authority=${auth3}&Status=OK`); assert(r.status === 402 && /پرداخت ناموفق/.test(r.text) && /-51/.test(r.text), 'verify error -51 shown');
  // اتوریتی ناشناخته / نامعتبر
  r = await g.get('/finance/pay/callback?Authority=ZZZ&Status=OK'); assert(r.status === 402 && /تراکنش یافت نشد/.test(r.text), 'unknown authority');
  r = await g.get('/finance/pay/callback'); assert(r.status === 400, 'missing authority → 400');

  // ---------- پرداخت کامل ماندهٔ باقی‌مانده (۲۰۰٬۰۰۰) بدون مبلغ → وضعیت paid ----------
  mock.mode = 'ok';
  r = await s.post(`/finance/pay/${invId}`, { amount: '999999999' }); const auth4 = (r.location || '').split('/').pop(); assert(auth4.length === 36, 'over-remaining amount clamped & started');
  const lastReq = mock.calls.filter((c) => c.url.endsWith('/request.json')).pop(); assert(lastReq.body.amount === 200000, 'amount clamped to remaining 200000');
  r = await g.get(`/finance/pay/callback?Authority=${auth4}&Status=OK`); assert(r.status === 200 && /موفقیت/.test(r.text), 'final payment ok');
  r = await a.get(`/finance/invoices/${invId}`); assert(/پرداخت شده/.test(r.text) && !/پرداخت جزئی/.test(r.text), 'invoice fully paid');
  r = await s.post(`/finance/pay/${invId}`, { amount: '1000' }); r = await s.get('/finance/my'); assert(/قبلاً تسویه شده/.test(r.text), 'paying a settled invoice is refused');

  // ---------- استعلام (reconcile): تراکنش pending که کاربر برنگشته ----------
  // شروع پرداخت جدید روی صورت‌حساب دیگر
  r = await a.post('/finance/invoices', { student_id: '1', title: 'کتاب ' + tag, amount: '80000', discount: '0', due_date: due, status: 'unpaid' }); const inv2 = Number((r.location || '').split('/').pop());
  r = await s.post(`/finance/pay/${inv2}`, {}); const auth5 = (r.location || '').split('/').pop(); assert(auth5.length === 36, 'pending tx without callback');
  mock.unverified = [{ authority: auth5, amount: 80000, callback_url: 'x', referer: '', date: '' }];
  r = await a.post('/finance/online/reconcile', {}); assert(r.status === 302, 'reconcile posted');
  r = await a.get('/finance/online'); assert(/۱ تأیید/.test(r.text) || /1 تأیید/.test(en(r.text)), 'reconcile verified 1 (flash)');
  r = await a.get(`/finance/invoices/${inv2}`); assert(/پرداخت شده/.test(r.text), 'invoice 2 paid via reconcile');
  // تأیید دستی تراکنش ناموفق (auth3) پس از رفع مشکل درگاه
  r = await a.get('/finance/online?status=failed'); const failedId = Number((new RegExp('/finance/online/(\\d+)/verify').exec(r.text) || [])[1]); assert(failedId > 0, 'failed tx has manual verify action');
  r = await a.post(`/finance/online/${failedId}/verify`, {}); r = await a.get('/finance/online');
  assert(/تراکنش تأیید و پرداخت ثبت شد/.test(r.text), 'manual verify succeeded');
  r = await a.get(`/finance/invoices/${invId}`); assert(en(r.text).includes('ZP-' + (mock.refBase + 1)), 'invoice shows payments');
  // صفحهٔ مدیر: فیلتر و جستجو
  r = await a.get('/finance/online?status=paid'); assert(r.status === 200 && /پرداخت موفق/.test(r.text) && en(r.text).includes('40001'), 'admin list filter paid');
  r = await a.get('/finance/online?q=' + (mock.refBase + 1)); assert(en(r.text).includes(String(mock.refBase + 1)), 'admin search by ref id');
  // صفحهٔ وضعیت JSON برای دانش‌آموز
  r = await s.get('/finance/online'); assert(r.status === 403 || r.status === 302, 'student cannot open admin list');

  // ---------- درگاه خاموش → دکمه مخفی، POST رد می‌شود ----------
  await a.post('/system/settings/payment', { payment_gateway: 'none', zarinpal_merchant_id: MERCHANT, zarinpal_sandbox: '0', zarinpal_base_url: MOCK, payment_min_amount: '1000', payment_allow_partial: '1', payment_description: 'پرداخت {title} — {school}', site_url: prevSite });
  r = await s.get('/finance/my'); assert(!/id="payModal"/.test(r.text), 'gateway off → no pay button');
  r = await a.post('/finance/invoices', { student_id: '1', title: 'سرویس ' + tag, amount: '20000', discount: '0', due_date: due, status: 'unpaid' }); const inv3 = Number((r.location || '').split('/').pop());
  r = await s.post(`/finance/pay/${inv3}`, {}); r = await s.get('/finance/my'); assert(/درگاه پرداخت آنلاین فعال نیست/.test(r.text), 'gateway off → pay refused with flash');
  // ویژگی غیرفعال → callback 404
  await superPost('/system/modules/toggle', { key: 'finance.online_payment', enabled: '0' });
  r = await g.get(`/finance/pay/callback?Authority=${auth1}&Status=OK`); assert(r.status === 404, 'feature disabled → callback 404');
  await superPost('/system/modules/toggle', { key: 'finance.online_payment', enabled: '1' });

  // ---------- پاک‌سازی ----------
  await a.post('/system/settings/payment', { payment_gateway: prevGateway, zarinpal_merchant_id: '', zarinpal_sandbox: '0', zarinpal_base_url: '', payment_min_amount: '', payment_allow_partial: '1', payment_description: 'پرداخت {title} — {school}', site_url: prevSite });
  for (const id of [invId, inv2, inv3]) {
    r = await a.get(`/finance/invoices/${id}`); const num = (/INV-\d{4}-\d+/.exec(en(r.text)) || [''])[0];
    r = await a.get('/finance/payments?q=' + num + '&per=100');
    const pids = [...new Set([...r.text.matchAll(/\/finance\/payments\/(\d+)\/delete/g)].map((m) => Number(m[1])))];
    for (const pid of pids) await a.post(`/finance/payments/${pid}/delete`, {});
    r = await a.post(`/finance/invoices/${id}/delete`, {}); if (r.status !== 302) console.log('cleanup: invoice', id, r.status);
  }
  r = await a.get('/finance/invoices?q=' + tag); assert(!/\/finance\/invoices\/\d+\/delete/.test(r.text), 'cleanup: test invoices and payments removed');
  server.close();
  console.log(process.exitCode ? 'flow-zarinpal: FAILED' : 'flow-zarinpal: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
