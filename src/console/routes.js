'use strict';
/**
 * کنسول سازنده (super admin) — /console
 *  - ورود جداگانه (/console/login) با محدودیت IP اختیاری، محدودیت تلاش و رمز یکبارمصرف (TOTP) اختیاری
 *  - داشبورد فنی: نسخه، دیسک، پایگاه داده، ماژول‌ها، گزارش‌های خطا، درخواست‌های ماژول، آخرین ورودها
 *  - گزارش‌های خطای کاربران (دیدن/پاسخ/وضعیت) و درخواست‌های فعال‌سازی ماژول (فعال‌سازی با یک کلیک)
 *  - امنیت: تغییر رمز، فعال/غیرفعال‌سازی ۲FA با کدهای پشتیبان، IPهای مجاز، ایمیل هشدار، مدت نشست
 *  - ورود به پنل هر کاربر (impersonate) از طریق /auth/impersonate/:id یا با نام کاربری از داشبورد
 * این بخش هسته است (ماژول نیست) و برای کاربران غیرسازنده «۴۰۴» برمی‌گرداند.
 */
const path = require('path');
const express = require('express');
const db = require('../core/db');
const auth = require('../core/auth');
const settings = require('../core/settings');
const modules = require('../core/modules');
const notify = require('../core/notify');
const activity = require('../core/activity');
const utils = require('../core/utils');
const J = require('../core/jalali');
const totp = require('../core/totp');
const barcode = require('../core/barcode');
const logger = require('../core/logger');
const health = require('../core/health');
const maintenance = require('../core/maintenance');
const pkg = require('../../package.json');

const router = express.Router();
const v = (n) => path.join(__dirname, 'views', n + '.ejs');
const KINDS = { bug: 'خطا / مشکل', suggestion: 'پیشنهاد', question: 'سؤال', module_request: 'درخواست ماژول' };
const STATUSES = { new: 'جدید', seen: 'دیده شد', in_progress: 'در حال بررسی', resolved: 'رفع شد', closed: 'بسته' };
const STATUS_COLOR = { new: 'danger', seen: 'secondary', in_progress: 'warning', resolved: 'success', closed: 'dark' };
const PENDING_TTL = 5 * 60 * 1000;
const notFound = (req, res) => { if (auth.wantsJson(req)) return res.status(404).json({ ok: false, error: 'یافت نشد' }); res.status(404); return res.render('errors/404', { title: 'یافت نشد' }); };

/** فهرست IPهای مجاز (هر خط/کاما یک IP یا پیشوند مانند 5.112.) */
function allowList() { return String(settings.get('superadmin_allow_ips') || '').split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean); }
function ipAllowed(req, list) {
  list = list || allowList();
  if (!list.length) return true;
  const ip = auth.clientIp(req);
  return list.some((p) => (/[.:]$/.test(p) ? ip.startsWith(p) : ip === p));
}
async function superAlert(req, title, body, extra) {
  try { await notify.pushSuper(Object.assign({ title, body, link: '/console/security', type: 'warning' }, extra || {}), { inapp: false }); } catch (e) { /* ignore */ }
}

// ====================== ورود ======================
router.get('/login', (req, res) => {
  if (!ipAllowed(req)) return notFound(req, res);
  if (auth.isSuper(req)) return res.redirect('/console');
  res.render(v('login'), { title: 'ورود به کنسول سازنده', layout: 'layouts/auth' });
});
router.post('/login', async (req, res) => {
  if (!ipAllowed(req)) return notFound(req, res);
  if (auth.isSuper(req)) return res.redirect('/console');
  const username = String(req.body.username || '').trim().toLowerCase().slice(0, 60);
  const password = String(req.body.password || '');
  const fail = (msg) => { req.flash('danger', msg); return res.redirect('/console/login'); };
  // محدودیت تلاش: به ازای نام کاربری و نیز سراسری برای این IP
  const locked = Math.max(auth.isLocked(req, 'console|' + username), auth.isLocked(req, 'console|*'));
  if (locked) return fail(`به دلیل تلاش‌های ناموفق متعدد، ورود برای ${J.toPersianDigits(locked)} دقیقه مسدود شده است.`);
  const result = username && password ? await auth.authenticate(username, password) : { ok: false };
  const user = result.ok && Number(result.user.is_super) === 1 ? result.user : null;
  if (!user) {
    auth.recordFailure(req, 'console|' + username); auth.recordFailure(req, 'console|*');
    await auth.logLogin(req, result.user && Number(result.user.is_super) ? result.user : null, username, false, 'console');
    logger.warn('console login failed', { username, ip: auth.clientIp(req) });
    if (result.user && Number(result.user.is_super)) await superAlert(req, 'تلاش ناموفق برای ورود به کنسول سازنده', `نام کاربری ${username} از IP ${auth.clientIp(req)} — ${J.formatDateTime(J.nowISO())}`);
    return fail('اطلاعات ورود نادرست است.');
  }
  auth.clearFailures(req, 'console|' + username); auth.clearFailures(req, 'console|*');
  if (Number(user.totp_enabled) === 1 && totp.openSecret(user.totp_secret)) {
    req.session.consolePending = { userId: user.id, at: Date.now(), tries: 0 };
    return req.session.save(() => res.redirect('/console/login/2fa'));
  }
  await finalizeLogin(req, user);
  res.redirect('/console');
});
async function finalizeLogin(req, user) {
  await auth.login(req, user, false, { superAuth: Date.now() });
  delete req.session.consolePending;
  await auth.logLogin(req, user, user.username, true, 'console');
  await activity.log(req, 'login', 'console', user.id, 'ورود به کنسول سازنده');
  logger.info('console login', { user: user.username, ip: auth.clientIp(req) });
  await superAlert(req, 'ورود به کنسول سازنده', `${user.name || user.username} از IP ${auth.clientIp(req)} — ${J.formatDateTime(J.nowISO())} — ${String(req.get('user-agent') || '').slice(0, 120)}`, { type: 'info' });
}
const usedCodes = new Map();
router.get('/login/2fa', (req, res) => {
  const p = req.session.consolePending;
  if (!p || Date.now() - p.at > PENDING_TTL) { delete req.session.consolePending; return res.redirect('/console/login'); }
  res.render(v('login-2fa'), { title: 'تأیید دومرحله‌ای', layout: 'layouts/auth' });
});
router.post('/login/2fa', async (req, res) => {
  const p = req.session.consolePending;
  if (!p || Date.now() - p.at > PENDING_TTL) { delete req.session.consolePending; return res.redirect('/console/login'); }
  const user = await db.findById('users', p.userId);
  const code = String(req.body.code || '').trim();
  const fail = (msg) => { p.tries = (p.tries || 0) + 1; if (p.tries >= 5) { delete req.session.consolePending; req.flash('danger', 'تعداد تلاش بیش از حد مجاز؛ دوباره وارد شوید.'); return res.redirect('/console/login'); } req.flash('danger', msg); return res.redirect('/console/login/2fa'); };
  if (!user || Number(user.is_super) !== 1 || user.status !== 'active') { delete req.session.consolePending; return res.redirect('/console/login'); }
  const secret = totp.openSecret(user.totp_secret);
  // جلوگیری از استفادهٔ مجدد یک کد TOTP در همان بازه (replay)
  const replayKey = user.id + ':' + code; const nowMs = Date.now();
  for (const [k, t] of usedCodes) if (nowMs - t > 120000) usedCodes.delete(k);
  let ok = code.length === 6 && !usedCodes.has(replayKey) && totp.verify(secret, code);
  if (ok) usedCodes.set(replayKey, nowMs);
  if (!ok && code.length >= 10) {
    const left = totp.consumeBackupCode(user.backup_codes, code);
    if (left) { ok = true; await db.update('users', { backup_codes: JSON.stringify(left), updated_at: db.now() }, { id: user.id }); await superAlert(req, 'استفاده از کد پشتیبان برای ورود به کنسول', `${left.length} کد پشتیبان باقی مانده است.`); }
  }
  if (!ok) { await auth.logLogin(req, user, user.username, false, 'console'); return fail('کد تأیید نادرست است.'); }
  await finalizeLogin(req, user);
  res.redirect('/console');
});

// ====================== از اینجا فقط سازنده ======================
router.use(auth.requireSuper);
router.use((req, res, next) => { res.locals.activeModule = 'console'; res.locals.consoleKinds = KINDS; res.locals.consoleStatuses = STATUSES; res.locals.consoleStatusColor = STATUS_COLOR; next(); });

// ---------- داشبورد ----------
router.get('/', async (req, res) => {
  const reports = { total: 0, new: 0, in_progress: 0, resolved: 0 };
  for (const r of await db.table('support_reports').select('status', 'kind', 'COUNT(*) as c').groupBy('status', 'kind').all()) {
    if (r.kind === 'module_request') { reports.requests = (reports.requests || 0) + Number(r.c); if (r.status === 'new' || r.status === 'seen' || r.status === 'in_progress') reports.requestsOpen = (reports.requestsOpen || 0) + Number(r.c); continue; }
    reports.total += Number(r.c); if (reports[r.status] !== undefined) reports[r.status] += Number(r.c);
  }
  const roles = {};
  for (const r of await db.table('users').select('role', 'COUNT(*) as c').where('status', 'active').where('is_super', 0).groupBy('role').all()) roles[r.role] = Number(r.c);
  const latestReports = await db.table('support_reports as r').select('r.*', 'u.name as user_name').leftJoin('users as u', 'u.id', 'r.user_id').where('r.kind', '!=', 'module_request').orderBy('r.id', 'desc').limit(6).all();
  const latestRequests = await db.table('support_reports as r').select('r.*', 'u.name as user_name').leftJoin('users as u', 'u.id', 'r.user_id').where('r.kind', 'module_request').orderBy('r.id', 'desc').limit(6).all();
  const consoleLogins = await db.table('login_logs').where('kind', 'console').orderBy('id', 'desc').limit(6).all();
  const admins = await db.table('users').select('id', 'name', 'username', 'phone', 'email', 'last_login_at').where({ role: 'admin', status: 'active', is_super: 0 }).orderBy('id').limit(5).all();
  let disk = null; try { disk = await health.cached(); } catch (e) { /* ignore */ }
  let lastBackup = null; try { const list = require('../core/backup').list(); lastBackup = list.sort((a, b) => String(b.mtime || '').localeCompare(String(a.mtime || '')))[0] || null; } catch (e) { /* ignore */ }
  const me = await db.table('users').select('totp_enabled', 'backup_codes').where('id', req.user.id).first();
  const info = {
    version: pkg.version, installedVersion: settings.get('app_version') || pkg.version, installedAt: settings.get('installed_at') || '', updatedAt: settings.get('app_updated_at') || '',
    node: process.version, driver: db.info ? db.info.driver : '-', uptime: Math.round(process.uptime()), memory: process.memoryUsage().rss, maintenance: maintenance.isOn(),
    allowIps: allowList().length, totp: !!(me && Number(me.totp_enabled)), alertEmail: settings.get('superadmin_alert_email'), smtp: settings.getBool('email_enabled') && !!settings.get('smtp_host'),
    sms: settings.getBool('sms_enabled') ? settings.get('sms_provider') : null, scheduler: settings.get('scheduler_mode'), siteUrl: settings.get('site_url')
  };
  res.render(v('dashboard'), { title: 'کنسول سازنده', info, stats: modules.stats(), reports, roles, latestReports, latestRequests, consoleLogins, admins, disk, lastBackup, errors: logger.recent(8).filter((l) => l.level === 'error' || l.level === 'warn') });
});

// ---------- ورود به پنل کاربر با نام کاربری ----------
router.post('/impersonate', async (req, res) => {
  const q = String(req.body.username || '').trim().toLowerCase();
  const target = q ? await db.table('users').whereRaw('LOWER(username) = ?', [q]).first() : null;
  if (!target || Number(target.is_super) || target.status !== 'active') { req.flash('danger', 'کاربری با این نام کاربری یافت نشد یا غیرفعال است.'); return res.redirect('/console'); }
  const superId = req.user.id;
  await activity.log(req, 'impersonate', 'user', target.id, `ورود به جای ${target.name} (کنسول سازنده)`);
  await auth.login(req, target, false);
  req.session.impersonatorId = superId;
  req.session.save(() => res.redirect('/dashboard'));
});

// ---------- گزارش‌های خطا ----------
async function reportQuery() { return db.table('support_reports as r').select('r.*', 'u.name as user_name', 'u.username as user_username', 'u.role as user_role', 'h.name as handler_name').leftJoin('users as u', 'u.id', 'r.user_id').leftJoin('users as h', 'h.id', 'r.handled_by'); }
router.get('/reports', async (req, res) => {
  const q = (await reportQuery()).where('r.kind', '!=', 'module_request').orderBy('r.id', 'desc');
  if (req.query.status) q.where('r.status', String(req.query.status));
  else if (req.query.all !== '1') q.whereIn('r.status', ['new', 'seen', 'in_progress']);
  if (req.query.kind && KINDS[req.query.kind]) q.where('r.kind', String(req.query.kind));
  if (req.query.q) q.search(utils.normalizePersian(String(req.query.q)).trim(), ['r.subject', 'r.message', 'u.name', 'r.page_url']);
  const result = await q.paginate(req.query.page, 30);
  res.render(v('reports'), { title: 'گزارش‌های خطا', result, KINDS, STATUSES, STATUS_COLOR });
});
router.get('/reports/:id', async (req, res) => {
  const row = await (await reportQuery()).where('r.id', Number(req.params.id) || 0).first();
  if (!row) return notFound(req, res);
  if (row.status === 'new') { await db.update('support_reports', { status: 'seen', handled_by: req.user.id, updated_at: db.now() }, { id: row.id }); row.status = 'seen'; }
  const others = await db.table('support_reports').select('id', 'kind', 'subject', 'status', 'created_at').where('user_id', row.user_id).where('id', '!=', row.id).orderBy('id', 'desc').limit(8).all();
  res.render(v('report'), { title: `گزارش #${row.id}`, row, others, KINDS, STATUSES, STATUS_COLOR });
});
router.post('/reports/:id', async (req, res) => {
  const row = await db.findById('support_reports', Number(req.params.id) || 0);
  if (!row) return notFound(req, res);
  const status = STATUSES[req.body.status] ? req.body.status : row.status;
  const reply = utils.normalizePersian(String(req.body.reply || '')).trim().slice(0, 4000);
  const note = utils.normalizePersian(String(req.body.note || '')).trim().slice(0, 4000);
  const data = { status, note: note || null, handled_by: req.user.id, updated_at: db.now() };
  const replyChanged = reply && reply !== (row.reply || '');
  if (replyChanged) { data.reply = reply; data.replied_at = db.now(); } else if (!reply) data.reply = null;
  await db.update('support_reports', data, { id: row.id });
  const statusChanged = status !== row.status;
  if (row.user_id && (replyChanged || (statusChanged && (status === 'resolved' || status === 'closed')))) {
    const title = row.kind === 'module_request' ? `نتیجهٔ درخواست: ${row.subject}` : `پاسخ به گزارش شما: ${row.subject}`;
    await notify.push([row.user_id], { title, body: (replyChanged ? reply : `وضعیت: ${STATUSES[status]}`).slice(0, 500), link: row.kind === 'module_request' ? '/support/modules' : '/support/my', type: status === 'resolved' ? 'success' : 'info' });
  }
  await activity.log(req, 'update', 'support_report', row.id, `گزارش #${row.id}: ${STATUSES[status]}${replyChanged ? ' + پاسخ' : ''}`);
  req.flash('success', 'ذخیره شد' + (replyChanged ? ' و پاسخ برای کاربر ارسال شد.' : '.'));
  res.redirect(req.body.back || (row.kind === 'module_request' ? '/console/requests' : '/console/reports/' + row.id));
});
router.post('/reports/:id/delete', async (req, res) => {
  const row = await db.findById('support_reports', Number(req.params.id) || 0);
  if (!row) return notFound(req, res);
  if (row.image) require('../core/upload').removeFile(row.image);
  await db.remove('support_reports', { id: row.id });
  await activity.log(req, 'delete', 'support_report', row.id, `حذف گزارش #${row.id}`);
  req.flash('success', 'گزارش حذف شد.');
  res.redirect(row.kind === 'module_request' ? '/console/requests' : '/console/reports');
});

// ---------- درخواست‌های ماژول ----------
router.get('/requests', async (req, res) => {
  const q = (await reportQuery()).where('r.kind', 'module_request').orderBy('r.id', 'desc');
  if (req.query.all !== '1') q.whereIn('r.status', ['new', 'seen', 'in_progress']);
  const result = await q.paginate(req.query.page, 30);
  const rows = result.data.map((r) => {
    const [mk, fk] = String(r.module_key || '').split('.');
    const mod = mk ? modules.getModule(mk) : null;
    const feat = mod && fk ? mod.features.find((f) => f.key === fk) : null;
    return Object.assign(r, { modName: mod ? mod.name : null, featName: feat ? feat.name : null, enabled: r.module_key ? modules.isEnabled(r.module_key) : null, deps: mod && !fk ? (mod.dependencies || []).filter((d) => !modules.isEnabled(d)) : [] });
  });
  res.render(v('requests'), { title: 'درخواست‌های ماژول', result, rows, STATUSES, STATUS_COLOR });
});
router.post('/requests/:id/enable', async (req, res) => {
  const row = await db.findById('support_reports', Number(req.params.id) || 0);
  if (!row || row.kind !== 'module_request') return notFound(req, res);
  const key = String(row.module_key || '');
  const [mk] = key.split('.');
  const mod = modules.getModule(mk);
  if (!mod) { req.flash('danger', 'این درخواست به ماژول مشخصی اشاره ندارد؛ از صفحهٔ ماژول‌ها فعال و سپس درخواست را پاسخ دهید.'); return res.redirect('/console/requests'); }
  const enabledNow = [];
  if (!key.includes('.')) for (const dep of mod.dependencies || []) if (!modules.isEnabled(dep)) { await modules.setState(dep, true); enabledNow.push((modules.getModule(dep) || {}).name || dep); }
  if (key.includes('.') && !modules.isEnabled(mk)) { await modules.setState(mk, true); enabledNow.push(mod.name); }
  await modules.setState(key, true);
  const name = key.includes('.') ? `${mod.name} › ${((mod.features.find((f) => f.fullKey === key)) || {}).name || key}` : mod.name;
  const reply = utils.normalizePersian(String(req.body.reply || '')).trim().slice(0, 2000) || `«${name}» فعال شد و هم‌اکنون در دسترس است.`;
  await db.update('support_reports', { status: 'resolved', reply, replied_at: db.now(), handled_by: req.user.id, updated_at: db.now() }, { id: row.id });
  await activity.log(req, 'toggle', 'module', null, `فعال‌سازی ${key} (درخواست #${row.id})`);
  if (row.user_id) await notify.push([row.user_id], { title: `«${name}» فعال شد`, body: reply, link: key.includes('.') ? '/support/modules' : '/' + mk, type: 'success' });
  req.flash('success', `«${name}» فعال شد${enabledNow.length ? ` (به همراه وابستگی: ${enabledNow.join('، ')})` : ''} و به درخواست‌کننده اطلاع داده شد.`);
  res.redirect('/console/requests');
});

// ---------- امنیت کنسول ----------
async function securityData(req, extra) {
  const me = await db.table('users').select('id', 'username', 'name', 'email', 'totp_enabled', 'backup_codes', 'last_login_at', 'login_count').where('id', req.user.id).first();
  let codesLeft = 0; try { codesLeft = JSON.parse(me.backup_codes || '[]').length; } catch (e) { codesLeft = 0; }
  const logins = await db.table('login_logs').where('kind', 'console').orderBy('id', 'desc').limit(25).all();
  const supers = await db.table('users').select('id', 'username', 'name', 'status', 'totp_enabled', 'last_login_at').where('is_super', 1).orderBy('id').all();
  return Object.assign({ title: 'امنیت کنسول', me, codesLeft, logins, supers, myIp: auth.clientIp(req), s: settings.all() }, extra || {});
}
router.get('/security', async (req, res) => res.render(v('security'), await securityData(req)));
router.post('/security/settings', async (req, res) => {
  const ips = String(req.body.superadmin_allow_ips || '').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  const bad = ips.filter((x) => !/^[0-9a-fA-F.:]+$/.test(x));
  if (bad.length) { req.flash('danger', 'IP نامعتبر: ' + bad.join('، ')); return res.redirect('/console/security'); }
  const fakeReq = { ip: auth.clientIp(req), get: () => '' };
  if (ips.length && !ipAllowed(fakeReq, ips)) { req.flash('danger', `IP فعلی شما (${auth.clientIp(req)}) در فهرست نیست؛ برای جلوگیری از قفل‌شدن، آن را اضافه کنید.`); return res.redirect('/console/security'); }
  const hours = Math.min(72, Math.max(1, parseInt(J.toEnglishDigits(req.body.superadmin_session_hours || '12'), 10) || 12));
  const email = String(req.body.superadmin_alert_email || '').trim().slice(0, 150);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { req.flash('danger', 'ایمیل هشدار نامعتبر است.'); return res.redirect('/console/security'); }
  await settings.setMany({
    superadmin_allow_ips: ips.join('\n'), superadmin_alert_email: email, superadmin_session_hours: String(hours),
    support_contact_text: utils.normalizePersian(String(req.body.support_contact_text || '')).trim().slice(0, 500),
    support_max_per_hour: String(Math.min(100, Math.max(1, parseInt(J.toEnglishDigits(req.body.support_max_per_hour || '10'), 10) || 10))),
    module_request_note: utils.normalizePersian(String(req.body.module_request_note || '')).trim().slice(0, 1000)
  });
  await activity.log(req, 'update', 'console', null, 'به‌روزرسانی تنظیمات کنسول سازنده');
  req.flash('success', 'تنظیمات کنسول ذخیره شد.');
  res.redirect('/console/security');
});
router.post('/security/password', async (req, res) => {
  const me = await db.findById('users', req.user.id);
  const pw = String(req.body.password || '');
  if (!(await auth.verifyPassword(req.body.current, me.password))) { req.flash('danger', 'رمز عبور فعلی نادرست است.'); return res.redirect('/console/security'); }
  if (pw.length < 10) { req.flash('danger', 'رمز عبور کنسول باید حداقل ۱۰ کاراکتر باشد.'); return res.redirect('/console/security'); }
  if (pw !== req.body.password2) { req.flash('danger', 'تکرار رمز عبور مطابقت ندارد.'); return res.redirect('/console/security'); }
  await db.update('users', { password: await auth.hashPassword(pw, 12), updated_at: db.now() }, { id: me.id });
  await activity.log(req, 'password', 'console', me.id, 'تغییر رمز کنسول سازنده');
  await superAlert(req, 'رمز کنسول سازنده تغییر کرد', `از IP ${auth.clientIp(req)}`);
  req.flash('success', 'رمز عبور کنسول تغییر کرد.');
  res.redirect('/console/security');
});
router.get('/security/2fa', async (req, res) => {
  const me = await db.table('users').select('username', 'totp_enabled').where('id', req.user.id).first();
  if (Number(me.totp_enabled)) return res.redirect('/console/security');
  if (!req.session.totpSetup || Date.now() - req.session.totpSetup.at > 15 * 60 * 1000) req.session.totpSetup = { secret: totp.generateSecret(), at: Date.now() };
  const secret = req.session.totpSetup.secret;
  const url = totp.otpauthUrl(secret, me.username, `${settings.get('school_name')} — کنسول`);
  res.render(v('2fa-setup'), { title: 'فعال‌سازی ورود دومرحله‌ای', secret, secretPretty: secret.replace(/(.{4})/g, '$1 ').trim(), qr: barcode.qr(url, { size: 200 }), url });
});
router.post('/security/2fa', async (req, res) => {
  const setup = req.session.totpSetup;
  if (!setup || Date.now() - setup.at > 15 * 60 * 1000) { req.flash('danger', 'زمان راه‌اندازی به پایان رسید؛ دوباره تلاش کنید.'); return res.redirect('/console/security/2fa'); }
  if (!totp.verify(setup.secret, req.body.code)) { req.flash('danger', 'کد واردشده نادرست است. ساعت گوشی را بررسی و دوباره تلاش کنید.'); return res.redirect('/console/security/2fa'); }
  const codes = totp.generateBackupCodes(8);
  await db.update('users', { totp_secret: totp.sealSecret(setup.secret), totp_enabled: 1, backup_codes: JSON.stringify(codes.map(totp.hashCode)), updated_at: db.now() }, { id: req.user.id });
  delete req.session.totpSetup;
  await activity.log(req, 'update', 'console', req.user.id, 'فعال‌سازی ورود دومرحله‌ای کنسول');
  res.render(v('2fa-codes'), { title: 'کدهای پشتیبان', codes, regenerated: false });
});
router.post('/security/2fa/codes', async (req, res) => {
  const me = await db.findById('users', req.user.id);
  if (!(await auth.verifyPassword(req.body.password, me.password))) { req.flash('danger', 'رمز عبور نادرست است.'); return res.redirect('/console/security'); }
  if (!Number(me.totp_enabled)) return res.redirect('/console/security');
  const codes = totp.generateBackupCodes(8);
  await db.update('users', { backup_codes: JSON.stringify(codes.map(totp.hashCode)), updated_at: db.now() }, { id: me.id });
  await activity.log(req, 'update', 'console', me.id, 'تولید مجدد کدهای پشتیبان');
  res.render(v('2fa-codes'), { title: 'کدهای پشتیبان', codes, regenerated: true });
});
router.post('/security/2fa/disable', async (req, res) => {
  const me = await db.findById('users', req.user.id);
  if (!(await auth.verifyPassword(req.body.password, me.password))) { req.flash('danger', 'رمز عبور نادرست است.'); return res.redirect('/console/security'); }
  await db.update('users', { totp_secret: null, totp_enabled: 0, backup_codes: null, updated_at: db.now() }, { id: me.id });
  await activity.log(req, 'update', 'console', me.id, 'غیرفعال‌سازی ورود دومرحله‌ای کنسول');
  await superAlert(req, 'ورود دومرحله‌ای کنسول غیرفعال شد', `از IP ${auth.clientIp(req)}`);
  req.flash('warning', 'ورود دومرحله‌ای غیرفعال شد. توصیه می‌شود دوباره فعال کنید.');
  res.redirect('/console/security');
});

module.exports = router;
