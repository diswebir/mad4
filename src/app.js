'use strict';
/**
 * ساخت برنامهٔ Express — هسته سامانهٔ مدیریت مدرسه
 */
const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const compression = require('compression');
const expressLayouts = require('express-ejs-layouts');

const config = require('./core/config');
const db = require('./core/db');
const schema = require('../database/schema');
const schemaSync = require('./core/db/schema');
const settings = require('./core/settings');
const modules = require('./core/modules');
const permissions = require('./core/permissions');
const scheduler = require('./core/scheduler');
const auth = require('./core/auth');
const J = require('./core/jalali');
const utils = require('./core/utils');
const barcode = require('./core/barcode');
const csrf = require('./core/csrf');
const flash = require('./core/flash');
const DbSessionStore = require('./core/session-store');
const pkg = require('../package.json');
const logger = require('./core/logger');
const maintenance = require('./core/maintenance');
const health = require('./core/health');
const updater = require('./core/updater');

const ROOT = config.ROOT;

/** راه‌اندازی اتصال پایگاه داده و بارگذاری تنظیمات (در صورت نصب‌بودن) */
async function boot(log) {
  const cfg = config.reload();
  modules.loadManifests();
  if (!cfg.installed) return { installed: false };
  await db.connect(cfg.db);
  await schemaSync.sync(db, schema, log);
  await settings.load();
  J.setTimezoneOffset(settings.get('timezone_offset') || cfg.timezoneOffset);
  await modules.loadStates();
  await permissions.ensureDefaults();
  permissions.reload();
  await noteVersion(log);
  scheduler.start();
  return { installed: true };
}

/** ثبت نسخهٔ در حال اجرا؛ اگر فایل‌ها به نسخهٔ جدیدی جایگزین شده باشند، رخداد «به‌روزرسانی» ثبت و اعلان یک‌بارهٔ مدیر فعال می‌شود */
async function noteVersion(log) {
  try {
    const prev = settings.get('app_version', '');
    if (prev === pkg.version) return;
    await settings.setMany({ app_version: pkg.version, app_updated_at: new Date().toISOString() });
    if (prev) {
      updater.writeState({ prevVersion: prev, upgradedAt: new Date().toISOString(), lastVersion: pkg.version });
      try { await db.insert('activity_logs', { user_id: null, action: 'update', entity: 'system', entity_id: null, description: `به‌روزرسانی سامانه از نسخهٔ ${prev} به نسخهٔ ${pkg.version}`, ip: null, created_at: db.now() }); } catch (e) { /* ignore */ }
      if (log) log(`نسخهٔ برنامه از ${prev} به ${pkg.version} به‌روز شد`);
    }
  } catch (e) { /* ignore */ }
}

function createApp() {
  const app = express();
  const cfg = config.get();
  app.locals.booted = false;

  app.set('trust proxy', cfg.trustProxy ? 1 : false);
  app.set('view engine', 'ejs');
  app.set('views', [path.join(ROOT, 'src', 'views')]);
  app.set('view cache', !cfg.isDev);
  app.set('x-powered-by', false);
  app.set('query parser', 'extended');
  app.use(expressLayouts);
  app.set('layout', 'layouts/main');
  app.set('layout extractScripts', true);
  app.set('layout extractStyles', true);

  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: false
  }));
  app.use(compression({ threshold: 1024 }));

  const staticOpts = { maxAge: cfg.isDev ? 0 : '7d', etag: true, index: false, immutable: !cfg.isDev };
  app.use('/assets', express.static(path.join(ROOT, 'public'), staticOpts));
  app.use('/favicon.ico', express.static(path.join(ROOT, 'public', 'img', 'favicon.svg'), staticOpts));

  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(express.json({ limit: '1mb' }));

  // سلامت سرویس
  // اجرای کارهای زمان‌بندی‌شده توسط cron بیرونی: GET /cron?token=...
  app.get('/cron', async (req, res) => {
    if (!config.get().installed) return res.status(503).json({ ok: false });
    const token = settings.get('cron_token');
    if (!token || String(req.query.token || '') !== token) return res.status(403).json({ ok: false, error: 'توکن نامعتبر' });
    const results = await scheduler.runDue('cron');
    res.json({ ok: true, ran: results.length, results: results.map((r) => ({ key: r.key, status: r.status || (r.skipped ? 'skipped' : 'unknown'), message: r.message })) });
  });
  app.get('/healthz', (req, res) => res.json({ ok: true, installed: config.get().installed, db: db.info ? db.info.driver : null, version: pkg.version, uptime: Math.round(process.uptime()), maintenance: config.get().installed ? maintenance.isOn() : false }));

  // پیش از نصب: فقط ویزارد نصب در دسترس است
  const installer = require('./installer/routes');
  app.use((req, res, next) => {
    res.locals.appVersion = pkg.version + '.' + ['css/app.css', 'js/app.js'].map((f) => { try { return Math.floor(fs.statSync(path.join(ROOT, 'public', f)).mtimeMs); } catch (e) { return 0; } }).join('-');
    res.locals.pkgVersion = pkg.version;
    res.locals.J = J;
    res.locals.utils = utils;
    res.locals.barcode = barcode;
    res.locals.e = utils.escapeHtml;
    res.locals.installed = config.get().installed;
    res.locals.currentPath = req.path;
    res.locals.query = req.query;
    res.locals.body = {};
    res.locals.S = settings;
    res.locals.school = (k) => settings.get(k);
    res.locals.enabled = (k) => modules.isEnabled(k);
    res.locals.title = '';
    res.locals.layout = 'layouts/main';
    next();
  });
  app.use('/install', installer);
  app.use((req, res, next) => {
    if (config.get().installed && db.isReady()) return next();
    if (req.path.startsWith('/assets')) return next();
    return res.redirect('/install');
  });

  // PWA: مانیفست، آیکون، سرویس‌ورکر و صفحهٔ آفلاین (بدون نیاز به نشست)
  app.use(require('./core/pwa').router());

  // نشست (به‌صورت تنبل ساخته می‌شود تا کلید برنامه پس از نصب در دسترس باشد)
  let sessionMiddleware = null;
  let sessionKey = null;
  const sessionStore = new DbSessionStore({ ttlMs: cfg.session.ttlDays * 86400000 });
  app.use((req, res, next) => {
    const key = config.get().appKey;
    if (!sessionMiddleware || sessionKey !== key) {
      sessionKey = key;
      sessionMiddleware = session({
        name: cfg.session.name, secret: key || 'madrese-temp-key', resave: false, saveUninitialized: false, rolling: true, store: sessionStore,
        cookie: { httpOnly: true, sameSite: 'lax', secure: 'auto', maxAge: cfg.session.ttlDays * 86400000 }
      });
    }
    sessionMiddleware(req, res, next);
  });
  app.use(flash());
  app.use(auth.loadUser());
  // حالت تعمیر و نگهداری: غیرمدیران صفحهٔ ۵۰۳ می‌بینند (src/core/maintenance.js)
  app.use(maintenance.middleware());

  // داده‌های مشترک قالب
  app.use(async (req, res, next) => {
    res.locals.menu = req.user ? modules.menuFor(req.user, { superSession: auth.isSuper(req) }) : [];
    res.locals.diskWarning = null;
    res.locals.updatedFrom = null;
    res.locals.badgeReports = 0; res.locals.badgeRequests = 0;
    if (auth.isSuper(req)) {
      try {
        res.locals.badgeReports = await db.table('support_reports').where('status', 'new').where('kind', '!=', 'module_request').count();
        res.locals.badgeRequests = await db.table('support_reports').where('status', 'new').where('kind', 'module_request').count();
      } catch (e) { /* ignore */ }
    }
    if (req.user && req.user.role === 'admin') {
      if (modules.isEnabled('system.disk_alert')) { try { const h = await health.cached(); if (h && h.level !== 'ok') res.locals.diskWarning = h; } catch (e) { /* ignore */ } }
      if (modules.isEnabled('system.updates') && auth.isSuper(req)) { const n = updater.notice(); if (n && req.session && req.session.updateSeen !== pkg.version) res.locals.updatedFrom = n.prevVersion; }
    }
    res.locals.theme = (req.user && req.user.theme) || (req.session && req.session.theme) || settings.get('default_theme') || 'light';
    res.locals.unreadNotifications = 0;
    res.locals.unreadMessages = 0;
    res.locals.badgeTickets = 0;
    if (req.user) {
      try {
        if (modules.isEnabled('notifications.inapp')) res.locals.unreadNotifications = await db.count('notifications', { user_id: req.user.id, is_read: 0 });
        if (modules.isEnabled('messages')) res.locals.unreadMessages = await db.count('messages', { receiver_id: req.user.id, is_read: 0, deleted_by_receiver: 0 });
        if (modules.isEnabled('tickets')) {
          const tq = db.table('tickets');
          if (req.user.role === 'student') tq.where('created_by', req.user.id).where('status', 'answered');
          else if (req.user.role === 'teacher') tq.where('assigned_to', req.user.id).where('status', 'open');
          else tq.where('status', 'open').where((b) => b.where('assigned_to', req.user.id).orWhereNull('assigned_to'));
          res.locals.badgeTickets = await tq.count();
        }
      } catch (e) { /* ignore */ }
    }
    next();
  });
  // بررسی CSRF پس از آماده‌شدن داده‌های قالب تا صفحهٔ خطا کامل رندر شود
  app.use(csrf());

  // مسیرهای احراز هویت و داشبورد
  app.use('/auth', require('./auth/routes'));
  // کنسول سازنده (super admin) — بخش هسته؛ خارج از نظام ماژول‌ها تا قابل خاموش‌کردن نباشد
  app.use('/console', require('./console/routes'));
  app.get('/', (req, res) => res.redirect(req.user ? (auth.isSuper(req) ? '/console' : '/dashboard') : '/auth/login'));

  // ماژول‌ها
  for (const mod of modules.loadManifests()) {
    if (!mod.routes) continue;
    const wrapper = express.Router();
    wrapper.use(modules.requireEnabled(mod.key));
    wrapper.use((req, res, next) => { res.locals.activeModule = mod.key; next(); });
    wrapper.use(mod.routes);
    app.use(mod.mount || '/' + mod.key, wrapper);
  }

  // نشانی‌های کوتاه عمومی برای پیش‌ثبت‌نام
  app.get('/apply', (req, res) => res.redirect('/admissions/apply'));
  app.get('/apply/track', (req, res) => res.redirect('/admissions/track' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '')));
  // فایل‌های بارگذاری‌شده: مجوز بر اساس رکورد صاحب فایل (src/core/fileAccess.js)؛ لوگوی مدرسه عمومی است
  const fileAccess = require('./core/fileAccess');
  const relOf = (req) => { const rel = Array.isArray(req.params.rel) ? req.params.rel.join('/') : String(req.params.rel || ''); return path.posix.normalize(rel).replace(/^(\.\.(\/|$))+/, '').replace(/^\/+/, ''); };
  const fileGuard = (req, res, next) => { if (fileAccess.isPublic(relOf(req))) return next(); return auth.requireAuth(req, res, next); };
  app.get('/files/{*rel}', fileGuard, async (req, res) => {
    const rel = relOf(req);
    const file = path.join(config.get().uploads.dir, rel);
    if (!rel || rel.includes('\0') || !file.startsWith(config.get().uploads.dir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.status(404).render('errors/404', { title: 'فایل یافت نشد' });
    if (!(await fileAccess.canAccess(req, rel))) {
      res.status(403);
      if (auth.wantsJson(req)) return res.json({ ok: false, error: 'دسترسی به این فایل مجاز نیست' });
      return res.render('errors/403', { title: 'دسترسی غیرمجاز' });
    }
    res.sendFile(file, { maxAge: fileAccess.isPublic(rel) ? '1d' : 0, headers: Object.assign({ 'Content-Disposition': req.query.dl ? 'attachment' : 'inline', 'X-Content-Type-Options': 'nosniff' }, fileAccess.isPublic(rel) ? {} : { 'Cache-Control': 'private, max-age=300' }) });
  });

  // ۴۰۴
  app.use((req, res) => {
    res.status(404);
    if (auth.wantsJson(req)) return res.json({ ok: false, error: 'یافت نشد' });
    res.render('errors/404', { title: 'صفحه یافت نشد' });
  });

  // خطای عمومی
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status || err.statusCode || 500;
    if (status >= 500) { console.error('[error]', err); logger.error('HTTP 500', err, req, { status }); }
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'حجم فایل بیش از حد مجاز است' : (status < 500 || config.get().isDev ? err.message : 'خطای داخلی سرور');
    res.status(status);
    if (auth.wantsJson(req)) return res.json({ ok: false, error: message });
    if (req.method === 'POST' && status < 500 && req.flash) { req.flash('danger', message); return res.redirect(req.get('referer') || '/'); }
    try { res.render('errors/500', { title: 'خطا', message, stack: config.get().isDev ? err.stack : null }); } catch (e) { res.send(message); }
  });

  return app;
}

module.exports = { createApp, boot };
