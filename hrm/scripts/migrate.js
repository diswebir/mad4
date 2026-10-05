#!/usr/bin/env node
'use strict';
/** همگام‌سازی ساختار جدول‌ها با database/schema.js (ایجاد جدول/ستون‌های جدید):  node scripts/migrate.js */
const { boot } = require('./_boot');
(async () => { const { db } = await boot({ sync: true }); console.log('ساختار پایگاه داده به‌روز است.'); await db.close(); })().catch((e) => { console.error(e); process.exit(1); });
