'use strict';
/**
 * احراز هویت، نقش‌ها و محدودیت تلاش ورود
 */
const bcrypt = require('bcryptjs');
const db = require('./db');
const permissions = require('./permissions');
const settings = require('./settings');

const attempts = new Map(); // key: ip|username → { count, lockedUntil }

async function hashPassword(plain, rounds) { return bcrypt.hash(String(plain), rounds || 10); }
async function verifyPassword(plain, hash) { try { return await bcrypt.compare(String(plain), String(hash || '')); } catch (e) { return false; } }

function clientIp(req) {
  return (req.ip || req.connection?.remoteAddress || '').replace('::ffff:', '') || '0.0.0.0';
}

function throttleKey(req, username) { return clientIp(req) + '|' + String(username || '').toLowerCase(); }
function isLocked(req, username) {
  const a = attempts.get(throttleKey(req, username));
  if (!a) return 0;
  if (a.lockedUntil && a.lockedUntil > Date.now()) return Math.ceil((a.lockedUntil - Date.now()) / 60000);
  if (a.lockedUntil && a.lockedUntil <= Date.now()) attempts.delete(throttleKey(req, username));
  return 0;
}
function recordFailure(req, username) {
  const key = throttleKey(req, username);
  const max = settings.getInt('login_max_attempts', 5);
  const lockMin = settings.getInt('login_lock_minutes', 15);
  const a = attempts.get(key) || { count: 0, lockedUntil: 0 };
  a.count += 1;
  if (a.count >= max) { a.lockedUntil = Date.now() + lockMin * 60000; a.count = 0; }
  attempts.set(key, a);
  if (attempts.size > 5000) attempts.clear();
  return max - a.count;
}
function clearFailures(req, username) { attempts.delete(throttleKey(req, username)); }

/** خالی‌کردن نشست بدون نابودی آن (برای ادامهٔ کار flash/CSRF) */
function clearSession(req) { for (const k of ['userId', 'role', 'loginAt', 'impersonatorId', 'superAuth', 'consolePending']) delete req.session[k]; }

/** بارگذاری کاربر جاری از نشست */
function loadUser() {
  return async (req, res, next) => {
    req.user = null;
    res.locals.currentUser = null;
    res.locals.impersonator = null;
    res.locals.isSuper = false;
    if (!req.session || !req.session.userId) return next();
    try {
      // نشست کنسول سازنده پس از مدت مشخص (superadmin_session_hours) منقضی می‌شود — حتی هنگام «ورود به جای کاربر»
      if (req.session.superAuth && Date.now() - req.session.superAuth > superSessionMs()) { clearSession(req); return next(); }
      const user = await db.table('users').where('id', req.session.userId).first();
      if (!user || user.status !== 'active') { req.session.userId = null; return next(); }
      // حساب سازنده فقط با نشست کنسول معتبر است (نشست‌های قدیمی یا دست‌کاری‌شده رد می‌شوند)
      if (user.is_super && !req.session.superAuth && !req.session.impersonatorId) { clearSession(req); return next(); }
      delete user.password; delete user.totp_secret; delete user.backup_codes;
      user.is_super = Number(user.is_super) ? 1 : 0;
      user.perms = await permissions.permissionsOf(user);
      req.user = user;
      req.can = (...keys) => permissions.can(user, ...keys);
      res.locals.currentUser = user;
      res.locals.can = req.can;
      res.locals.isSuper = !!user.is_super;
      if (req.session.impersonatorId) res.locals.impersonator = await db.table('users').select('id', 'name', 'role', 'is_super').where('id', req.session.impersonatorId).first();
      // پروفایل دانش‌آموز/معلم (در صورت نیاز)
      req.profile = async () => {
        if (req._profile !== undefined) return req._profile;
        if (user.role === 'student') req._profile = await db.table('students').where('user_id', user.id).first();
        else if (user.role === 'teacher') req._profile = await db.table('teachers').where('user_id', user.id).first();
        else if (user.role === 'parent') req._profile = await db.table('parents').where('user_id', user.id).first();
        else req._profile = null;
        return req._profile;
      };
    } catch (e) { return next(e); }
    next();
  };
}

function wantsJson(req) { return req.xhr || (req.get('accept') || '').includes('application/json'); }

function requireAuth(req, res, next) {
  if (req.user) {
    const full = (req.baseUrl || '') + req.path; // req.path داخل روترهای mount‌شده نسبی است
    // هنگام «ورود به جای کاربر» اجبار تغییر رمز اعمال نمی‌شود (مدیر/سازنده رمز کاربر را نمی‌داند)
    if (req.user.must_change_password && !req.session.impersonatorId && !full.startsWith('/auth/password') && !full.startsWith('/auth/logout')) {
      return res.redirect('/auth/password?force=1');
    }
    return next();
  }
  if (wantsJson(req)) return res.status(401).json({ ok: false, error: 'ابتدا وارد شوید' });
  if (req.session) req.session.returnTo = req.originalUrl;
  return res.redirect('/auth/login');
}

function requireRole(...roles) {
  roles = roles.flat();
  return (req, res, next) => {
    if (!req.user) return requireAuth(req, res, next);
    if (roles.includes(req.user.role)) return next();
    if (wantsJson(req)) return res.status(403).json({ ok: false, error: 'دسترسی غیرمجاز' });
    res.status(403);
    return res.render('errors/403', { title: 'دسترسی غیرمجاز', message: 'شما مجوز دسترسی به این بخش را ندارید.' });
  };
}
const requireAdmin = requireRole('admin');
const requireStaff = requireRole('admin', 'teacher', 'staff');
/** دسترسی بر اساس مجوز (هر کدام از کلیدها کافی است)؛ مدیر همیشه مجاز است */
function requirePermission(...keys) {
  keys = keys.flat();
  return (req, res, next) => {
    if (!req.user) return requireAuth(req, res, next);
    if (permissions.can(req.user, ...keys)) return next();
    if (wantsJson(req)) return res.status(403).json({ ok: false, error: 'دسترسی غیرمجاز' });
    res.status(403);
    return res.render('errors/403', { title: 'دسترسی غیرمجاز', message: 'برای این بخش به مجوز «' + keys.map((k) => permissions.LABELS[k] || k).join('» یا «') + '» نیاز دارید.' });
  };
}
/** نقش‌های مجاز یا داشتن مجوز */
function requireRoleOrPermission(roles, ...keys) {
  roles = [].concat(roles); keys = keys.flat();
  return (req, res, next) => {
    if (!req.user) return requireAuth(req, res, next);
    if (roles.includes(req.user.role) || permissions.can(req.user, ...keys)) return next();
    if (wantsJson(req)) return res.status(403).json({ ok: false, error: 'دسترسی غیرمجاز' });
    res.status(403);
    return res.render('errors/403', { title: 'دسترسی غیرمجاز', message: 'شما مجوز دسترسی به این بخش را ندارید.' });
  };
}

function requireGuest(req, res, next) {
  if (req.user) return res.redirect(req.user.is_super ? '/console' : '/dashboard');
  next();
}

/** مدت اعتبار نشست کنسول سازنده (میلی‌ثانیه) */
function superSessionMs() { return Math.min(72, Math.max(1, settings.getInt('superadmin_session_hours', 12))) * 3600000; }
/** آیا کاربر جاری حساب سازنده با نشست کنسول معتبر است؟ */
function isSuper(req) { return !!(req.user && req.user.is_super && req.session && req.session.superAuth && !req.session.impersonatorId); }
/**
 * فقط حساب سازنده؛ برای بقیه پاسخ «۴۰۴» است (نه ۴۰۳) تا وجود کنسول/بخش‌های سازنده برای سایر کاربران آشکار نشود
 */
function requireSuper(req, res, next) {
  if (isSuper(req)) return next();
  if (!req.user) return requireAuth(req, res, next);
  if (wantsJson(req)) return res.status(404).json({ ok: false, error: 'یافت نشد' });
  res.status(404);
  return res.render('errors/404', { title: 'یافت نشد' });
}

/** ورود کاربر: بازسازی نشست برای جلوگیری از session fixation؛ keep: کلیدهایی از نشست قبلی که باید بمانند */
function login(req, user, remember, keep) {
  return new Promise((resolve, reject) => {
    const impersonatorId = req.session.impersonatorId;
    const superAuth = req.session.superAuth;
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = user.id;
      req.session.role = user.role;
      req.session.loginAt = Date.now();
      if (impersonatorId) req.session.impersonatorId = impersonatorId;
      if (superAuth) req.session.superAuth = superAuth;
      if (keep && typeof keep === 'object') Object.assign(req.session, keep);
      if (remember) req.session.cookie.maxAge = settings.getInt('session_days', 7) * 86400000;
      else req.session.cookie.expires = false;
      req.session.save((e) => (e ? reject(e) : resolve()));
    });
  });
}
function logout(req) {
  return new Promise((resolve) => { req.session.destroy(() => resolve()); });
}

async function authenticate(username, password) {
  username = String(username || '').trim().toLowerCase();
  const user = await db.table('users').whereRaw('LOWER(username) = ?', [username]).first();
  if (!user) return { ok: false, reason: 'notfound' };
  if (!(await verifyPassword(password, user.password))) return { ok: false, reason: 'password', user };
  if (user.status !== 'active') return { ok: false, reason: 'inactive', user };
  return { ok: true, user };
}

async function logLogin(req, user, username, success, kind) {
  try {
    await db.insert('login_logs', { user_id: user ? user.id : null, username: username || (user && user.username), ip: clientIp(req), user_agent: String(req.get('user-agent') || '').slice(0, 250), success: success ? 1 : 0, kind: kind || 'web', created_at: db.now() });
    if (success && user) await db.table('users').where('id', user.id).update({ last_login_at: db.now(), login_count: (user.login_count || 0) + 1 });
  } catch (e) { /* ignore */ }
}

module.exports = { isSuper, requireSuper, superSessionMs, hashPassword, verifyPassword, clientIp, isLocked, recordFailure, clearFailures, loadUser, requireAuth, requireRole, requireAdmin, requireStaff, requirePermission, requireRoleOrPermission, requireGuest, login, logout, authenticate, logLogin, wantsJson };
