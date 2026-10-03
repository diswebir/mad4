'use strict';
/**
 * تعریف جدول‌ها با یک DSL ساده و همگام‌سازی خودکار با پایگاه داده (SQLite / MySQL)
 *
 * نمونه:
 *   users: { id: 'increments', username: 'string:60 unique notnull', role: 'string:20 index', __indexes: [['role','status']], __unique: [['a','b']] }
 */
const { quoteIdent } = require('./query');

function parseColumn(def) {
  const parts = def.trim().split(/\s+/);
  const typeSpec = parts.shift();
  const [type, arg] = typeSpec.split(':');
  const col = { type, arg, nullable: true, unique: false, index: false, default: undefined };
  for (const p of parts) {
    if (p === 'unique') col.unique = true;
    else if (p === 'index') col.index = true;
    else if (p === 'notnull') col.nullable = false;
    else if (p === 'nullable') col.nullable = true;
    else if (p.startsWith('default:')) col.default = p.slice(8);
  }
  return col;
}

function sqlType(col, dialect) {
  const t = col.type;
  if (dialect === 'mysql') {
    switch (t) {
      case 'increments': return 'INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY';
      case 'string': return `VARCHAR(${col.arg || 255})`;
      case 'text': return 'TEXT';
      case 'mediumtext': return 'MEDIUMTEXT';
      case 'integer': return 'INT';
      case 'bigint': return 'BIGINT';
      case 'decimal': return `DECIMAL(${col.arg || '10,2'})`;
      case 'float': return 'DOUBLE';
      case 'boolean': return 'TINYINT(1)';
      case 'date': return 'DATE';
      case 'datetime': return 'DATETIME';
      case 'time': return 'VARCHAR(8)';
      case 'json': return 'TEXT';
      default: throw new Error('نوع ستون ناشناخته: ' + t);
    }
  }
  switch (t) {
    case 'increments': return 'INTEGER PRIMARY KEY AUTOINCREMENT';
    case 'string': case 'text': case 'mediumtext': case 'date': case 'datetime': case 'time': case 'json': return 'TEXT';
    case 'integer': case 'bigint': case 'boolean': return 'INTEGER';
    case 'decimal': case 'float': return 'REAL';
    default: throw new Error('نوع ستون ناشناخته: ' + t);
  }
}

function defaultSql(col) {
  if (col.default === undefined) return '';
  if (col.default === 'null') return ' DEFAULT NULL';
  if (/^-?\d+(\.\d+)?$/.test(col.default)) return ' DEFAULT ' + col.default;
  return " DEFAULT '" + col.default.replace(/'/g, "''") + "'";
}

function columnDDL(name, col, dialect) {
  let sql = quoteIdent(name) + ' ' + sqlType(col, dialect);
  if (col.type === 'increments') return sql;
  if (!col.nullable) sql += ' NOT NULL';
  sql += defaultSql(col);
  return sql;
}

function createTableDDL(table, def, dialect) {
  const cols = [];
  const indexes = [];
  const uniques = [];
  for (const [name, raw] of Object.entries(def)) {
    if (name.startsWith('__')) continue;
    const col = parseColumn(raw);
    cols.push(columnDDL(name, col, dialect));
    if (col.index) indexes.push([name]);
    if (col.unique) uniques.push([name]);
  }
  (def.__indexes || []).forEach((ix) => indexes.push(ix));
  (def.__unique || []).forEach((ix) => uniques.push(ix));
  const stmts = [];
  if (dialect === 'mysql') {
    const inline = uniques.map((u) => `UNIQUE KEY ${quoteIdent('uq_' + table + '_' + u.join('_'))} (${u.map(quoteIdent).join(',')})`);
    const inlineIdx = indexes.map((ix) => `KEY ${quoteIdent('ix_' + table + '_' + ix.join('_'))} (${ix.map(quoteIdent).join(',')})`);
    stmts.push(`CREATE TABLE IF NOT EXISTS ${quoteIdent(table)} (\n  ${[...cols, ...inline, ...inlineIdx].join(',\n  ')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  } else {
    stmts.push(`CREATE TABLE IF NOT EXISTS ${quoteIdent(table)} (\n  ${cols.join(',\n  ')}\n)`);
    uniques.forEach((u) => stmts.push(`CREATE UNIQUE INDEX IF NOT EXISTS ${quoteIdent('uq_' + table + '_' + u.join('_'))} ON ${quoteIdent(table)} (${u.map(quoteIdent).join(',')})`));
    indexes.forEach((ix) => stmts.push(`CREATE INDEX IF NOT EXISTS ${quoteIdent('ix_' + table + '_' + ix.join('_'))} ON ${quoteIdent(table)} (${ix.map(quoteIdent).join(',')})`));
  }
  return stmts;
}

/**
 * همگام‌سازی: جدول‌های جدید ساخته و ستون‌های جدید اضافه می‌شوند (بدون حذف داده).
 */
async function sync(db, schema, log) {
  const dialect = db.dialect;
  const created = [];
  const altered = [];
  for (const [table, def] of Object.entries(schema)) {
    const exists = await db.tableExists(table);
    if (!exists) {
      for (const stmt of createTableDDL(table, def, dialect)) await db.exec(stmt);
      created.push(table);
      continue;
    }
    const existing = await db.columns(table);
    for (const [name, raw] of Object.entries(def)) {
      if (name.startsWith('__') || existing.includes(name)) continue;
      const col = parseColumn(raw);
      await db.exec(`ALTER TABLE ${quoteIdent(table)} ADD COLUMN ${columnDDL(name, col, dialect)}`);
      if (col.index) {
        const ixName = quoteIdent('ix_' + table + '_' + name);
        try { await db.exec(dialect === 'mysql' ? `CREATE INDEX ${ixName} ON ${quoteIdent(table)} (${quoteIdent(name)})` : `CREATE INDEX IF NOT EXISTS ${ixName} ON ${quoteIdent(table)} (${quoteIdent(name)})`); } catch (e) { /* ignore */ }
      }
      altered.push(table + '.' + name);
    }
  }
  if (log && (created.length || altered.length)) log(`[schema] created: ${created.length} tables, added: ${altered.length} columns`);
  return { created, altered };
}

async function dropAll(db, schema) {
  const tables = Object.keys(schema).reverse();
  if (db.dialect === 'mysql') await db.exec('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of tables) await db.exec(`DROP TABLE IF EXISTS ${quoteIdent(t)}`);
  if (db.dialect === 'mysql') await db.exec('SET FOREIGN_KEY_CHECKS = 1');
}

module.exports = { parseColumn, createTableDDL, sync, dropAll };
