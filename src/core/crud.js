'use strict';
/**
 * سازندهٔ عمومی صفحات CRUD (فهرست + جستجو + فیلتر + صفحه‌بندی، ایجاد، ویرایش، حذف، خروجی CSV)
 * برای موجودیت‌های ساده استفاده می‌شود تا کد تکراری نوشته نشود.
 */
const db = require('./db');
const utils = require('./utils');
const J = require('./jalali');
const validate = require('./validate');
const activity = require('./activity');
const modules = require('./modules');
const { requireRole } = require('./auth');
const upload = require('./upload');

async function resolveOptions(field, req, row) {
  let opts = field.options;
  if (typeof opts === 'function') opts = await opts(req, row);
  if (!opts) return [];
  if (Array.isArray(opts)) return opts.map((o) => (typeof o === 'object' ? o : { value: o, label: o }));
  return Object.entries(opts).map(([value, label]) => ({ value, label }));
}

function formatValue(field, row, optionMaps) {
  const v = row[field.name];
  if (field.format) return field.format(v, row);
  if (v == null || v === '') return '<span class="text-muted">—</span>';
  switch (field.type) {
    case 'select': case 'radio': { const m = optionMaps[field.name] || {}; return utils.escapeHtml(m[String(v)] !== undefined ? m[String(v)] : v); }
    case 'checkbox': return Number(v) ? '<span class="badge text-bg-success">بله</span>' : '<span class="badge text-bg-secondary">خیر</span>';
    case 'date': return J.formatDate(v);
    case 'datetime': return J.formatDateTime(v);
    case 'number': return field.money ? utils.money(v) : utils.num(v);
    case 'time': return J.formatTime(v);
    case 'textarea': return utils.escapeHtml(utils.truncate(v, 60));
    case 'color': return `<span class="d-inline-block rounded border" style="width:18px;height:18px;background:${utils.escapeHtml(v)}"></span>`;
    default: return utils.escapeHtml(J.toPersianDigits(v));
  }
}

const colCache = new Map();
async function hasColumn(table, col) {
  if (!colCache.has(table)) { try { colCache.set(table, new Set((await db.columns(table)).map((c) => c.name || c))); } catch (e) { colCache.set(table, new Set()); } }
  return colCache.get(table).has(col);
}

function crud(router, cfg) {
  const base = cfg.path || '';
  const manageRoles = cfg.roles || ['admin'];
  const viewRoles = cfg.viewRoles || manageRoles;
  const fields = cfg.fields;
  const perPage = cfg.perPage || 20;
  const guards = [requireRole(...viewRoles)];
  if (cfg.feature) guards.push(modules.requireEnabled(cfg.feature));
  const manageGuards = [requireRole(...manageRoles)];
  if (cfg.feature) manageGuards.push(modules.requireEnabled(cfg.feature));
  const fileFields = cfg.fields.filter((f) => f.type === 'file');
  const bodyParsers = fileFields.length ? upload.form(cfg.uploadFolder || cfg.table, 'fields', fileFields.map((f) => ({ name: f.name, maxCount: 1 })), { images: fileFields.every((f) => f.images), maxMb: cfg.maxMb }) : upload.none();
  const postGuards = [...manageGuards, ...bodyParsers];
  const canManage = (req) => manageRoles.includes(req.user.role);
  const urlBase = (req) => req.baseUrl + base;

  const listFields = fields.filter((f) => f.list);
  const searchFields = fields.filter((f) => f.search).map((f) => (f.searchColumn || (cfg.alias ? cfg.alias + '.' : '') + f.name));
  const filterFields = fields.filter((f) => f.filter);
  const dateFields = fields.filter((f) => f.type === 'date').map((f) => f.name);
  const numberFields = fields.filter((f) => f.type === 'number').map((f) => f.name);
  const boolFields = fields.filter((f) => f.type === 'checkbox').map((f) => f.name);

  async function optionMaps(req, row) {
    const maps = {};
    for (const f of fields) {
      if (['select', 'radio', 'multiselect'].includes(f.type)) {
        const opts = await resolveOptions(f, req, row);
        maps[f.name] = Object.fromEntries(opts.map((o) => [String(o.value), o.label]));
        f._resolved = opts;
      }
    }
    return maps;
  }

  function baseQuery(req) {
    let q = db.table(cfg.alias ? `${cfg.table} as ${cfg.alias}` : cfg.table);
    if (cfg.query) q = cfg.query(q, req) || q;
    return q;
  }

  // فهرست
  router.get(base + '/', ...guards, async (req, res) => {
    const maps = await optionMaps(req);
    const q = baseQuery(req);
    const search = utils.normalizePersian(req.query.q || '');
    if (search && searchFields.length) q.search(search, searchFields);
    const activeFilters = {};
    for (const f of filterFields) {
      const val = req.query['f_' + f.name];
      if (val !== undefined && val !== '') { activeFilters[f.name] = val; q.where((cfg.alias ? cfg.alias + '.' : '') + f.name, val); }
    }
    if (cfg.filterHook) cfg.filterHook(q, req);
    const sort = fields.find((f) => f.name === req.query.sort) ? req.query.sort : (cfg.orderBy || 'id');
    const dir = req.query.dir === 'asc' || req.query.dir === 'desc' ? req.query.dir : (cfg.dir || (cfg.orderBy ? 'asc' : 'desc'));
    q.orderBy((cfg.alias && !sort.includes('.') ? cfg.alias + '.' : '') + sort, dir);
    const result = await q.paginate(req.query.page, req.query.per || perPage);
    const extra = cfg.listData ? await cfg.listData(req, result.data) : {};
    res.render('crud/list', Object.assign({
      title: cfg.plural, crud: cfg, fields, listFields, filterFields, maps, result, search, activeFilters, sort, dir,
      canManage: canManage(req), urlBase: urlBase(req), formatValue: (f, row) => formatValue(f, row, maps),
      rowActions: cfg.rowActions ? (row) => cfg.rowActions(row, req) : null, pageActions: cfg.pageActions ? cfg.pageActions(req) : []
    }, extra));
  });

  // خروجی CSV
  if (cfg.exportable !== false) {
    router.get(base + '/export', ...guards, async (req, res) => {
      if (cfg.exportFeature && !modules.isEnabled(cfg.exportFeature)) return res.status(404).send('غیرفعال');
      const maps = await optionMaps(req);
      const rows = await baseQuery(req).orderBy((cfg.alias ? cfg.alias + '.' : '') + (cfg.orderBy || 'id')).limit(5000).all();
      const cols = (cfg.exportFields || listFields).map((f) => ({ label: f.label, value: (r) => { const v = r[f.name]; if (f.type === 'select') return (maps[f.name] || {})[String(v)] || v; if (f.type === 'date') return J.toJalali(v); if (f.type === 'checkbox') return Number(v) ? 'بله' : 'خیر'; return v; } }));
      await activity.log(req, 'export', cfg.table, null, 'خروجی ' + cfg.plural);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${cfg.table}-${J.todayISO()}.csv"`);
      res.send(utils.toCSV(rows, cols));
    });
  }

  // فرم ایجاد
  router.get(base + '/new', ...manageGuards, async (req, res) => {
    if (cfg.canCreate === false) return res.redirect(urlBase(req));
    await optionMaps(req);
    const defaults = Object.assign({}, cfg.defaults ? (typeof cfg.defaults === 'function' ? await cfg.defaults(req) : cfg.defaults) : {}, req.query);
    res.render('crud/form', { title: 'افزودن ' + cfg.title, crud: cfg, fields, row: defaults, isNew: true, urlBase: urlBase(req), action: urlBase(req) });
  });

  function collect(req, row) {
    const names = fields.filter((f) => !f.readonly && !f.virtual && !['file', 'heading', 'html', 'info'].includes(f.type)).map((f) => f.name);
    const data = utils.cleanBody(req.body, { fields: names, dates: dateFields, numbers: numberFields, booleans: boolFields });
    for (const f of fields) if (f.type === 'multiselect') { const v = req.body[f.name]; data[f.name] = v ? (Array.isArray(v) ? v : [v]).join(',') : null; }
    for (const f of fileFields) {
      const up = req.files && req.files[f.name] && req.files[f.name][0];
      if (up) { if (row && row[f.name]) upload.removeFile(row[f.name]); data[f.name] = upload.relPath(up); }
      else if (req.body['remove_' + f.name] === '1' && row && row[f.name]) { upload.removeFile(row[f.name]); data[f.name] = null; }
    }
    return data;
  }
  function validateData(data, req) {
    const v = validate(data);
    for (const f of fields) {
      if (f.virtual) continue;
      if (f.required) v.required(f.name, f.label);
      if (f.type === 'date') v.date(f.name, f.label);
      if (f.type === 'number') v.number(f.name, f.label, f.min, f.max);
      if (f.type === 'email') v.email(f.name, f.label);
      if (f.type === 'tel' && f.mobile) v.mobile(f.name, f.label);
      if (f.nationalId) v.nationalId(f.name, f.label);
      if (f.maxLength) v.maxLen(f.name, f.maxLength, f.label);
    }
    if (cfg.validate) cfg.validate(v, data, req);
    return v;
  }

  router.post(base + '/', ...postGuards, async (req, res) => {
    if (cfg.canCreate === false) return res.redirect(urlBase(req));
    if (req.uploadError) { req.flash('danger', req.uploadError); req.keepInput(); return res.redirect(urlBase(req) + '/new'); }
    let data = collect(req);
    const v = validateData(data, req);
    if (!v.ok) { req.flash('danger', v.message); req.keepInput(); return res.redirect(urlBase(req) + '/new'); }
    try {
      if (cfg.beforeSave) data = (await cfg.beforeSave(data, req, true)) || data;
      if (cfg.timestamps !== false && await hasColumn(cfg.table, 'created_at')) data.created_at = db.now();
      const id = await db.insert(cfg.table, data);
      if (cfg.afterSave) await cfg.afterSave(id, data, req, true);
      await activity.log(req, 'create', cfg.table, id, `${cfg.title}: ${data[cfg.labelField || 'title'] || id}`);
      req.flash('success', `${cfg.title} با موفقیت ثبت شد.`);
      res.redirect(cfg.afterSaveRedirect ? cfg.afterSaveRedirect(id, req) : urlBase(req));
    } catch (e) {
      req.flash('danger', friendlyError(e)); req.keepInput(); res.redirect(urlBase(req) + '/new');
    }
  });

  router.get(base + '/:id/edit', ...manageGuards, async (req, res) => {
    const row = await baseQuery(req).where((cfg.alias ? cfg.alias + '.' : '') + 'id', req.params.id).first();
    if (!row) return res.status(404).render('errors/404', { title: 'یافت نشد' });
    await optionMaps(req, row);
    res.render('crud/form', { title: 'ویرایش ' + cfg.title, crud: cfg, fields, row, isNew: false, urlBase: urlBase(req), action: urlBase(req) + '/' + row.id });
  });

  router.post(base + '/:id', ...postGuards, async (req, res) => {
    const row = await baseQuery(req).where((cfg.alias ? cfg.alias + '.' : '') + 'id', req.params.id).first();
    if (!row) return res.status(404).render('errors/404', { title: 'یافت نشد' });
    if (req.uploadError) { req.flash('danger', req.uploadError); req.keepInput(); return res.redirect(urlBase(req) + '/' + row.id + '/edit'); }
    let data = collect(req, row);
    const v = validateData(data, req);
    if (!v.ok) { req.flash('danger', v.message); req.keepInput(); return res.redirect(urlBase(req) + '/' + row.id + '/edit'); }
    try {
      if (cfg.beforeSave) data = (await cfg.beforeSave(data, req, false, row)) || data;
      if (cfg.timestamps !== false && await hasColumn(cfg.table, 'updated_at')) data.updated_at = db.now();
      await db.update(cfg.table, data, { id: row.id });
      if (cfg.afterSave) await cfg.afterSave(row.id, data, req, false, row);
      await activity.log(req, 'update', cfg.table, row.id, `${cfg.title}: ${data[cfg.labelField || 'title'] || row.id}`);
      req.flash('success', `${cfg.title} به‌روزرسانی شد.`);
      res.redirect(cfg.afterSaveRedirect ? cfg.afterSaveRedirect(row.id, req) : urlBase(req));
    } catch (e) {
      req.flash('danger', friendlyError(e)); req.keepInput(); res.redirect(urlBase(req) + '/' + row.id + '/edit');
    }
  });

  router.post(base + '/:id/delete', ...manageGuards, async (req, res) => {
    if (cfg.canDelete === false) return res.redirect(urlBase(req));
    const row = await db.findById(cfg.table, req.params.id);
    if (!row) return res.status(404).render('errors/404', { title: 'یافت نشد' });
    try {
      if (cfg.beforeDelete) { const r = await cfg.beforeDelete(row, req); if (r !== true && r !== undefined) { req.flash('danger', typeof r === 'string' ? r : 'امکان حذف وجود ندارد'); return res.redirect(urlBase(req)); } }
      await db.remove(cfg.table, { id: row.id });
      if (cfg.afterDelete) await cfg.afterDelete(row, req);
      await activity.log(req, 'delete', cfg.table, row.id, `${cfg.title}: ${row[cfg.labelField || 'title'] || row.id}`);
      req.flash('success', `${cfg.title} حذف شد.`);
    } catch (e) { req.flash('danger', friendlyError(e)); }
    res.redirect(req.get('referer') && !req.get('referer').includes('/edit') ? req.get('referer') : urlBase(req));
  });
}

function friendlyError(e) {
  const msg = String(e && e.message || e);
  if (/UNIQUE|Duplicate/i.test(msg)) return 'مقدار تکراری است؛ این رکورد قبلاً ثبت شده است.';
  return 'خطا: ' + msg;
}

module.exports = crud;
module.exports.formatValue = formatValue;
module.exports.resolveOptions = resolveOptions;
module.exports.friendlyError = friendlyError;
