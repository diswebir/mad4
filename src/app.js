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
const csrf = require('./core/csrf');
const flash = require('./core/flash');
const DbSessionStore = require('./core/session-store');
const pkg = require('../package.json');

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
  scheduler.start();
  return { installed: true };
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
  app.get('/healthz', (req, res) => res.json({ ok: true, installed: config.get().installed, db: db.info ? db.info.driver : null, version: pkg.version, uptime: Math.round(process.uptime()) }));

  // پیش از نصب: فقط ویزارد نصب در دسترس است
  const installer = require('./installer/routes');
  app.use((req, res, next) => {
    res.locals.appVersion = pkg.version;
    res.locals.J = J;
    res.locals.utils = utils;
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

  // نشست
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

  // داده‌های مشترک قالب
  app.use(async (req, res, next) => {
    res.locals.menu = req.user ? modules.menuFor(req.user) : [];
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
  app.get('/', (req, res) => res.redirect(req.user ? '/dashboard' : '/auth/login'));

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
  // فایل‌های بارگذاری‌شده (فقط برای کاربران واردشده)
  // فایل‌های بارگذاری‌شده: فقط برای کاربران واردشده (به‌جز لوگوی مدرسه که در صفحات عمومی نمایش داده می‌شود)
  const publicFile = (req, res, next) => { const rel = Array.isArray(req.params.rel) ? req.params.rel.join('/') : String(req.params.rel || ''); if (rel && rel === settings.get('school_logo')) return next(); return auth.requireAuth(req, res, next); };
  app.get('/files/{*rel}', publicFile, (req, res) => {
    const rel = Array.isArray(req.params.rel) ? req.params.rel.join('/') : String(req.params.rel || '');
    const safe = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, '');
    const file = path.join(config.get().uploads.dir, safe);
    if (!file.startsWith(config.get().uploads.dir) || !fs.existsSync(file)) return res.status(404).render('errors/404', { title: 'فایل یافت نشد' });
    res.sendFile(file, { maxAge: '1d', headers: { 'Content-Disposition': req.query.dl ? 'attachment' : 'inline' } });
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
    if (status >= 500) console.error('[error]', err);
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'حجم فایل بیش از حد مجاز است' : (status < 500 || config.get().isDev ? err.message : 'خطای داخلی سرور');
    res.status(status);
    if (auth.wantsJson(req)) return res.json({ ok: false, error: message });
    if (req.method === 'POST' && status < 500 && req.flash) { req.flash('danger', message); return res.redirect(req.get('referer') || '/'); }
    try { res.render('errors/500', { title: 'خطا', message, stack: config.get().isDev ? err.stack : null }); } catch (e) { res.send(message); }
  });

  return app;
}

module.exports = { createApp, boot };
