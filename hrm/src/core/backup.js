'use strict';
/** پشتیبان‌گیری: ساخت فایل (sqlite، JSON یا ZIP کامل = پایگاه داده + فایل‌های بارگذاری‌شده)، فهرست، هرس نسخه‌های قدیمی و بازیابی */
const path = require('path');
const fs = require('fs');
const db = require('./db');
const config = require('./config');
const J = require('./jalali');
const schema = require('../../database/schema');
const pkg = require('../../package.json');
const zip = require('./zip');
const settings = require('./settings');

const STORE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.zip', '.rar', '.7z', '.gz', '.mp3', '.mp4', '.m4a', '.pdf']);
const TYPE_TITLES = { json: 'JSON (پایگاه داده)', sqlite: 'فایل SQLite', zip: 'کامل (پایگاه داده + فایل‌ها)' };

function dir() { const d = path.join(config.get().storage, 'backups'); fs.mkdirSync(d, { recursive: true }); return d; }
function list() {
  return fs.readdirSync(dir()).filter((f) => /\.(json|sqlite|zip)$/.test(f)).map((f) => { const st = fs.statSync(path.join(dir(), f)); return { name: f, type: path.extname(f).slice(1), typeTitle: TYPE_TITLES[path.extname(f).slice(1)] || '', size: st.size, mtime: st.mtime.toISOString().slice(0, 19).replace('T', ' ') }; }).sort((a, b) => b.name.localeCompare(a.name));
}
/** دادهٔ همهٔ جدول‌ها (به‌جز نشست‌ها) به شکل JSON قابل بازیابی */
async function dumpJSON() {
  const out = { version: pkg.version, created_at: J.nowISO(), dialect: db.dialect, company: settings.get('company_name', ''), tables: {} };
  for (const t of Object.keys(schema)) { if (t === 'sessions') continue; out.tables[t] = await db.table(t).all(); }
  return out;
}
/** پیمایش بازگشتی پوشهٔ آپلودها → [{ rel, abs, size }] */
function walkUploads() {
  const root = config.get().uploads.dir; const out = [];
  const walk = (d) => { let items = []; try { items = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; } for (const it of items) { const abs = path.join(d, it.name); if (it.isDirectory()) walk(abs); else if (it.isFile() && it.name !== '.gitkeep') out.push({ rel: path.relative(root, abs).split(path.sep).join('/'), abs, size: fs.statSync(abs).size }); } };
  walk(root); return out;
}
/** پشتیبان کامل: ZIP شامل manifest.json، database.json و uploads/… (نام‌های UTF-8) */
async function createFull(prefix) {
  const stamp = J.nowISO().replace(/[: ]/g, '-');
  const name = `${prefix || 'full'}-${stamp}.zip`;
  const tmp = path.join(dir(), name + '.part');
  const w = new zip.ZipWriter(tmp);
  try {
    const data = await dumpJSON();
    const files = walkUploads();
    const manifest = { type: 'full', version: pkg.version, created_at: data.created_at, dialect: db.dialect, company: data.company, tables: Object.fromEntries(Object.entries(data.tables).map(([t, rows]) => [t, rows.length])), files: files.length, files_bytes: files.reduce((a, f) => a + f.size, 0) };
    w.add('manifest.json', JSON.stringify(manifest, null, 1));
    w.add('database.json', JSON.stringify(data));
    for (const f of files) await w.addFile('uploads/' + f.rel, f.abs, { store: STORE_EXT.has(path.extname(f.rel).toLowerCase()) });
    w.close();
    fs.renameSync(tmp, path.join(dir(), name));
    return name;
  } catch (e) { try { w.close(); } catch (e2) { /* ignore */ } try { fs.unlinkSync(tmp); } catch (e2) { /* ignore */ } throw e; }
}
/** @param {'file'|'json'|'full'} type  @param {string} [prefix] */
async function create(type, prefix) {
  if (type === 'full') return createFull(prefix);
  const stamp = J.nowISO().replace(/[: ]/g, '-');
  const base = prefix || 'backup';
  let name;
  if (db.info.client === 'sqlite' && type === 'file') {
    if (db.driver.saveNow) db.driver.saveNow();
    name = `${base}-${stamp}.sqlite`;
    fs.copyFileSync(db.info.filename, path.join(dir(), name));
  } else {
    name = `${base}-${stamp}.json`;
    fs.writeFileSync(path.join(dir(), name), JSON.stringify(await dumpJSON()), 'utf8');
  }
  return name;
}
/** حذف نسخه‌های خودکار قدیمی؛ فقط فایل‌های با پیشوند مشخص (پیش‌فرض auto) */
function prune(keep, prefix) {
  const p = prefix || 'auto';
  const files = list().filter((f) => f.name.startsWith(p + '-'));
  const removed = [];
  for (const f of files.slice(Math.max(0, Number(keep) || 7))) { fs.unlinkSync(path.join(dir(), f.name)); removed.push(f.name); }
  return removed;
}
/** بازیابی جدول‌ها از ساختار JSON (جایگزینی کامل) → تعداد سطرها */
/**
 * بازیابی جدول‌ها. opts.trusted=false (بازیابی توسط مدیر سامانه):
 *  - حساب‌های سازنده (is_super) حفظ می‌شوند و هیچ سطر بازیابی‌شده‌ای نمی‌تواند super شود
 *  - جدول module_states دست نمی‌خورد (فعال‌سازی ماژول‌ها فقط از کنسول سازنده)
 *  - کلیدهای تنظیمات فنی (opts.protectedSettings) با مقدار فعلی بازنویسی می‌شوند
 */
async function restoreTables(data, opts) {
  opts = opts || {};
  if (!data || !data.tables || typeof data.tables !== 'object') throw new Error('ساختار فایل پشتیبان نامعتبر است');
  const utils = require('./utils');
  const trusted = !!opts.trusted;
  const SUPER_COLS = ['is_super', 'totp_secret', 'totp_enabled', 'backup_codes'];
  const supers = trusted ? [] : await db.table('users').where('is_super', 1).all();
  const protectedKeys = trusted ? [] : (opts.protectedSettings || []);
  const keep = protectedKeys.length ? await db.table('settings').whereIn('key', protectedKeys).all() : [];
  let restored = 0;
  await db.transaction(async (tx) => {
    for (const [t, rows] of Object.entries(data.tables)) {
      if (!schema[t] || t === 'sessions' || !Array.isArray(rows)) continue;
      if (!trusted && t === 'module_states') continue;
      await tx.remove(t);
      const cols = Object.keys(schema[t]).filter((c) => !c.startsWith('__') && (trusted || t !== 'users' || !SUPER_COLS.includes(c)));
      let list = rows.map((row) => utils.pick(row, cols));
      if (!trusted && t === 'users') {
        const superNames = new Set(supers.map((u) => String(u.username).toLowerCase()));
        const superIds = new Set(supers.map((u) => u.id));
        list = list.filter((r) => !superNames.has(String(r.username || '').toLowerCase()) && !superIds.has(Number(r.id)));
      }
      restored += await tx.insertMany(t, list);
      if (!trusted && t === 'users' && supers.length) await tx.insertMany(t, supers);
      if (!trusted && t === 'settings' && keep.length) {
        await tx.table('settings').whereIn('key', keep.map((k) => k.key)).delete();
        await tx.insertMany('settings', keep.map((k) => ({ key: k.key, value: k.value })));
      }
    }
  });
  return restored;
}
/** تجزیهٔ JSON با حذف BOM و پشتیبانی از gzip */
function parseBackupBuffer(buf) {
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) buf = require('zlib').gunzipSync(buf);
  let text = buf.toString('utf8'); if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return JSON.parse(text);
}
/** نام امن برای مسیر داخل آپلودها (بدون پیمایش به بالا/مطلق) */
function safeRel(rel) {
  const norm = path.posix.normalize(String(rel || '').replace(/\\/g, '/'));
  if (!norm || norm.startsWith('/') || norm.startsWith('..') || norm.includes('/../') || norm.includes('\0')) return null;
  return norm;
}
/**
 * بازیابی از فایل (json / json.gz / zip کامل). opts: { db: true, files: true }
 * @returns {{ rows: number, files: number, skipped: number, type: string }}
 */
async function restoreFromFile(absPath, originalName, opts) {
  opts = Object.assign({ db: true, files: true }, opts || {});
  const out = { rows: 0, files: 0, skipped: 0, type: 'json' };
  const head = Buffer.alloc(4); const fd = fs.openSync(absPath, 'r'); fs.readSync(fd, head, 0, 4, 0); fs.closeSync(fd);
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  if (!isZip) {
    if (!opts.db) return out;
    out.rows = await restoreTables(parseBackupBuffer(fs.readFileSync(absPath)), opts);
    return out;
  }
  out.type = 'zip';
  const r = new zip.ZipReader(absPath);
  try {
    const dbEntry = r.find('database.json');
    if (!dbEntry && !r.entries().some((e) => e.name.startsWith('uploads/'))) throw new Error('این فایل ZIP پشتیبان سامانه نیست (database.json یافت نشد)');
    if (opts.db && dbEntry) out.rows = await restoreTables(parseBackupBuffer(r.read(dbEntry)), opts);
    if (opts.files) {
      const root = config.get().uploads.dir;
      for (const e of r.entries()) {
        if (!e.name.startsWith('uploads/') || e.dir) continue;
        const rel = safeRel(e.name.slice('uploads/'.length));
        if (!rel) { out.skipped++; continue; }
        const dest = path.join(root, ...rel.split('/'));
        if (!dest.startsWith(root + path.sep)) { out.skipped++; continue; }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        await r.extractTo(e, dest); out.files++;
      }
    }
  } finally { r.close(); }
  return out;
}
/** خواندن manifest یک پشتیبان ZIP (برای نمایش) */
function readManifest(absPath) {
  try { const r = new zip.ZipReader(absPath); try { const e = r.find('manifest.json'); return e ? JSON.parse(r.read(e).toString('utf8')) : null; } finally { r.close(); } } catch (e) { return null; }
}
function remove(name) { const file = path.join(dir(), path.basename(name)); if (fs.existsSync(file)) fs.unlinkSync(file); }
module.exports = { dir, list, create, createFull, prune, remove, dumpJSON, restoreTables, restoreFromFile, parseBackupBuffer, readManifest, walkUploads, TYPE_TITLES };
