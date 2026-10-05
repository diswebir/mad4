'use strict';
/**
 * پیکربندی برنامه
 * اولویت: متغیرهای محیطی (.env / cPanel) > storage/config.json (نوشته‌شده توسط ویزارد نصب) > مقادیر پیش‌فرض
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const STORAGE = path.join(ROOT, 'storage');
const CONFIG_FILE = path.join(STORAGE, 'config.json');
const LOCK_FILE = path.join(STORAGE, 'installed.lock');

try { require('dotenv').config({ path: path.join(ROOT, '.env') }); } catch (e) { /* ignore */ }

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return {}; }
}

function build() {
  const fileCfg = readJson(CONFIG_FILE);
  const env = process.env;
  const db = fileCfg.db || {};
  const cfg = {
    root: ROOT,
    storage: STORAGE,
    configFile: CONFIG_FILE,
    lockFile: LOCK_FILE,
    env: env.NODE_ENV || 'production',
    port: parseInt(env.PORT || fileCfg.port || 3000, 10),
    host: env.HOST || '0.0.0.0',
    baseUrl: env.APP_URL || fileCfg.baseUrl || '',
    appKey: env.APP_KEY || fileCfg.appKey || '',
    trustProxy: env.TRUST_PROXY !== undefined ? env.TRUST_PROXY !== 'false' : true,
    timezoneOffset: env.TZ_OFFSET || fileCfg.timezoneOffset || '+03:30',
    db: {
      client: env.DB_CLIENT || db.client || 'sqlite',
      filename: env.DB_FILENAME || db.filename || path.join(STORAGE, 'madrese.sqlite'),
      host: env.DB_HOST || db.host || '127.0.0.1',
      port: parseInt(env.DB_PORT || db.port || 3306, 10),
      user: env.DB_USER || db.user || '',
      password: env.DB_PASSWORD !== undefined ? env.DB_PASSWORD : (db.password || ''),
      database: env.DB_NAME || db.database || '',
      prefix: env.DB_PREFIX || db.prefix || ''
    },
    uploads: {
      dir: path.join(STORAGE, 'uploads'),
      maxSizeMb: parseInt(env.UPLOAD_MAX_MB || fileCfg.uploadMaxMb || 10, 10)
    },
    session: {
      name: 'madrese.sid',
      ttlDays: parseInt(env.SESSION_TTL_DAYS || 7, 10)
    },
    installed: fs.existsSync(LOCK_FILE) || env.APP_INSTALLED === 'true'
  };
  cfg.isDev = cfg.env === 'development';
  return cfg;
}

let current = build();

module.exports = {
  get() { return current; },
  reload() { current = build(); return current; },
  /** ذخیره تنظیمات نصب در storage/config.json */
  save(partial) {
    const existing = readJson(CONFIG_FILE);
    const merged = Object.assign({}, existing, partial);
    if (!merged.appKey) merged.appKey = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(STORAGE, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), { mode: 0o600 });
    return this.reload();
  },
  markInstalled() {
    fs.writeFileSync(LOCK_FILE, new Date().toISOString());
    return this.reload();
  },
  generateKey() { return crypto.randomBytes(32).toString('hex'); },
  ROOT, STORAGE, CONFIG_FILE, LOCK_FILE
};
