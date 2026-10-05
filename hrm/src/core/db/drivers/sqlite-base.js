'use strict';
/**
 * کلاس پایه برای درایورهای SQLite (better-sqlite3 / node:sqlite / sql.js)
 * همه فراخوانی‌ها همگام هستند؛ تراکنش‌ها به‌صورت سریالی اجرا می‌شوند.
 */
class SqliteBase {
  constructor() {
    this.dialect = 'sqlite';
    this._txQueue = Promise.resolve();
    this._txActive = false;
    this._txDone = null;
  }

  normalizeParams(params) {
    if (!params) return [];
    return params.map((p) => {
      if (p === undefined) return null;
      if (typeof p === 'boolean') return p ? 1 : 0;
      if (p instanceof Date) return p.toISOString().slice(0, 19).replace('T', ' ');
      if (typeof p === 'object' && p !== null && !Buffer.isBuffer(p)) return JSON.stringify(p);
      return p;
    });
  }

  async _waitTx() {
    while (this._txActive) await this._txDone;
  }

  async all(sql, params) { await this._waitTx(); return this._all(sql, this.normalizeParams(params)); }
  async get(sql, params) { await this._waitTx(); return this._get(sql, this.normalizeParams(params)); }
  async run(sql, params) { await this._waitTx(); return this._run(sql, this.normalizeParams(params)); }
  async exec(sql) { await this._waitTx(); return this._exec(sql); }

  /** اجرای یک تابع در تراکنش. تراکنش‌ها پشت سر هم اجرا می‌شوند. */
  transaction(fn) {
    const self = this;
    const job = this._txQueue.then(async () => {
      let resolveDone;
      self._txActive = true;
      self._txDone = new Promise((r) => { resolveDone = r; });
      const tx = {
        dialect: 'sqlite',
        all: async (sql, p) => self._all(sql, self.normalizeParams(p)),
        get: async (sql, p) => self._get(sql, self.normalizeParams(p)),
        run: async (sql, p) => self._run(sql, self.normalizeParams(p)),
        exec: async (sql) => self._exec(sql),
        transaction: async (f) => f(tx)
      };
      try {
        self._exec('BEGIN');
        const result = await fn(tx);
        self._exec('COMMIT');
        return result;
      } catch (err) {
        try { self._exec('ROLLBACK'); } catch (e) { /* ignore */ }
        throw err;
      } finally {
        self._txActive = false;
        resolveDone();
        if (typeof self._afterTx === 'function') self._afterTx();
      }
    });
    // جلوگیری از شکستن صف در صورت خطا
    this._txQueue = job.catch(() => {});
    return job;
  }

  async tableExists(name) {
    const row = await this.get("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [name]);
    return !!row;
  }

  async columns(table) {
    const rows = await this.all(`PRAGMA table_info(\`${table}\`)`);
    return rows.map((r) => r.name);
  }

  async close() {}
}

module.exports = SqliteBase;
