'use strict';
const permissions = require('./permissions');
/**
 * رجیستری ماژول‌ها و قابلیت‌ها
 * هر ماژول در src/modules/<key>/index.js تعریف می‌شود و می‌تواند فعال/غیرفعال شود.
 * قابلیت‌های هر ماژول با کلید «module.feature» به‌صورت مستقل قابل فعال/غیرفعال‌سازی هستند.
 */
const fs = require('fs');
const path = require('path');
const db = require('./db');

const MODULES_DIR = path.join(__dirname, '..', 'modules');
const CATEGORIES = [
  { key: 'main', title: 'اصلی', icon: 'bi-house' },
  { key: 'people', title: 'افراد', icon: 'bi-people' },
  { key: 'academic', title: 'آموزش', icon: 'bi-mortarboard' },
  { key: 'communication', title: 'ارتباطات', icon: 'bi-chat-dots' },
  { key: 'services', title: 'خدمات و امور', icon: 'bi-briefcase' },
  { key: 'finance', title: 'مالی', icon: 'bi-cash-coin' },
  { key: 'system', title: 'سیستم', icon: 'bi-gear' }
];

const registry = { modules: [], byKey: new Map(), states: new Map(), loaded: false };

function loadManifests() {
  if (registry.loaded) return registry.modules;
  const dirs = fs.readdirSync(MODULES_DIR).filter((d) => fs.existsSync(path.join(MODULES_DIR, d, 'index.js')));
  for (const dir of dirs) {
    const manifest = require(path.join(MODULES_DIR, dir, 'index.js'));
    manifest.key = manifest.key || dir;
    manifest.dir = path.join(MODULES_DIR, dir);
    manifest.features = (manifest.features || []).map((f) => Object.assign({}, f, { fullKey: manifest.key + '.' + f.key }));
    manifest.menu = manifest.menu || [];
    manifest.order = manifest.order || 100;
    registry.modules.push(manifest);
    registry.byKey.set(manifest.key, manifest);
  }
  registry.modules.sort((a, b) => a.order - b.order);
  registry.loaded = true;
  return registry.modules;
}

async function loadStates() {
  registry.states.clear();
  if (!db.isReady()) return;
  const rows = await db.table('module_states').all();
  for (const r of rows) registry.states.set(r.key, !!Number(r.enabled));
}

function isEnabled(key) {
  if (!key) return true;
  const [modKey, featKey] = key.split('.');
  const mod = registry.byKey.get(modKey);
  if (!mod) return false;
  if (mod.core) { if (!featKey) return true; }
  const modState = registry.states.has(modKey) ? registry.states.get(modKey) : true;
  if (!modState && !mod.core) return false;
  if (!featKey) return true;
  const feat = mod.features.find((f) => f.key === featKey);
  if (!feat) return false;
  if (feat.locked) return true;
  if (registry.states.has(key)) return registry.states.get(key);
  return feat.default !== false;
}

async function setState(key, enabled) {
  const [modKey, featKey] = key.split('.');
  const mod = registry.byKey.get(modKey);
  if (!mod) throw new Error('ماژول یافت نشد');
  if (mod.core && !featKey) throw new Error('ماژول‌های هسته قابل غیرفعال‌سازی نیستند');
  if (featKey) {
    const feat = mod.features.find((f) => f.key === featKey);
    if (!feat) throw new Error('قابلیت یافت نشد');
    if (feat.locked) throw new Error('این قابلیت قابل غیرفعال‌سازی نیست');
  }
  await db.upsert('module_states', { key }, { enabled: enabled ? 1 : 0, updated_at: db.now() });
  registry.states.set(key, !!enabled);
  // غیرفعال‌کردن ماژول‌هایی که به این ماژول وابسته‌اند
  if (!featKey && !enabled) {
    for (const m of registry.modules) {
      if ((m.dependencies || []).includes(modKey) && isEnabled(m.key)) await setState(m.key, false);
    }
  }
}

/** میان‌افزار: اگر ماژول/قابلیت غیرفعال باشد صفحهٔ ۴۰۴ ماژول نمایش می‌دهد */
function requireEnabled(key) {
  return (req, res, next) => {
    if (isEnabled(key)) return next();
    const [modKey] = key.split('.');
    const mod = registry.byKey.get(modKey);
    res.status(404);
    if (req.xhr || (req.get('accept') || '').includes('application/json')) return res.json({ ok: false, error: 'این بخش غیرفعال است' });
    return res.render('errors/module-disabled', { title: 'بخش غیرفعال', moduleName: mod ? mod.name : key, featureKey: key });
  };
}

/** ساخت منوی کناری برای کاربر جاری */
function menuFor(user) {
  const groups = [];
  for (const cat of CATEGORIES) {
    const items = [];
    for (const mod of registry.modules) {
      if ((mod.category || 'main') !== cat.key) continue;
      if (!isEnabled(mod.key)) continue;
      for (const item of mod.menu) {
        if (item.roles && user && !item.roles.includes(user.role) && !(item.permission && permissions.can(user, item.permission))) continue;
        if (!item.roles && item.permission && !permissions.can(user, item.permission)) continue;
        if (item.feature && !isEnabled(mod.key + '.' + item.feature)) continue;
        const it = Object.assign({ module: mod.key, icon: item.icon || mod.icon }, item);
        if (user && user.role === 'parent' && /\sمن$/.test(it.title)) it.title = it.title.replace(/\sمن$/, ' فرزندم');
        items.push(it);
      }
    }
    if (items.length) groups.push({ key: cat.key, title: cat.title, icon: cat.icon, items });
  }
  return groups;
}

function allFeatures() {
  const list = [];
  for (const mod of registry.modules) for (const f of mod.features) list.push(Object.assign({ module: mod.key, moduleName: mod.name, enabled: isEnabled(f.fullKey) }, f));
  return list;
}
function stats() {
  const feats = allFeatures();
  return { modules: registry.modules.length, modulesEnabled: registry.modules.filter((m) => isEnabled(m.key)).length, features: feats.length, featuresEnabled: feats.filter((f) => f.enabled).length };
}

module.exports = {
  CATEGORIES, loadManifests, loadStates, isEnabled, setState, requireEnabled, menuFor, allFeatures, stats,
  get modules() { return registry.modules; },
  getModule(key) { return registry.byKey.get(key); }
};
