'use strict';
/**
 * اعلان‌ها: درون‌برنامه‌ای (جدول notifications) + پیامک (src/core/sms.js)
 */
const db = require('./db');
const settings = require('./settings');
const modules = require('./modules');
const permissions = require('./permissions');
const sms = require('./sms');

async function push(userIds, { title, body, link, type }) {
  if (!modules.isEnabled('notifications.inapp')) return 0;
  const ids = [...new Set((Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean))];
  if (!ids.length) return 0;
  const now = db.now();
  await db.insert('notifications', ids.map((user_id) => ({ user_id, title: String(title).slice(0, 200), body: body || null, link: link || null, type: type || 'info', is_read: 0, created_at: now })));
  return ids.length;
}
/** اعلان به همهٔ کاربران فعال یک یا چند نقش پایه */
async function pushRole(role, payload) {
  const roles = [].concat(role);
  const ids = await db.table('users').where('status', 'active').whereIn('role', roles).pluck('id');
  return push(ids, payload);
}
/** اعلان به کاربرانی که مجوز مشخصی دارند (مثلاً applicants.view) — برای اطلاع‌رسانی پروندهٔ جدید به تیم منابع انسانی */
async function pushPermission(permKey, payload) {
  const users = await db.table('users').where('status', 'active').whereNotIn('role', ['applicant']).all();
  const ids = [];
  for (const u of users) { u.perms = await permissions.permissionsOf(u); if (permissions.can(u, permKey)) ids.push(u.id); }
  return push(ids, payload);
}
async function unreadCount(userId) { return db.count('notifications', { user_id: userId, is_read: 0 }); }

/** پیامک با قالب تنظیمات: key مثل sms_template_status؛ vars متغیرهای {name} … */
async function smsTemplate(mobile, key, vars, opts) {
  if (!modules.isEnabled('notifications.sms')) return { ok: false, skipped: true };
  const text = sms.template(settings.get(key), Object.assign({ company: settings.get('company_short_name') || settings.get('company_name') }, vars || {}));
  return sms.send(mobile, text, Object.assign({ kind: key.replace('sms_template_', '') }, opts || {}));
}

module.exports = { push, pushRole, pushPermission, unreadCount, smsTemplate, sms: sms.send, template: sms.template };
