'use strict';
/**
 * ویزارد نصب وب — /install
 * مراحل: ۱) بررسی پیش‌نیازها ۲) پایگاه داده ۳) شرکت و مدیر ارشد ۴) پایان
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const config = require('../core/config');
const db = require('../core/db');
const schema = require('../../database/schema');
const schemaSync = require('../core/db/schema');
const settings = require('../core/settings');
const modules = require('../core/modules');
const J = require('../core/jalali');
const pkg = require('../../package.json');
const utils = require('../core/utils');
const installer = require('./install');

const router = express.Router();
const v = (n) => path.join(__dirname, 'views', n + '.ejs');

router.use((req, res, next) => {
  res.locals.layout = 'layouts/install';
  res.locals.step = 0;
  res.locals.cfg = config.get();
  next();
});

function writable(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, '.write-test'); fs.writeFileSync(f, 'ok'); fs.unlinkSync(f); return true; } catch (e) { return false; }
}

function requirements() {
  const cfg = config.get();
  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  const sqliteDrivers = db.detectSqliteDrivers();
  return [
    { label: 'نسخهٔ Node.js (حداقل ۱۸)', value: 'v' + process.versions.node, ok: nodeMajor >= 18, critical: true },
    { label: 'قابلیت نوشتن در پوشهٔ storage/', value: cfg.storage, ok: writable(cfg.storage), critical: true },
    { label: 'قابلیت نوشتن در پوشهٔ storage/uploads/', value: 'بارگذاری فایل‌ها', ok: writable(cfg.uploads.dir), critical: true },
    { label: 'درایور MySQL (mysql2)', value: db.mysqlAvailable() ? 'نصب است' : 'نصب نیست', ok: db.mysqlAvailable(), critical: false },
    { label: 'درایور SQLite', value: sqliteDrivers.length ? sqliteDrivers.join(' ، ') : 'هیچ', ok: sqliteDrivers.length > 0, critical: false },
    { label: 'حافظهٔ آزاد سیستم', value: Math.round(os.freemem() / 1048576) + ' MB', ok: os.freemem() > 64 * 1048576, critical: false },
    { label: 'پوشهٔ ماژول‌ها', value: modules.loadManifests().length + ' ماژول', ok: modules.loadManifests().length > 0, critical: true }
  ];
}

function guardNotInstalled(req, res, next) {
  const cfg = config.get();
  if (cfg.installed && db.isReady()) return res.redirect('/');
  if (cfg.installed && !db.isReady()) return res.redirect('/install/recover');
  next();
}

router.get('/', guardNotInstalled, (req, res) => {
  const reqs = requirements();
  res.render(v('welcome'), { title: 'نصب سامانه', step: 1, reqs, canContinue: reqs.filter((r) => r.critical).every((r) => r.ok) && (db.mysqlAvailable() || db.detectSqliteDrivers().length), version: pkg.version });
});

router.get('/database', guardNotInstalled, (req, res) => {
  res.render(v('database'), { title: 'پایگاه داده', step: 2, sqliteDrivers: db.detectSqliteDrivers(), mysql: db.mysqlAvailable(), form: req.query, error: null });
});

function dbConfigFromBody(body) {
  const client = body.db_client === 'mysql' ? 'mysql' : 'sqlite';
  const cfg = config.get();
  return {
    client,
    filename: path.join(cfg.storage, 'hrm.sqlite'),
    host: String(body.db_host || '127.0.0.1').trim(),
    port: parseInt(body.db_port || 3306, 10) || 3306,
    user: String(body.db_user || '').trim(),
    password: String(body.db_password || ''),
    database: String(body.db_name || '').trim()
  };
}

router.post('/database', guardNotInstalled, async (req, res) => {
  const dbCfg = dbConfigFromBody(req.body);
  try {
    if (dbCfg.client === 'mysql' && (!dbCfg.user || !dbCfg.database)) throw new Error('نام پایگاه داده و نام کاربری الزامی است');
    const t = await db.test(dbCfg);
    res.render(v('company'), { title: 'اطلاعات شرکت و مدیر ارشد', step: 3, dbCfg, driver: t.driver, form: {}, error: null });
  } catch (e) {
    res.render(v('database'), { title: 'پایگاه داده', step: 2, sqliteDrivers: db.detectSqliteDrivers(), mysql: db.mysqlAvailable(), form: req.body, error: 'اتصال برقرار نشد: ' + e.message });
  }
});

router.post('/run', guardNotInstalled, async (req, res) => {
  const body = req.body;
  const dbCfg = dbConfigFromBody(body);
  const form = utils.cleanBody(body, { fields: ['company_name', 'company_short_name', 'company_phone', 'company_email', 'company_address', 'company_city', 'company_website', 'admin_name', 'admin_username', 'admin_password', 'admin_password2', 'admin_email', 'admin_mobile', 'timezone_offset', 'demo'] });
  const errors = installer.validateForm(form);
  if (errors.length) {
    return res.render(v('company'), { title: 'اطلاعات شرکت و مدیر ارشد', step: 3, dbCfg, driver: '', form: body, error: errors.join('؛ ') });
  }
  const logLines = [];
  try {
    await installer.performInstall({ dbCfg, form, log: (m) => logLines.push(m) });
    res.render(v('done'), { title: 'نصب کامل شد', step: 4, log: logLines, form, demo: form.demo === '1', dbInfo: db.info });
  } catch (e) {
    console.error('[install]', e);
    res.render(v('company'), { title: 'اطلاعات شرکت و مدیر ارشد', step: 3, dbCfg, driver: '', form: body, error: 'خطا در نصب: ' + e.message + (logLines.length ? ' | مراحل انجام‌شده: ' + logLines.join('، ') : '') });
  }
});

/** بازیابی اتصال پایگاه داده پس از نصب (در صورت خرابی تنظیمات) */
router.get('/recover', (req, res) => {
  const cfg = config.get();
  if (!cfg.installed) return res.redirect('/install');
  if (db.isReady()) return res.redirect('/');
  res.render(v('recover'), { title: 'بازیابی اتصال پایگاه داده', step: 0, form: cfg.db, error: req.query.error || null, bootError: req.app.locals.bootError ? req.app.locals.bootError.message : null, sqliteDrivers: db.detectSqliteDrivers(), mysql: db.mysqlAvailable() });
});
router.post('/recover', async (req, res) => {
  const cfg = config.get();
  if (!cfg.installed || db.isReady()) return res.redirect('/');
  const key = String(req.body.recovery_key || '').trim();
  if (!cfg.appKey || key !== cfg.appKey.slice(0, 12)) return res.redirect('/install/recover?error=' + encodeURIComponent('کلید بازیابی نادرست است'));
  const dbCfg = dbConfigFromBody(req.body);
  try {
    await db.test(dbCfg);
    config.save({ db: dbCfg });
    await db.connect(dbCfg);
    await schemaSync.sync(db, schema);
    await settings.load();
    await modules.loadStates();
    req.app.locals.bootError = null;
    res.redirect('/');
  } catch (e) { res.redirect('/install/recover?error=' + encodeURIComponent(e.message)); }
});

module.exports = router;
