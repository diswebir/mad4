'use strict';
/** پشتیبان‌گیری: ساخت فایل (sqlite یا JSON)، فهرست و هرس نسخه‌های قدیمی */
const path = require('path');
const fs = require('fs');
const db = require('./db');
const config = require('./config');
const J = require('./jalali');
const schema = require('../../database/schema');
const pkg = require('../../package.json');

function dir() { const d = path.join(config.get().storage, 'backups'); fs.mkdirSync(d, { recursive: true }); return d; }
function list() {
  return fs.readdirSync(dir()).filter((f) => /\.(json|sqlite)$/.test(f)).map((f) => { const st = fs.statSync(path.join(dir(), f)); return { name: f, size: st.size, mtime: st.mtime.toISOString().slice(0, 19).replace('T', ' ') }; }).sort((a, b) => b.name.localeCompare(a.name));
}
/** @param {'file'|'json'} type  @param {string} [prefix] */
async function create(type, prefix) {
  const stamp = J.nowISO().replace(/[: ]/g, '-');
  const base = prefix || 'backup';
  let name;
  if (db.info.client === 'sqlite' && type === 'file') {
    if (db.driver.saveNow) db.driver.saveNow();
    name = `${base}-${stamp}.sqlite`;
    fs.copyFileSync(db.info.filename, path.join(dir(), name));
  } else {
    name = `${base}-${stamp}.json`;
    const out = { version: pkg.version, created_at: J.nowISO(), dialect: db.dialect, tables: {} };
    for (const t of Object.keys(schema)) { if (t === 'sessions') continue; out.tables[t] = await db.table(t).all(); }
    fs.writeFileSync(path.join(dir(), name), JSON.stringify(out));
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
function remove(name) { const file = path.join(dir(), path.basename(name)); if (fs.existsSync(file)) fs.unlinkSync(file); }
module.exports = { dir, list, create, prune, remove };
