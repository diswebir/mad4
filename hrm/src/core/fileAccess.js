'use strict';
/**
 * مجوز دسترسی به فایل‌های بارگذاری‌شده (/files/*) بر اساس رکورد صاحب فایل
 *  - branding/*   : عمومی (لوگو)
 *  - avatars/*    : هر کاربر واردشده
 *  - applications/<appId>/* : متقاضیِ صاحب پرونده، یا کارکنان با مجوز applicants.view
 *  - employees/*  : کارکنان با مجوز employees.view یا خود کارمند
 *  - سایر پوشه‌ها : فقط مدیر ارشد و دارندگان settings.manage
 */
const db = require('./db');

function isPublic(rel) { return /^branding\//.test(rel); }

async function canAccess(req, rel) {
  const u = req.user;
  if (!u) return isPublic(rel);
  if (u.is_super) return true;
  const can = (...k) => (req.can ? req.can(...k) : false);
  if (isPublic(rel)) return true;
  if (/^avatars\//.test(rel)) return true;
  let m = /^applications\/(\d+)\//.exec(rel);
  if (m) {
    if (can('applicants.view')) return true;
    const app = await db.table('applications').where('id', Number(m[1])).first();
    return !!app && app.user_id === u.id;
  }
  m = /^employees\/(\d+)\//.exec(rel);
  if (m) {
    if (can('employees.view')) return true;
    const emp = await db.table('employees').where('id', Number(m[1])).first();
    return !!emp && emp.user_id === u.id;
  }
  if (/^backups\//.test(rel)) return can('backup.manage');
  return can('settings.manage');
}

module.exports = { isPublic, canAccess };
