'use strict';
/**
 * احراز هویت، نقش‌ها و محدودیت تلاش ورود
 */
const bcrypt = require('bcryptjs');
const db = require('./db');
const settings = require('./settings');

const attempts = new Map(); // key: ip|username → { count, lockedUntil }

async function hashPassword(plain) { return bcrypt.hash(String(plain), 10); }
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

/** بارگذاری کاربر جاری از نشست */
function loadUser() {
  return async (req, res, next) => {
    req.user = null;
    res.locals.currentUser = null;
    res.locals.impersonator = null;
    if (!req.session || !req.session.userId) return next();
    try {
      const user = await db.table('users').where('id', req.session.userId).first();
      if (!user || user.status !== 'active') { req.session.userId = null; return next(); }
      delete user.password;
      req.user = user;
      res.locals.currentUser = user;
      if (req.session.impersonatorId) res.locals.impersonator = await db.table('users').select('id', 'name', 'role').where('id', req.session.impersonatorId).first();
      // پروفایل دانش‌آموز/معلم (در صورت نیاز)
      req.profile = async () => {
        if (req._profile !== undefined) return req._profile;
        if (user.role === 'student') req._profile = await db.table('students').where('user_id', user.id).first();
        else if (user.role === 'teacher') req._profile = await db.table('teachers').where('user_id', user.id).first();
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
    if (req.user.must_change_password && !req.path.startsWith('/auth/password') && !req.path.startsWith('/auth/logout')) {
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

function requireGuest(req, res, next) {
  if (req.user) return res.redirect('/dashboard');
  next();
}

/** ورود کاربر: بازسازی نشست برای جلوگیری از session fixation */
function login(req, user, remember) {
  return new Promise((resolve, reject) => {
    const impersonatorId = req.session.impersonatorId;
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = user.id;
      req.session.role = user.role;
      req.session.loginAt = Date.now();
      if (impersonatorId) req.session.impersonatorId = impersonatorId;
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

async function logLogin(req, user, username, success) {
  try {
    await db.insert('login_logs', { user_id: user ? user.id : null, username: username || (user && user.username), ip: clientIp(req), user_agent: String(req.get('user-agent') || '').slice(0, 250), success: success ? 1 : 0, created_at: db.now() });
    if (success && user) await db.table('users').where('id', user.id).update({ last_login_at: db.now(), login_count: (user.login_count || 0) + 1 });
  } catch (e) { /* ignore */ }
}

module.exports = { hashPassword, verifyPassword, clientIp, isLocked, recordFailure, clearFailures, loadUser, requireAuth, requireRole, requireAdmin, requireStaff, requireGuest, login, logout, authenticate, logLogin, wantsJson };
