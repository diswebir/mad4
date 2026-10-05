'use strict';
/** پیام‌های یک‌بارمصرف (flash) روی نشست */
function flash() {
  return (req, res, next) => {
    req.flash = (type, message) => {
      if (!req.session) return;
      req.session.flash = req.session.flash || [];
      req.session.flash.push({ type, message });
    };
    res.locals.flashMessages = (req.session && req.session.flash) || [];
    if (req.session && req.session.flash) delete req.session.flash;
    // نگه‌داشتن داده‌های فرم پس از خطا
    res.locals.old = (req.session && req.session.oldInput) || {};
    if (req.session && req.session.oldInput) delete req.session.oldInput;
    req.keepInput = () => { if (req.session) req.session.oldInput = req.body; };
    next();
  };
}
module.exports = flash;
