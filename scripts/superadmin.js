#!/usr/bin/env node
'use strict';
/**
 * مدیریت حساب سازنده (super admin) از خط فرمان — تنها راه ساخت/حذف این حساب
 *   node scripts/superadmin.js create <username> <password> [--name "پشتیبانی سامانه"] [--email x@y.z]
 *   node scripts/superadmin.js password <username> <new-password>
 *   node scripts/superadmin.js 2fa-off <username>        غیرفعال‌کردن ورود دومرحله‌ای (وقتی گوشی در دسترس نیست)
 *   node scripts/superadmin.js disable|enable <username>
 *   node scripts/superadmin.js delete <username>
 *   node scripts/superadmin.js allow-ips "5.112.10.20,185.3."   (خالی = بدون محدودیت)
 *   node scripts/superadmin.js list
 * نکته: حساب سازنده فقط از /console وارد می‌شود؛ برای سایر کاربران سامانه وجود ندارد.
 */
const { boot } = require('./_boot');
const auth = require('../src/core/auth');

const args = process.argv.slice(2);
const cmd = args[0];
const pos = []; for (let i = 1; i < args.length; i++) { if (args[i].startsWith('--')) { i++; continue; } pos.push(args[i]); }
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const USER_RE = /^[a-zA-Z0-9_.]{3,40}$/;

function usage() {
  console.log(require('fs').readFileSync(__filename, 'utf8').split('\n').slice(2, 13).map((l) => l.replace(/^ \*\s?/, '')).join('\n'));
  process.exit(1);
}

(async () => {
  if (!cmd || cmd === 'help' || cmd === '--help') usage();
  const { db, settings } = await boot();
  const find = async (u) => db.table('users').whereRaw('LOWER(username) = ?', [String(u || '').toLowerCase()]).first();
  switch (cmd) {
    case 'create': {
      const [username, password] = pos;
      if (!username || !password) usage();
      if (!USER_RE.test(username)) throw new Error('نام کاربری باید ۳ تا ۴۰ کاراکتر لاتین باشد');
      if (password.length < 10) throw new Error('رمز حساب سازنده باید حداقل ۱۰ کاراکتر باشد');
      if (await find(username)) throw new Error('این نام کاربری قبلاً وجود دارد');
      const id = await db.insert('users', { username: username.toLowerCase(), password: await auth.hashPassword(password, 12), role: 'admin', is_super: 1, name: opt('name', 'پشتیبانی سامانه'), email: opt('email', null), status: 'active', created_at: db.now(), updated_at: db.now() });
      console.log(`✔ حساب سازنده ساخته شد (id=${id}). ورود: /console/login — توصیه: بلافاصله ورود دومرحله‌ای را از «امنیت کنسول» فعال کنید.`);
      break;
    }
    case 'password': {
      const [username, password] = pos;
      const u = await find(username); if (!u || !Number(u.is_super)) throw new Error('حساب سازنده یافت نشد');
      if (!password || password.length < 10) throw new Error('رمز باید حداقل ۱۰ کاراکتر باشد');
      await db.update('users', { password: await auth.hashPassword(password, 12), updated_at: db.now() }, { id: u.id });
      console.log('✔ رمز تغییر کرد');
      break;
    }
    case '2fa-off': {
      const u = await find(pos[0]); if (!u || !Number(u.is_super)) throw new Error('حساب سازنده یافت نشد');
      await db.update('users', { totp_secret: null, totp_enabled: 0, backup_codes: null, updated_at: db.now() }, { id: u.id });
      console.log('✔ ورود دومرحله‌ای غیرفعال شد');
      break;
    }
    case 'disable': case 'enable': {
      const u = await find(pos[0]); if (!u || !Number(u.is_super)) throw new Error('حساب سازنده یافت نشد');
      await db.update('users', { status: cmd === 'enable' ? 'active' : 'inactive', updated_at: db.now() }, { id: u.id });
      if (cmd === 'disable') { try { await require('../src/core/session-store').destroyUser(u.id); } catch (e) { /* ignore */ } }
      console.log(cmd === 'enable' ? '✔ فعال شد' : '✔ غیرفعال شد و نشست‌هایش بسته شد');
      break;
    }
    case 'delete': {
      const u = await find(pos[0]); if (!u || !Number(u.is_super)) throw new Error('حساب سازنده یافت نشد');
      try { await require('../src/core/session-store').destroyUser(u.id); } catch (e) { /* ignore */ }
      await db.remove('users', { id: u.id });
      console.log('✔ حذف شد');
      break;
    }
    case 'allow-ips': {
      const list = String(pos[0] || '').split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
      await settings.set('superadmin_allow_ips', list.join('\n'));
      console.log(list.length ? `✔ IPهای مجاز: ${list.join(', ')}` : '✔ محدودیت IP برداشته شد');
      break;
    }
    case 'list': {
      const rows = await db.table('users').select('id', 'username', 'name', 'status', 'totp_enabled', 'last_login_at', 'login_count').where('is_super', 1).orderBy('id').all();
      if (!rows.length) console.log('هیچ حساب سازنده‌ای وجود ندارد. با «create» بسازید.');
      for (const r of rows) console.log(`#${r.id}  ${r.username}  (${r.name})  ${r.status}  2FA:${Number(r.totp_enabled) ? 'on' : 'off'}  آخرین ورود: ${r.last_login_at || '-'}  (${r.login_count || 0} بار)`);
      const ips = settings.get('superadmin_allow_ips'); console.log('IPهای مجاز: ' + (ips ? ips.replace(/\n/g, ', ') : 'بدون محدودیت'));
      break;
    }
    default: usage();
  }
  process.exit(0);
})().catch((e) => { console.error('خطا:', e.message); process.exit(1); });
