'use strict';
/**
 * سازندهٔ کوئری سبک و مستقل از دیالکت (SQLite / MySQL)
 */
const IDENT_RE = /^[A-Za-z_][\w]*(\.[A-Za-z_*][\w]*)?(\s+as\s+[A-Za-z_]\w*)?$/i;

function quoteIdent(name) {
  if (name === '*') return '*';
  const m = /^(.*?)\s+as\s+(\w+)$/i.exec(name);
  if (m) return quoteIdent(m[1]) + ' AS `' + m[2] + '`';
  return name.split('.').map((p) => (p === '*' ? '*' : '`' + p.replace(/`/g, '') + '`')).join('.');
}

function ident(name) {
  if (typeof name !== 'string') return String(name);
  const n = name.trim();
  return IDENT_RE.test(n) ? quoteIdent(n) : n; // عبارت‌های خام دست‌نخورده می‌مانند
}

class Raw { constructor(sql, params) { this.sql = sql; this.params = params || []; } }

class QueryBuilder {
  constructor(driver, table) {
    this.driver = driver;
    this._table = table;
    this._select = [];
    this._joins = [];
    this._wheres = [];
    this._orders = [];
    this._groups = [];
    this._having = [];
    this._limit = null;
    this._offset = null;
    this._distinct = false;
  }
  clone() {
    const q = new QueryBuilder(this.driver, this._table);
    q._select = [...this._select]; q._joins = [...this._joins]; q._wheres = [...this._wheres];
    q._orders = [...this._orders]; q._groups = [...this._groups]; q._having = [...this._having];
    q._limit = this._limit; q._offset = this._offset; q._distinct = this._distinct;
    return q;
  }
  select(...cols) { this._select.push(...cols.flat()); return this; }
  distinct() { this._distinct = true; return this; }
  join(table, a, b, type) { this._joins.push({ type: type || 'INNER', table, a, b }); return this; }
  leftJoin(table, a, b) { return this.join(table, a, b, 'LEFT'); }
  joinRaw(sql, params) { this._joins.push({ raw: sql, params: params || [] }); return this; }

  _addWhere(bool, col, op, val) {
    if (col instanceof Raw) { this._wheres.push({ bool, sql: col.sql, params: col.params }); return this; }
    if (typeof col === 'function') {
      const sub = new QueryBuilder(this.driver, this._table);
      col(sub);
      const built = sub._buildWhere(false);
      if (built.sql) this._wheres.push({ bool, sql: '(' + built.sql + ')', params: built.params });
      return this;
    }
    if (col && typeof col === 'object') {
      for (const [k, v] of Object.entries(col)) this._addWhere(bool, k, '=', v);
      return this;
    }
    if (op === undefined && val === undefined) { op = '='; val = null; }
    if (val === undefined && op !== undefined && !['=', '!=', '<>', '>', '<', '>=', '<=', 'like', 'LIKE', 'not like', 'NOT LIKE', 'in', 'not in', 'is', 'is not'].includes(op)) { val = op; op = '='; }
    if (val === null && (op === '=' || op === 'is')) { this._wheres.push({ bool, sql: ident(col) + ' IS NULL', params: [] }); return this; }
    if (val === null && (op === '!=' || op === '<>' || op === 'is not')) { this._wheres.push({ bool, sql: ident(col) + ' IS NOT NULL', params: [] }); return this; }
    if (typeof val === 'number' && Number.isNaN(val)) { this._wheres.push({ bool, sql: '1 = 0', params: [] }); return this; } // NaN (ورودی نامعتبر) با هیچ سطری برابر نیست؛ MySQL آن را ستون می‌پندارد
    this._wheres.push({ bool, sql: ident(col) + ' ' + op.toUpperCase() + ' ?', params: [val] });
    return this;
  }
  where(col, op, val) { return this._addWhere('AND', col, op, val); }
  orWhere(col, op, val) { return this._addWhere('OR', col, op, val); }
  whereRaw(sql, params) { this._wheres.push({ bool: 'AND', sql: '(' + sql + ')', params: params || [] }); return this; }
  orWhereRaw(sql, params) { this._wheres.push({ bool: 'OR', sql: '(' + sql + ')', params: params || [] }); return this; }
  whereIn(col, values) {
    if (values) values = values.filter((v) => !(typeof v === 'number' && Number.isNaN(v)));
    if (!values || !values.length) { this._wheres.push({ bool: 'AND', sql: '1 = 0', params: [] }); return this; }
    this._wheres.push({ bool: 'AND', sql: ident(col) + ' IN (' + values.map(() => '?').join(',') + ')', params: values });
    return this;
  }
  orWhereIn(col, values) {
    if (!values || !values.length) { this._wheres.push({ bool: 'OR', sql: '1 = 0', params: [] }); return this; }
    this._wheres.push({ bool: 'OR', sql: ident(col) + ' IN (' + values.map(() => '?').join(',') + ')', params: values });
    return this;
  }
  orWhereBetween(col, a, b) { this._wheres.push({ bool: 'OR', sql: ident(col) + ' BETWEEN ? AND ?', params: [a, b] }); return this; }
  whereNotIn(col, values) {
    if (!values || !values.length) return this;
    this._wheres.push({ bool: 'AND', sql: ident(col) + ' NOT IN (' + values.map(() => '?').join(',') + ')', params: values });
    return this;
  }
  whereNull(col) { this._wheres.push({ bool: 'AND', sql: ident(col) + ' IS NULL', params: [] }); return this; }
  orWhereNull(col) { this._wheres.push({ bool: 'OR', sql: ident(col) + ' IS NULL', params: [] }); return this; }
  orWhereNotNull(col) { this._wheres.push({ bool: 'OR', sql: ident(col) + ' IS NOT NULL', params: [] }); return this; }
  whereNotNull(col) { this._wheres.push({ bool: 'AND', sql: ident(col) + ' IS NOT NULL', params: [] }); return this; }
  whereBetween(col, a, b) { this._wheres.push({ bool: 'AND', sql: ident(col) + ' BETWEEN ? AND ?', params: [a, b] }); return this; }
  /** جستجوی متنی در چند ستون */
  search(term, cols) {
    if (!term || !cols || !cols.length) return this;
    const like = '%' + String(term).trim() + '%';
    this._wheres.push({ bool: 'AND', sql: '(' + cols.map((c) => ident(c) + ' LIKE ?').join(' OR ') + ')', params: cols.map(() => like) });
    return this;
  }
  when(cond, fn) { if (cond) fn(this, cond); return this; }
  orderBy(col, dir) { this._orders.push(ident(col) + ' ' + ((dir || 'asc').toUpperCase() === 'DESC' ? 'DESC' : 'ASC')); return this; }
  orderByRaw(sql) { this._orders.push(sql); return this; }
  groupBy(...cols) { this._groups.push(...cols.flat().map(ident)); return this; }
  having(sql, params) { this._having.push({ sql, params: params || [] }); return this; }
  limit(n) { this._limit = n; return this; }
  offset(n) { this._offset = n; return this; }

  _buildWhere(withKeyword) {
    if (!this._wheres.length) return { sql: '', params: [] };
    let sql = '';
    const params = [];
    this._wheres.forEach((w, i) => {
      sql += (i === 0 ? '' : ' ' + w.bool + ' ') + w.sql;
      params.push(...w.params);
    });
    return { sql: (withKeyword ? ' WHERE ' : '') + sql, params };
  }
  _buildJoins() {
    let sql = '';
    const params = [];
    for (const j of this._joins) {
      if (j.raw) { sql += ' ' + j.raw; params.push(...j.params); continue; }
      sql += ` ${j.type} JOIN ${ident(j.table)} ON ${ident(j.a)} = ${ident(j.b)}`;
    }
    return { sql, params };
  }
  toSelectSQL() {
    const cols = this._select.length ? this._select.map(ident).join(', ') : '*';
    let sql = `SELECT ${this._distinct ? 'DISTINCT ' : ''}${cols} FROM ${ident(this._table)}`;
    const params = [];
    const j = this._buildJoins(); sql += j.sql; params.push(...j.params);
    const w = this._buildWhere(true); sql += w.sql; params.push(...w.params);
    if (this._groups.length) sql += ' GROUP BY ' + this._groups.join(', ');
    if (this._having.length) { sql += ' HAVING ' + this._having.map((h) => h.sql).join(' AND '); this._having.forEach((h) => params.push(...h.params)); }
    if (this._orders.length) sql += ' ORDER BY ' + this._orders.join(', ');
    if (this._limit != null) sql += ' LIMIT ' + parseInt(this._limit, 10);
    if (this._offset != null) sql += ' OFFSET ' + parseInt(this._offset, 10);
    return { sql, params };
  }
  async all() { const { sql, params } = this.toSelectSQL(); return this.driver.all(sql, params); }
  async first() { this._limit = 1; const { sql, params } = this.toSelectSQL(); return this.driver.get(sql, params); }
  async pluck(col) { const rows = await this.select(col).all(); const key = col.includes(' as ') ? col.split(/\s+as\s+/i)[1] : col.split('.').pop(); return rows.map((r) => r[key]); }
  async count(col) {
    const q = this.clone();
    q._orders = []; q._limit = null; q._offset = null;
    if (q._groups.length) {
      const inner = q.toSelectSQL();
      const row = await this.driver.get(`SELECT COUNT(*) AS c FROM (${inner.sql}) AS sub`, inner.params);
      return Number(row ? row.c : 0);
    }
    q._select = [`COUNT(${col ? ident(col) : '*'}) AS c`];
    const { sql, params } = q.toSelectSQL();
    const row = await this.driver.get(sql, params);
    return Number(row ? row.c : 0);
  }
  async sum(col) {
    const q = this.clone(); q._select = [`COALESCE(SUM(${ident(col)}),0) AS s`]; q._orders = [];
    const { sql, params } = q.toSelectSQL();
    const row = await this.driver.get(sql, params);
    return Number(row ? row.s : 0);
  }
  async exists() { return (await this.clone().select('1').first()) !== undefined; }
  /** صفحه‌بندی */
  async paginate(page, perPage) {
    page = Math.max(1, parseInt(page, 10) || 1);
    perPage = Math.min(200, Math.max(1, parseInt(perPage, 10) || 20));
    const total = await this.count();
    const pages = Math.max(1, Math.ceil(total / perPage));
    if (page > pages) page = pages;
    const data = await this.clone().limit(perPage).offset((page - 1) * perPage).all();
    return { data, total, page, perPage, pages, from: total ? (page - 1) * perPage + 1 : 0, to: Math.min(total, page * perPage) };
  }
  async insert(data) {
    const rows = Array.isArray(data) ? data : [data];
    if (!rows.length) return 0;
    let lastId = 0;
    for (const row of rows) {
      const keys = Object.keys(row).filter((k) => row[k] !== undefined);
      const sql = `INSERT INTO ${ident(this._table)} (${keys.map(quoteIdent).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
      const r = await this.driver.run(sql, keys.map((k) => row[k]));
      lastId = r.insertId;
    }
    return lastId;
  }
  async update(data) {
    const keys = Object.keys(data).filter((k) => data[k] !== undefined);
    if (!keys.length) return 0;
    const w = this._buildWhere(true);
    const sql = `UPDATE ${ident(this._table)} SET ${keys.map((k) => quoteIdent(k) + ' = ?').join(', ')}${w.sql}`;
    const r = await this.driver.run(sql, [...keys.map((k) => data[k]), ...w.params]);
    return r.changes;
  }
  async increment(col, by) {
    const w = this._buildWhere(true);
    const r = await this.driver.run(`UPDATE ${ident(this._table)} SET ${quoteIdent(col)} = COALESCE(${quoteIdent(col)},0) + ?${w.sql}`, [by == null ? 1 : by, ...w.params]);
    return r.changes;
  }
  async delete() {
    const w = this._buildWhere(true);
    const r = await this.driver.run(`DELETE FROM ${ident(this._table)}${w.sql}`, w.params);
    return r.changes;
  }
}

module.exports = { QueryBuilder, Raw, ident, quoteIdent };
