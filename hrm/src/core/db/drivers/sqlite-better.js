'use strict';
const SqliteBase = require('./sqlite-base');

class BetterSqliteDriver extends SqliteBase {
  constructor(filename) {
    super();
    const Database = require('better-sqlite3');
    this.name = 'better-sqlite3';
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this._cache = new Map();
  }
  _stmt(sql) {
    let s = this._cache.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      if (this._cache.size > 500) this._cache.clear();
      this._cache.set(sql, s);
    }
    return s;
  }
  _all(sql, params) { return this._stmt(sql).all(...params); }
  _get(sql, params) { return this._stmt(sql).get(...params); }
  _run(sql, params) {
    const r = this._stmt(sql).run(...params);
    return { insertId: Number(r.lastInsertRowid), changes: r.changes };
  }
  _exec(sql) { this.db.exec(sql); }
  async close() { this.db.close(); }
}
module.exports = BetterSqliteDriver;
