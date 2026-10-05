'use strict';
/**
 * منطق مشترک نصب — هم ویزارد وب (/install) و هم خط فرمان (scripts/install.js) از این استفاده می‌کنند.
 * performInstall({ dbCfg, form, log }) → { adminId }
 */
const fs = require('fs');
const path = require('path');
const config = require('../core/config');
const db = require('../core/db');
const schema = require('../../database/schema');
const schemaSync = require('../core/db/schema');
const settings = require('../core/settings');
const modules = require('../core/modules');
const permissions = require('../core/permissions');
const auth = require('../core/auth');
const J = require('../core/jalali');
const pkg = require('../../package.json');

function validateForm(form) {
  const errors = [];
  if (!form.company_name) errors.push('نام شرکت الزامی است');
  if (!form.admin_name) errors.push('نام مدیر ارشد الزامی است');
  if (!form.admin_username || !/^[a-zA-Z0-9_.]{3,30}$/.test(form.admin_username)) errors.push('نام کاربری باید ۳ تا ۳۰ کاراکتر لاتین باشد');
  if (!form.admin_password || String(form.admin_password).length < 8) errors.push('رمز عبور مدیر ارشد باید حداقل ۸ کاراکتر باشد');
  if (form.admin_password2 !== undefined && form.admin_password !== form.admin_password2) errors.push('تکرار رمز عبور مطابقت ندارد');
  if (form.admin_mobile && !/^09\d{9}$/.test(require('../core/utils').normalizePhone(form.admin_mobile))) errors.push('شمارهٔ موبایل مدیر معتبر نیست');
  return errors;
}

function sqliteDefaultFile() { return path.join(config.get().storage, 'hrm.sqlite'); }

async function performInstall({ dbCfg, form, log }) {
  log = log || (() => {});
  const utils = require('../core/utils');
  // ۱) ذخیرهٔ پیکربندی
  config.save({ db: dbCfg, timezoneOffset: form.timezone_offset || '+03:30', appKey: config.generateKey(), installedVersion: pkg.version });
  try {
    // ۲) اتصال و ساخت جدول‌ها
    await db.connect(dbCfg);
    log('اتصال به پایگاه داده برقرار شد (' + db.info.driver + ')');
    await schemaSync.sync(db, schema, log);
    log('جدول‌ها ساخته شدند');
    // ۳) تنظیمات اولیه
    await settings.load();
    await settings.setMany({
      company_name: form.company_name, company_short_name: form.company_short_name || form.company_name, company_phone: form.company_phone || '', company_email: form.company_email || '',
      company_address: form.company_address || '', company_city: form.company_city || '', company_website: form.company_website || '', timezone_offset: form.timezone_offset || '+03:30',
      demo_mode: form.demo === '1' || form.demo === true ? '1' : '0', installed_at: J.nowISO(), app_version: pkg.version, app_updated_at: new Date().toISOString(),
      cron_token: utils.randomString(32)
    });
    J.setTimezoneOffset(settings.get('timezone_offset'));
    // ۴) نقش‌های پیش‌فرض
    await permissions.ensureDefaults();
    log('سطوح دسترسی پیش‌فرض ساخته شدند');
    // ۵) مدیر ارشد (super admin) — فقط یک بار در نصب تعیین می‌شود
    const now = db.now();
    let admin = await db.table('users').whereRaw('LOWER(username) = ?', [String(form.admin_username).toLowerCase()]).first();
    const adminData = { username: String(form.admin_username).toLowerCase(), password: await auth.hashPassword(form.admin_password), role: 'super', is_super: 1, name: form.admin_name, email: form.admin_email || null, mobile: form.admin_mobile ? utils.normalizePhone(form.admin_mobile) : null, status: 'active', updated_at: now };
    let adminId;
    if (admin) { await db.update('users', adminData, { id: admin.id }); adminId = admin.id; } else { adminId = await db.insert('users', Object.assign({ created_at: now }, adminData)); }
    log('حساب مدیر ارشد ساخته شد: ' + form.admin_username);
    // ۶) ماژول‌ها و داده‌های پایه
    modules.loadManifests();
    await modules.loadStates();
    for (const mod of modules.modules) { if (typeof mod.ensureDefaults === 'function') await mod.ensureDefaults(log); }
    // ۷) دادهٔ نمونه (اختیاری)
    if (form.demo === '1' || form.demo === true) {
      const seeder = require('../../database/seeds/demo');
      await seeder.run({ log, adminId });
      log('داده‌های نمونه ساخته شدند');
    }
    // ۸) پوشه‌ها و قفل نصب
    for (const d of ['uploads', 'backups', 'logs', 'tmp']) fs.mkdirSync(path.join(config.get().storage, d), { recursive: true });
    try { await db.insert('activity_logs', { user_id: adminId, action: 'install', entity: 'system', description: 'نصب سامانه نسخهٔ ' + pkg.version, created_at: now }); } catch (e) { /* ignore */ }
    config.markInstalled();
    return { adminId };
  } catch (e) {
    try { fs.unlinkSync(config.get().configFile); } catch (e2) { /* ignore */ }
    config.reload();
    throw e;
  }
}

/** پیش‌نیازها برای صفحهٔ اول ویزارد */
function requirements() {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  const storage = config.get().storage;
  let writable = false;
  try { fs.mkdirSync(storage, { recursive: true }); fs.accessSync(storage, fs.constants.W_OK); writable = true; } catch (e) { writable = false; }
  let sqlite = 'none';
  try { require('node:sqlite'); sqlite = 'node:sqlite'; } catch (e) { try { require.resolve('sql.js'); sqlite = 'sql.js'; } catch (e2) { sqlite = 'none'; } }
  let mysql = false; try { require.resolve('mysql2'); mysql = true; } catch (e) { mysql = false; }
  return { node: process.versions.node, nodeOk: major >= 18, storage, writable, sqlite, mysql, ok: major >= 18 && writable && (sqlite !== 'none' || mysql) };
}

module.exports = { validateForm, performInstall, requirements, sqliteDefaultFile };
