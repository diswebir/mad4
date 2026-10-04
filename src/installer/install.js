'use strict';
/**
 * منطق مشترک نصب — هم ویزارد وب (/install) و هم خط فرمان (scripts/install.js) از این استفاده می‌کنند.
 * performInstall({ dbCfg, form, log }) → { adminId, yearId }
 */
const fs = require('fs');
const path = require('path');
const config = require('../core/config');
const db = require('../core/db');
const schema = require('../../database/schema');
const schemaSync = require('../core/db/schema');
const settings = require('../core/settings');
const modules = require('../core/modules');
const auth = require('../core/auth');
const J = require('../core/jalali');
const pkg = require('../../package.json');

function validateForm(form) {
  const errors = [];
  if (!form.school_name) errors.push('نام مدرسه الزامی است');
  if (!form.admin_name) errors.push('نام مدیر الزامی است');
  if (!form.admin_username || !/^[a-zA-Z0-9_.]{3,30}$/.test(form.admin_username)) errors.push('نام کاربری باید ۳ تا ۳۰ کاراکتر لاتین باشد');
  if (!form.admin_password || String(form.admin_password).length < 6) errors.push('رمز عبور باید حداقل ۶ کاراکتر باشد');
  if (form.admin_password2 !== undefined && form.admin_password !== form.admin_password2) errors.push('تکرار رمز عبور مطابقت ندارد');
  return errors;
}

function sqliteDefaultFile() { return path.join(config.get().storage, 'madrese.sqlite'); }

async function performInstall({ dbCfg, form, log }) {
  log = log || (() => {});
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
      school_name: form.school_name, school_type: form.school_type || 'متوسطه اول', school_gender: form.school_gender || 'mixed',
      school_phone: form.school_phone || '', school_address: form.school_address || '', principal_name: form.admin_name, timezone_offset: form.timezone_offset || '+03:30',
      demo_mode: form.demo === '1' || form.demo === true ? '1' : '0', installed_at: J.nowISO(), app_version: pkg.version, app_updated_at: new Date().toISOString()
    });
    J.setTimezoneOffset(settings.get('timezone_offset'));
    // ۴) سال تحصیلی جاری
    const ay = J.currentAcademicYear();
    let yearId = (await db.findOne('academic_years', { is_current: 1 }) || {}).id;
    if (!yearId) {
      yearId = await db.insert('academic_years', { title: ay.title, start_date: ay.startDate, end_date: ay.endDate, is_current: 1, created_at: db.now() });
      await db.insert('terms', [
        { academic_year_id: yearId, title: 'نوبت اول', number: 1, start_date: ay.startDate, end_date: J.toGregorian(`${ay.startYear}/10/30`), is_current: 1, created_at: db.now() },
        { academic_year_id: yearId, title: 'نوبت دوم', number: 2, start_date: J.toGregorian(`${ay.startYear}/11/01`), end_date: ay.endDate, is_current: 0, created_at: db.now() }
      ]);
      log('سال تحصیلی ' + ay.title + ' ایجاد شد');
    }
    // ۵) حساب مدیر
    const existing = await db.findOne('users', { username: form.admin_username });
    const adminData = { password: await auth.hashPassword(form.admin_password), role: 'admin', name: form.admin_name, email: form.admin_email || null, phone: form.admin_phone || null, status: 'active', updated_at: db.now() };
    let adminId;
    if (existing) { await db.update('users', adminData, { id: existing.id }); adminId = existing.id; }
    else adminId = await db.insert('users', Object.assign({ username: form.admin_username, created_at: db.now() }, adminData));
    log('حساب مدیر ایجاد شد');
    // ۶) دادهٔ نمونه
    await modules.loadStates();
    if (form.demo === '1' || form.demo === true) {
      const seeder = require('../../database/seeds/demo');
      await seeder.run({ db, log, adminId, yearId, adminUsername: form.admin_username });
      log('دادهٔ نمونه بارگذاری شد');
    }
    // ۷) قفل نصب
    config.markInstalled();
    try { fs.writeFileSync(path.join(config.ROOT, 'tmp', 'restart.txt'), String(Date.now())); } catch (e) { /* ignore */ }
    await db.insert('activity_logs', { user_id: adminId, action: 'install', entity: 'system', description: 'نصب سامانه نسخه ' + pkg.version, created_at: db.now() });
    return { adminId, yearId };
  } catch (e) {
    try { fs.unlinkSync(config.LOCK_FILE); } catch (err) { /* ignore */ }
    try { await db.close(); } catch (err) { /* ignore */ }
    config.reload();
    throw e;
  }
}

module.exports = { performInstall, validateForm, sqliteDefaultFile };
