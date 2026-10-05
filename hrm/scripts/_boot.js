'use strict';
/** راه‌اندازی پایگاه داده برای اسکریپت‌های خط فرمان (بدون وب‌سرور) */
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const config = require('../src/core/config');
const db = require('../src/core/db');
const schema = require('../database/schema');
const schemaSync = require('../src/core/db/schema');
const settings = require('../src/core/settings');
const modules = require('../src/core/modules');
const J = require('../src/core/jalali');

async function boot({ sync = true } = {}) {
  const cfg = config.reload();
  if (!cfg.installed) { console.error('سامانه هنوز نصب نشده است. ابتدا از طریق مرورگر ویزارد نصب را کامل کنید.'); process.exit(1); }
  await db.connect(cfg.db);
  if (sync) await schemaSync.sync(db, schema, (m) => console.log('  ' + m));
  await settings.load();
  J.setTimezoneOffset(settings.get('timezone_offset') || cfg.timezoneOffset);
  modules.loadManifests();
  await modules.loadStates();
  return { cfg, db, schema, schemaSync, settings, modules, J };
}
module.exports = { boot };
