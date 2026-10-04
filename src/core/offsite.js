'use strict';
/**
 * ارسال نسخهٔ پشتیبان به بیرون از سرور (ایمیل / FTP / WebDAV)
 * - فایل پیش از ارسال با gzip فشرده می‌شود (نام: <backup>.gz)
 * - نتیجهٔ آخرین ارسال در تنظیم backup_offsite_last (JSON) نگه داشته می‌شود
 * تنظیمات: backup_offsite_mode (none|email|ftp|webdav)، backup_offsite_max_mb،
 *   backup_email_to، backup_ftp_host/port/user/pass/dir/secure، backup_webdav_url/user/pass
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const settings = require('./settings');
const logger = require('./logger');
const J = require('./jalali');

const MODES = { none: 'غیرفعال', email: 'ایمیل (پیوست)', ftp: 'FTP / FTPS', webdav: 'WebDAV (Nextcloud، ownCloud و…)' };

function mode() { const m = settings.get('backup_offsite_mode', 'none'); return MODES[m] ? m : 'none'; }
/** آیا مقصد به‌طور کامل پیکربندی شده است؟ */
function configured() {
  const m = mode();
  if (m === 'email') return !!(settings.get('backup_email_to') && settings.getBool('email_enabled') && settings.get('smtp_host'));
  if (m === 'ftp') return !!(settings.get('backup_ftp_host') && settings.get('backup_ftp_user'));
  if (m === 'webdav') return /^https?:\/\//.test(settings.get('backup_webdav_url', ''));
  return false;
}
function last() { try { return JSON.parse(settings.get('backup_offsite_last', '') || 'null'); } catch (e) { return null; } }
async function remember(r) { await settings.set('backup_offsite_last', JSON.stringify(Object.assign({ at: J.nowISO() }, r))); }

async function gzipTo(src) {
  const tmp = path.join(os.tmpdir(), path.basename(src) + '.gz');
  await pipeline(fs.createReadStream(src), zlib.createGzip({ level: 6 }), fs.createWriteStream(tmp));
  return tmp;
}

async function sendEmail(file, name) {
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host: settings.get('smtp_host'), port: settings.getInt('smtp_port', 587), secure: settings.getBool('smtp_secure'),
    auth: settings.get('smtp_user') ? { user: settings.get('smtp_user'), pass: settings.get('smtp_pass') } : undefined,
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 60000
  });
  const school = settings.get('school_name', 'مدرسه');
  await transporter.sendMail({
    from: settings.get('smtp_from') || settings.get('smtp_user'), to: settings.get('backup_email_to'),
    subject: `پشتیبان ${school} — ${J.formatDate(J.todayISO())}`,
    html: `<div dir="rtl">نسخهٔ پشتیبان خودکار سامانهٔ مدیریت مدرسهٔ «${school}» پیوست است.<br>فایل: <code dir="ltr">${name}</code><br>زمان: ${J.formatDateTime(J.nowISO())}</div>`,
    attachments: [{ filename: name, path: file, contentType: 'application/gzip' }]
  });
  return 'ایمیل به ' + settings.get('backup_email_to');
}

async function ftpClient() {
  const ftp = require('basic-ftp');
  const client = new ftp.Client(30000);
  await client.access({
    host: settings.get('backup_ftp_host'), port: settings.getInt('backup_ftp_port', 21), user: settings.get('backup_ftp_user'), password: settings.get('backup_ftp_pass'),
    secure: settings.getBool('backup_ftp_secure'), secureOptions: settings.getBool('backup_ftp_secure') ? { rejectUnauthorized: false } : undefined
  });
  return client;
}
async function sendFtp(file, name) {
  const client = await ftpClient();
  try {
    const dir = (settings.get('backup_ftp_dir', '') || '').trim();
    if (dir) await client.ensureDir(dir);
    await client.uploadFrom(file, name);
    return `FTP: ${settings.get('backup_ftp_host')}${dir ? '/' + dir.replace(/^\/+/, '') : ''}/${name}`;
  } finally { client.close(); }
}

function webdavHeaders() {
  const h = { 'User-Agent': 'madrese-backup' };
  const u = settings.get('backup_webdav_user', ''); const p = settings.get('backup_webdav_pass', '');
  if (u) h.Authorization = 'Basic ' + Buffer.from(u + ':' + p).toString('base64');
  return h;
}
async function sendWebdav(file, name) {
  const base = settings.get('backup_webdav_url', '').replace(/\/+$/, '');
  const url = base + '/' + encodeURIComponent(name);
  const body = fs.readFileSync(file);
  const res = await fetch(url, { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/gzip', 'Content-Length': String(body.length) }, webdavHeaders()), body, signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`WebDAV HTTP ${res.status}`);
  return 'WebDAV: ' + url;
}

/** ارسال یک فایل پشتیبان (نام فایل داخل storage/backups) به مقصد پیکربندی‌شده */
async function send(backupFile) {
  const m = mode();
  if (m === 'none') return { ok: false, skipped: true, error: 'ارسال به بیرون غیرفعال است' };
  if (!configured()) { const r = { ok: false, error: 'تنظیمات مقصد کامل نیست' }; await remember(Object.assign({ name: path.basename(backupFile) }, r)); return r; }
  if (!fs.existsSync(backupFile)) return { ok: false, error: 'فایل پشتیبان یافت نشد' };
  let tmp = null;
  try {
    tmp = await gzipTo(backupFile);
    const name = path.basename(tmp);
    const mb = fs.statSync(tmp).size / 1048576;
    const max = settings.getInt('backup_offsite_max_mb', m === 'email' ? 20 : 500);
    if (mb > max) throw new Error(`حجم فایل فشرده (${mb.toFixed(1)} MB) از سقف ${max} MB بیشتر است`);
    const detail = m === 'email' ? await sendEmail(tmp, name) : m === 'ftp' ? await sendFtp(tmp, name) : await sendWebdav(tmp, name);
    const r = { ok: true, name, size: Math.round(mb * 1024) / 1024, detail };
    await remember(r);
    logger.info('offsite backup sent', { name, mode: m });
    return r;
  } catch (e) {
    const r = { ok: false, name: path.basename(backupFile), error: e.message };
    await remember(r);
    logger.warn('offsite backup failed', { mode: m, error: e.message });
    return r;
  } finally { if (tmp) { try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ } } }
}

/** آزمایش اتصال به مقصد (بدون ارسال پشتیبان واقعی) */
async function test() {
  const m = mode();
  try {
    if (m === 'none') return { ok: false, error: 'حالتی انتخاب نشده است' };
    if (!configured()) return { ok: false, error: 'تنظیمات مقصد کامل نیست' };
    if (m === 'email') {
      const tmp = path.join(os.tmpdir(), 'madrese-test-' + Date.now() + '.txt'); fs.writeFileSync(tmp, 'test');
      try { const d = await sendEmail(tmp, 'madrese-test.txt'); return { ok: true, detail: d }; } finally { try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ } }
    }
    if (m === 'ftp') { const c = await ftpClient(); try { const dir = (settings.get('backup_ftp_dir', '') || '').trim(); if (dir) await c.ensureDir(dir); const list = await c.list(); return { ok: true, detail: `اتصال برقرار شد؛ ${list.length} مورد در پوشه` }; } finally { c.close(); } }
    const base = settings.get('backup_webdav_url', '').replace(/\/+$/, '') + '/';
    const res = await fetch(base, { method: 'PROPFIND', headers: Object.assign({ Depth: '0' }, webdavHeaders()), signal: AbortSignal.timeout(20000) });
    if (res.status === 405 || res.status === 501) { const r2 = await fetch(base, { method: 'HEAD', headers: webdavHeaders(), signal: AbortSignal.timeout(20000) }); if (!r2.ok) throw new Error('HTTP ' + r2.status); }
    else if (!res.ok) throw new Error('HTTP ' + res.status);
    return { ok: true, detail: 'پوشهٔ WebDAV در دسترس است' };
  } catch (e) { return { ok: false, error: e.message }; }
}

module.exports = { MODES, mode, configured, last, send, test };
