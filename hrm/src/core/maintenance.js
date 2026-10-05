'use strict';
/**
 * حالت تعمیر و نگهداری
 *  - منبع وضعیت: تنظیم `maintenance_mode` یا وجود فایل storage/maintenance.flag (برای زمان به‌روزرسانی دستی)
 *  - مدیر همیشه دسترسی دارد (با نوار هشدار)؛ سایر کاربران صفحهٔ ۵۰۳ می‌بینند
 *  - مسیرهای مجاز: ورود/خروج، دارایی‌ها، سلامت، cron، بازگشت درگاه پرداخت
 *  - IPهای مجاز (maintenance_allow_ips) نیز عبور می‌کنند
 */
const fs = require('fs');
const path = require('path');
const config = require('./config');
const settings = require('./settings');

const FLAG = () => path.join(config.ROOT, 'storage', 'maintenance.flag');
const ALLOW_PREFIX = ['/assets', '/auth/login', '/auth/logout', '/auth/forgot', '/auth/reset', '/healthz', '/cron', '/install', '/finance/pay/callback', '/manifest.webmanifest', '/sw.js', '/offline'];
let flagCache = { at: 0, on: false, info: null };

function flagState() {
  const now = Date.now();
  if (now - flagCache.at < 3000) return flagCache;
  let on = false; let info = null;
  try { if (fs.existsSync(FLAG())) { on = true; try { info = JSON.parse(fs.readFileSync(FLAG(), 'utf8')); } catch (e) { info = {}; } } } catch (e) { /* ignore */ }
  flagCache = { at: now, on, info };
  return flagCache;
}
/** فعال است اگر: پرچم فایل وجود دارد (همیشه، برای فرایند به‌روزرسانی) یا تنظیم maintenance_mode روشن و قابلیت system.maintenance فعال باشد */
function isOn() { return flagState().on || (settings.getBool('maintenance_mode') && require('./modules').isEnabled('system.maintenance')); }
function reason() { const f = flagState(); return f.on && f.info && f.info.reason ? f.info.reason : null; }
function message() { return reason() || settings.get('maintenance_message', '') || 'سامانه به‌طور موقت برای به‌روزرسانی و نگهداری در دسترس نیست. لطفاً کمی بعد دوباره تلاش کنید.'; }
function until() { return settings.get('maintenance_until', '') || ''; }
function allowedIp(ip) {
  const list = settings.getList('maintenance_allow_ips').map((s) => s.trim()).filter(Boolean);
  if (!list.length || !ip) return false;
  const norm = String(ip).replace(/^::ffff:/, '');
  return list.some((a) => a === norm || (a.endsWith('*') && norm.startsWith(a.slice(0, -1))));
}
/** فعال‌کردن با فایل (برای اسکریپت‌ها) */
function setFlag(reasonText) { try { fs.writeFileSync(FLAG(), JSON.stringify({ reason: reasonText || null, at: new Date().toISOString() })); } catch (e) { /* ignore */ } flagCache.at = 0; }
function clearFlag() { try { fs.unlinkSync(FLAG()); } catch (e) { /* ignore */ } flagCache.at = 0; }

function middleware() {
  return (req, res, next) => {
    const on = isOn();
    res.locals.maintenanceOn = on;
    if (!on) return next();
    res.locals.maintenanceMessage = message();
    if (ALLOW_PREFIX.some((p) => req.path === p || req.path.startsWith(p + '/') || req.path.startsWith(p + '?'))) return next();
    if (req.user && req.user.role === 'admin') return next();
    if (allowedIp(req.ip)) return next();
    res.set('Retry-After', '600');
    if (req.xhr || (req.get('accept') || '').includes('application/json')) return res.status(503).json({ ok: false, maintenance: true, error: message() });
    return res.status(503).render('errors/maintenance', { layout: 'layouts/public', title: 'تعمیر و نگهداری', message: message(), until: until() });
  };
}

module.exports = { isOn, message, until, reason, allowedIp, setFlag, clearFlag, middleware, FLAG };
