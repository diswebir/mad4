'use strict';
const SqliteBase = require('./sqlite-base');

class NodeSqliteDriver extends SqliteBase {
  constructor(filename) {
    super();
    const { DatabaseSync } = require('node:sqlite');
    this.name = 'node:sqlite';
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA busy_timeout = 5000');
  }
  _all(sql, params) { return this.db.prepare(sql).all(...params).map(stripProto); }
  _get(sql, params) { const r = this.db.prepare(sql).get(...params); return r ? stripProto(r) : undefined; }
  _run(sql, params) {
    const r = this.db.prepare(sql).run(...params);
    return { insertId: Number(r.lastInsertRowid), changes: Number(r.changes) };
  }
  _exec(sql) { this.db.exec(sql); }
  async close() { this.db.close(); }
}
// node:sqlite رکوردها را با prototype تهی برمی‌گرداند؛ برای سازگاری با EJS/JSON به شیء معمولی تبدیل می‌کنیم
function stripProto(row) { return Object.assign({}, row); }
module.exports = NodeSqliteDriver;
