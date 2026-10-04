'use strict';
/** ثبت فعالیت کاربران (گزارش رخدادها) */
const db = require('./db');
const auth = require('./auth');

async function log(req, action, entity, entityId, description) {
  try {
    await db.insert('activity_logs', {
      user_id: req && req.user ? req.user.id : null, action, entity: entity || null, entity_id: entityId || null,
      description: description ? String(description).slice(0, 250) : null, ip: req ? auth.clientIp(req) : null,
      impersonator_id: req && req.session && req.session.impersonatorId ? req.session.impersonatorId : null, created_at: db.now()
    });
  } catch (e) { /* ignore */ }
}
const ACTIONS = { create: 'ایجاد', update: 'ویرایش', delete: 'حذف', login: 'ورود', logout: 'خروج', import: 'ورود گروهی', export: 'خروجی', toggle: 'تغییر وضعیت', impersonate: 'ورود به جای کاربر', backup: 'پشتیبان‌گیری', settings: 'تنظیمات', password: 'تغییر رمز', install: 'نصب' };
module.exports = { log, ACTIONS };
