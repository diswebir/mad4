'use strict';
/**
 * درایور MySQL / MariaDB بر پایه mysql2 (استخر اتصال)
 */
class MysqlDriver {
  constructor(cfg) {
    const mysql = require('mysql2/promise');
    this.dialect = 'mysql';
    this.name = 'mysql2';
    this.cfg = cfg;
    this.pool = mysql.createPool({
      host: cfg.host, port: cfg.port || 3306, user: cfg.user, password: cfg.password, database: cfg.database,
      charset: 'utf8mb4', dateStrings: true, decimalNumbers: true, supportBigNumbers: true, bigNumberStrings: false,
      waitForConnections: true, connectionLimit: 8, queueLimit: 0, timezone: 'Z', multipleStatements: false
    });
  }
  normalizeParams(params) {
    if (!params) return [];
    return params.map((p) => {
      if (p === undefined || (typeof p === 'number' && Number.isNaN(p))) return null;
      if (typeof p === 'boolean') return p ? 1 : 0;
      if (typeof p === 'object' && p !== null && !(p instanceof Date) && !Buffer.isBuffer(p)) return JSON.stringify(p);
      return p;
    });
  }
  async init() {
    const conn = await this.pool.getConnection();
    try { await conn.query("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci"); } finally { conn.release(); }
    return this;
  }
  _wrap(executor) {
    const self = this;
    return {
      dialect: 'mysql',
      async all(sql, params) { const [rows] = await executor.query(sql, self.normalizeParams(params)); return rows; },
      async get(sql, params) { const [rows] = await executor.query(sql, self.normalizeParams(params)); return rows[0]; },
      async run(sql, params) { const [r] = await executor.query(sql, self.normalizeParams(params)); return { insertId: r.insertId || 0, changes: r.affectedRows || 0 }; },
      async exec(sql) {
        const statements = sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);
        for (const st of statements) await executor.query(st);
      }
    };
  }
  async all(sql, params) { return this._wrap(this.pool).all(sql, params); }
  async get(sql, params) { return this._wrap(this.pool).get(sql, params); }
  async run(sql, params) { return this._wrap(this.pool).run(sql, params); }
  async exec(sql) { return this._wrap(this.pool).exec(sql); }
  async transaction(fn) {
    const conn = await this.pool.getConnection();
    const tx = this._wrap(conn);
    tx.transaction = async (f) => f(tx);
    try {
      await conn.beginTransaction();
      const result = await fn(tx);
      await conn.commit();
      return result;
    } catch (err) {
      try { await conn.rollback(); } catch (e) { /* ignore */ }
      throw err;
    } finally { conn.release(); }
  }
  async tableExists(name) {
    const row = await this.get('SELECT TABLE_NAME AS t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?', [name]);
    return !!row;
  }
  async columns(table) {
    const rows = await this.all('SELECT COLUMN_NAME AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?', [table]);
    return rows.map((r) => r.c);
  }
  async close() { await this.pool.end(); }
}
module.exports = MysqlDriver;
