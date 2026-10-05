'use strict';
/**
 * درایور sql.js (SQLite روی WebAssembly) — بدون نیاز به کامپایل بومی.
 * پایگاه داده در حافظه نگه داشته می‌شود و پس از هر تغییر، با تأخیر کوتاه روی دیسک ذخیره می‌شود.
 */
const fs = require('fs');
const path = require('path');
const SqliteBase = require('./sqlite-base');

class SqlJsDriver extends SqliteBase {
  constructor(filename) {
    super();
    this.name = 'sql.js';
    this.filename = filename;
    this._dirty = false;
    this._timer = null;
  }
  async init() {
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();
    let buffer;
    if (fs.existsSync(this.filename)) buffer = fs.readFileSync(this.filename);
    this.db = new SQL.Database(buffer);
    this._applyPragmas();
    const flush = () => { try { this.saveNow(); } catch (e) { /* ignore */ } };
    process.on('exit', flush);
    process.on('SIGINT', () => { flush(); process.exit(0); });
    process.on('SIGTERM', () => { flush(); process.exit(0); });
    return this;
  }
  _applyPragmas() { this.db.exec('PRAGMA foreign_keys = ON'); }
  _all(sql, params) {
    const stmt = this.db.prepare(sql);
    try {
      if (params && params.length) stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally { stmt.free(); }
  }
  _get(sql, params) { return this._all(sql, params)[0]; }
  _run(sql, params) {
    this.db.run(sql, params);
    const changes = this.db.getRowsModified();
    const res = this.db.exec('SELECT last_insert_rowid() AS id');
    const insertId = res.length && res[0].values.length ? Number(res[0].values[0][0]) : 0;
    this._markDirty();
    return { insertId, changes };
  }
  _exec(sql) {
    this.db.exec(sql);
    const head = sql.trim().slice(0, 6).toUpperCase();
    if (!['BEGIN', 'COMMIT', 'ROLLBA', 'PRAGMA', 'SELECT'].includes(head)) this._markDirty();
  }
  _markDirty() {
    this._dirty = true;
    if (this._txActive) return; // پس از پایان تراکنش ذخیره می‌شود
    this._schedule();
  }
  _afterTx() { if (this._dirty) this._schedule(); }
  _schedule() {
    if (this._timer) return;
    this._timer = setTimeout(() => { this._timer = null; try { this.saveNow(); } catch (e) { console.error('[sql.js] save failed:', e.message); } }, 400);
    if (this._timer.unref) this._timer.unref();
  }
  saveNow() {
    if (!this._dirty || this._txActive) return;
    const data = this.db.export(); // توجه: export پایگاه را می‌بندد و دوباره باز می‌کند
    this._applyPragmas();
    fs.mkdirSync(path.dirname(this.filename), { recursive: true });
    const tmp = this.filename + '.tmp';
    fs.writeFileSync(tmp, Buffer.from(data));
    fs.renameSync(tmp, this.filename);
    this._dirty = false;
  }
  async close() { this.saveNow(); this.db.close(); }
}
module.exports = SqlJsDriver;
