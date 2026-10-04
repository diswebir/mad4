'use strict';
/**
 * لایهٔ دسترسی به پایگاه داده
 * - پشتیبانی از MySQL/MariaDB (mysql2) و SQLite (better-sqlite3 → node:sqlite → sql.js)
 * - API یکسان: db.table('x').where(...).all() | db.insert | db.update | db.remove | db.raw | db.transaction
 */
const fs = require('fs');
const path = require('path');
const { QueryBuilder, Raw, ident, quoteIdent } = require('./query');

const state = { driver: null, info: null };

function detectSqliteDrivers() {
  const list = [];
  try { require.resolve('better-sqlite3'); list.push('better-sqlite3'); } catch (e) { /* not available */ }
  try {
    const { DatabaseSync } = require('node:sqlite');
    if (DatabaseSync) list.push('node:sqlite');
  } catch (e) { /* not available */ }
  try { require.resolve('sql.js'); list.push('sql.js'); } catch (e) { /* not available */ }
  return list;
}

function mysqlAvailable() {
  try { require.resolve('mysql2/promise'); return true; } catch (e) { return false; }
}

async function createDriver(cfg) {
  if (cfg.client === 'mysql') {
    const MysqlDriver = require('./drivers/mysql');
    const d = new MysqlDriver(cfg);
    await d.init();
    return d;
  }
  const filename = cfg.filename;
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const available = detectSqliteDrivers();
  const preferred = cfg.sqliteDriver && available.includes(cfg.sqliteDriver) ? [cfg.sqliteDriver, ...available] : available;
  let lastErr = null;
  for (const name of preferred) {
    try {
      if (name === 'better-sqlite3') return new (require('./drivers/sqlite-better'))(filename);
      if (name === 'node:sqlite') return new (require('./drivers/sqlite-node'))(filename);
      if (name === 'sql.js') return await new (require('./drivers/sqlite-sqljs'))(filename).init();
    } catch (e) { lastErr = e; }
  }
  throw new Error('هیچ درایور SQLite در دسترس نیست' + (lastErr ? ': ' + lastErr.message : ''));
}

const api = {
  Raw, ident, quoteIdent,
  raw(sql, params) { return new Raw(sql, params); },
  get driver() { return state.driver; },
  get dialect() { return state.driver ? state.driver.dialect : null; },
  /** عبارت الحاق رشته‌ها سازگار با هر دو پایگاه: concat('s.first_name', "' '", 's.last_name') → SQLite: (a || ' ' || b)، MySQL: CONCAT(a, ' ', b) */
  concat(...parts) { return (state.driver && state.driver.dialect === 'mysql') ? `CONCAT(${parts.join(', ')})` : `(${parts.join(' || ')})`; },
  get info() { return state.info; },
  isReady() { return !!state.driver; },
  detectSqliteDrivers, mysqlAvailable,

  /** اتصال (یا اتصال مجدد) با پیکربندی داده‌شده */
  async connect(cfg) {
    if (state.driver) { try { await state.driver.close(); } catch (e) { /* ignore */ } }
    state.driver = await createDriver(cfg);
    state.info = { client: cfg.client, driver: state.driver.name, dialect: state.driver.dialect, filename: cfg.client === 'sqlite' ? cfg.filename : undefined, database: cfg.database };
    return state.driver;
  },
  async close() { if (state.driver) { await state.driver.close(); state.driver = null; } },

  /** آزمایش اتصال بدون تغییر اتصال فعلی */
  async test(cfg) {
    const d = await createDriver(cfg);
    try { await d.get('SELECT 1 AS ok'); return { ok: true, driver: d.name }; } finally { await d.close(); }
  },

  table(name, driver) { return new QueryBuilder(driver || state.driver, name); },
  from(name, driver) { return new QueryBuilder(driver || state.driver, name); },
  async all(sql, params) { return state.driver.all(sql, params); },
  async get(sql, params) { return state.driver.get(sql, params); },
  async run(sql, params) { return state.driver.run(sql, params); },
  async exec(sql) { return state.driver.exec(sql); },
  async transaction(fn) {
    return state.driver.transaction((tx) => fn(wrapTx(tx)));
  },
  async insert(table, data) { return new QueryBuilder(state.driver, table).insert(data); },
  async insertMany(table, rows) { return new QueryBuilder(state.driver, table).insertMany(rows); },
  async update(table, data, where) { const q = new QueryBuilder(state.driver, table); if (where) q.where(where); return q.update(data); },
  async remove(table, where) { const q = new QueryBuilder(state.driver, table); if (where) q.where(where); return q.delete(); },
  async findOne(table, where) { return new QueryBuilder(state.driver, table).where(where).first(); },
  async findById(table, id) { if (id == null || id === '' || Number.isNaN(Number(id))) return null; return new QueryBuilder(state.driver, table).where('id', id).first(); },
  async findMany(table, where, opts) {
    const q = new QueryBuilder(state.driver, table);
    if (where) q.where(where);
    if (opts && opts.orderBy) q.orderBy(opts.orderBy, opts.dir);
    if (opts && opts.limit) q.limit(opts.limit);
    return q.all();
  },
  async count(table, where) { const q = new QueryBuilder(state.driver, table); if (where) q.where(where); return q.count(); },
  async exists(table, where) { return new QueryBuilder(state.driver, table).where(where).exists(); },
  async upsert(table, where, data) {
    const row = await this.findOne(table, where);
    if (row) { await this.update(table, data, where); return row.id; }
    return this.insert(table, Object.assign({}, where, data));
  },
  async tableExists(name) { return state.driver.tableExists(name); },
  async columns(name) { return state.driver.columns(name); },
  now() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
};

/** ساخت API مشابه برای یک تراکنش */
function wrapTx(tx) {
  return {
    dialect: tx.dialect,
    table: (name) => new QueryBuilder(tx, name),
    all: (sql, p) => tx.all(sql, p), get: (sql, p) => tx.get(sql, p), run: (sql, p) => tx.run(sql, p), exec: (sql) => tx.exec(sql),
    insert: (table, data) => new QueryBuilder(tx, table).insert(data),
    insertMany: (table, rows) => new QueryBuilder(tx, table).insertMany(rows),
    update: (table, data, where) => { const q = new QueryBuilder(tx, table); if (where) q.where(where); return q.update(data); },
    remove: (table, where) => { const q = new QueryBuilder(tx, table); if (where) q.where(where); return q.delete(); },
    findOne: (table, where) => new QueryBuilder(tx, table).where(where).first(),
    findById: (table, id) => (id == null || id === '' || Number.isNaN(Number(id))) ? Promise.resolve(null) : new QueryBuilder(tx, table).where('id', id).first(),
    count: (table, where) => { const q = new QueryBuilder(tx, table); if (where) q.where(where); return q.count(); },
    now: api.now
  };
}

module.exports = api;
