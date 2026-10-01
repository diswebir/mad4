'use strict';
/**
 * محافظت CSRF مبتنی بر توکن نشست (برای فرم‌ها و درخواست‌های AJAX)
 * برای فرم‌های multipart، بررسی تا پس از تجزیهٔ بدنه توسط multer به تعویق می‌افتد (csrf.verify)
 */
const crypto = require('crypto');

function sentToken(req) { return (req.body && req.body._csrf) || req.get('x-csrf-token') || (req.query && req.query._csrf); }
function reject(req, res) {
  if (req.xhr || (req.get('accept') || '').includes('application/json')) return res.status(403).json({ ok: false, error: 'توکن امنیتی نامعتبر است. صفحه را بازخوانی کنید.' });
  res.status(403);
  return res.render('errors/403', { title: 'خطای امنیتی', message: 'توکن امنیتی فرم نامعتبر یا منقضی شده است. لطفاً صفحه را بازخوانی و دوباره تلاش کنید.' });
}

function csrf() {
  return (req, res, next) => {
    if (!req.session) return next();
    if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(24).toString('hex');
    res.locals.csrfToken = req.session.csrfToken;
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.is('multipart/form-data')) {
      // بدنه هنوز تجزیه نشده؛ پاسخ‌دهی بدون تأیید توکن مسدود می‌شود
      req._csrfDeferred = true;
      for (const m of ['render', 'redirect', 'json', 'send']) {
        const orig = res[m];
        res[m] = function (...args) { if (!req._csrfVerified) { req._csrfVerified = true; return reject(req, res); } return orig.apply(this, args); };
      }
      return next();
    }
    const sent = sentToken(req);
    if (sent && sent === req.session.csrfToken) { req._csrfVerified = true; return next(); }
    return reject(req, res);
  };
}
/** میان‌افزار تأیید توکن پس از multer */
csrf.verify = (req, res, next) => {
  if (!req.session) return next();
  const sent = sentToken(req);
  if (sent && sent === req.session.csrfToken) { req._csrfVerified = true; return next(); }
  req._csrfVerified = true; // اجازهٔ ارسال پاسخ خطا
  return reject(req, res);
};
module.exports = csrf;
