'use strict';
/**
 * به‌روزرسانی نسخه
 *  - state(): نسخهٔ فعلی/قبلی، وضعیت وابستگی‌ها، نیاز به npm install، آخرین اجرای به‌روزرسانی
 *  - applyPackage(zip): استخراج بستهٔ نسخهٔ جدید روی پوشهٔ برنامه (بدون دست‌زدن به storage/.env/node_modules)
 *  - run(): مراحل پس از آپلود: حالت نگهداری → npm install (در صورت نیاز) → همگام‌سازی جدول‌ها → ثبت نسخه → پاک‌سازی tmp → درخواست ری‌استارت
 *  - اجرای وب از طریق فرایند جدا (scripts/update.js) انجام می‌شود و گزارش در storage/logs/update.log نوشته می‌شود
 */
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const config = require('./config');
const maintenance = require('./maintenance');

const ROOT = config.ROOT;
const LOG_FILE = () => path.join(ROOT, 'storage', 'logs', 'update.log');
const STATE_FILE = () => path.join(ROOT, 'storage', 'update-state.json');
const SKIP_PREFIX = ['storage/', 'node_modules/', '.git/', 'tmp/', '.env', '.github/'];
const PROTECTED = ['storage/config.json', 'storage/installed.lock', '.env'];

function pkg() { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')); }
function cmpVersion(a, b) {
  const pa = String(a || '0').split(/[.-]/).map((x) => parseInt(x, 10) || 0), pb = String(b || '0').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0); }
  return 0;
}
function readState() { try { return JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8')); } catch (e) { return {}; } }
function writeState(patch) { const s = Object.assign(readState(), patch); try { fs.mkdirSync(path.dirname(STATE_FILE()), { recursive: true }); fs.writeFileSync(STATE_FILE(), JSON.stringify(s, null, 2)); } catch (e) { /* ignore */ } return s; }

/** وابستگی‌هایی که در node_modules نیستند */
function missingDeps() {
  const deps = Object.keys(pkg().dependencies || {});
  const out = [];
  for (const d of deps) { try { require.resolve(d + '/package.json', { paths: [ROOT] }); } catch (e) { try { require.resolve(d, { paths: [ROOT] }); } catch (e2) { out.push(d); } } }
  return out;
}
let npmCache = { at: 0, value: null };
function npmBin() {
  if (Date.now() - npmCache.at < 10 * 60 * 1000) return npmCache.value;
  npmCache = { at: Date.now(), value: findNpm() };
  return npmCache.value;
}
function findNpm() {
  const cands = [path.join(path.dirname(process.execPath), 'npm'), path.join(path.dirname(process.execPath), 'npm.cmd'), 'npm'];
  for (const c of cands) { try { if (c === 'npm' || fs.existsSync(c)) { const r = spawnSync(c, ['--version'], { cwd: ROOT, timeout: 15000, encoding: 'utf8' }); if (r.status === 0) return { bin: c, version: String(r.stdout || '').trim() }; } } catch (e) { /* next */ } }
  return null;
}
function lockHash() { try { const crypto = require('crypto'); return crypto.createHash('sha1').update(fs.readFileSync(path.join(ROOT, 'package-lock.json'))).digest('hex').slice(0, 12); } catch (e) { return null; } }

function state(settings) {
  const p = pkg(); const st = readState();
  const missing = missingDeps();
  const lock = lockHash();
  const running = st.running && st.startedAt && Date.now() - new Date(st.startedAt).getTime() < 30 * 60 * 1000;
  return {
    name: p.name, version: p.version, lastVersion: settings ? settings.get('app_version', '') : st.lastVersion || '', updatedAt: st.finishedAt || null, lastStatus: st.status || null, lastMessage: st.message || null,
    running: !!running, startedAt: st.startedAt || null, missingDeps: missing, needsInstall: missing.length > 0 || (lock && st.lockHash && st.lockHash !== lock), lockHash: lock, passenger: !!(process.env.PASSENGER_APP_ENV || process.env.PASSENGER_BASE_URI), node: process.versions.node,
    restartRequested: st.restartRequested || null, bootedAt: new Date(Date.now() - process.uptime() * 1000).toISOString()
  };
}

/** اعلان یک‌بارهٔ «به‌روزرسانی انجام شد» برای مدیر (تا ۷ روز پس از ارتقا؛ کش ۶۰ ثانیه) */
let noticeCache = { at: 0, value: null };
function notice() {
  if (Date.now() - noticeCache.at < 60000) return noticeCache.value;
  const st = readState(); let v = null;
  if (st.prevVersion && st.upgradedAt && Date.now() - new Date(st.upgradedAt).getTime() < 7 * 86400000 && st.prevVersion !== pkg().version) v = { prevVersion: st.prevVersion, upgradedAt: st.upgradedAt };
  noticeCache = { at: Date.now(), value: v };
  return v;
}

function appendLog(line) { try { fs.mkdirSync(path.dirname(LOG_FILE()), { recursive: true }); fs.appendFileSync(LOG_FILE(), `[${new Date().toISOString()}] ${line}\n`); } catch (e) { /* ignore */ } }
function readLog(maxLines = 200) { try { const lines = fs.readFileSync(LOG_FILE(), 'utf8').split('\n').filter(Boolean); return lines.slice(-maxLines); } catch (e) { return []; } }
function clearLog() { try { fs.writeFileSync(LOG_FILE(), ''); } catch (e) { /* ignore */ } }

function touchRestart() { try { fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'tmp', 'restart.txt'), String(Date.now())); writeState({ restartRequested: new Date().toISOString() }); return true; } catch (e) { return false; } }

/**
 * استخراج بستهٔ ZIP نسخهٔ جدید روی پوشهٔ برنامه
 * @returns {{ files: number, skipped: number, version: string, prefix: string }}
 */
async function applyPackage(zipPath, { log = () => {}, force = false } = {}) {
  const { ZipReader } = require('./zip');
  const zr = new ZipReader(zipPath);
  try {
    const entries = zr.entries().filter((e) => !e.dir);
    // پیدا کردن ریشه (بسته‌های GitHub پیشوند repo-branch/ دارند)
    const pj = entries.filter((e) => /(^|\/)package\.json$/.test(e.name)).sort((a, b) => a.name.length - b.name.length)[0];
    if (!pj) throw new Error('بستهٔ نامعتبر: package.json یافت نشد');
    const prefix = pj.name.slice(0, pj.name.length - 'package.json'.length);
    let manifest; try { manifest = JSON.parse(zr.read(pj).toString('utf8').replace(/^\uFEFF/, '')); } catch (e) { throw new Error('package.json بسته قابل خواندن نیست'); }
    const current = pkg();
    if (manifest.name !== current.name) throw new Error(`این بسته متعلق به برنامهٔ دیگری است (${manifest.name})`);
    if (!force && cmpVersion(manifest.version, current.version) < 0) throw new Error(`نسخهٔ بسته (${manifest.version}) از نسخهٔ نصب‌شده (${current.version}) قدیمی‌تر است`);
    if (!entries.some((e) => e.name === prefix + 'app.js') || !entries.some((e) => e.name.startsWith(prefix + 'src/'))) throw new Error('بستهٔ ناقص: فایل‌های اصلی برنامه (app.js, src/) وجود ندارد');
    log(`بسته: ${manifest.name}@${manifest.version} — ${entries.length} فایل`);
    let files = 0, skipped = 0;
    for (const e of entries) {
      if (!e.name.startsWith(prefix)) { skipped++; continue; }
      const rel = e.name.slice(prefix.length).replace(/\\/g, '/');
      if (!rel || rel.split('/').some((seg) => seg === '..' || seg === '') || path.isAbsolute(rel)) { skipped++; continue; }
      if (SKIP_PREFIX.some((p) => rel === p.replace(/\/$/, '') || rel.startsWith(p)) || PROTECTED.includes(rel)) { skipped++; continue; }
      const abs = path.join(ROOT, rel);
      if (!abs.startsWith(ROOT + path.sep)) { skipped++; continue; }
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      await zr.extractTo(e, abs);
      files++;
    }
    log(`${files} فایل نوشته شد، ${skipped} مورد نادیده گرفته شد (storage/node_modules/.env/.git)`);
    return { files, skipped, version: manifest.version, prefix };
  } finally { zr.close(); }
}

/** اجرای npm install (در صورت نیاز یا اجبار) */
function npmInstall({ log = () => {}, force = false } = {}) {
  return new Promise((resolve) => {
    const missing = missingDeps();
    const lock = lockHash(); const st = readState();
    if (!force && !missing.length && !(lock && st.lockHash && st.lockHash !== lock)) { log('وابستگی‌ها کامل‌اند؛ npm install لازم نیست'); return resolve({ ok: true, ran: false }); }
    const npm = npmBin();
    if (!npm) { log('npm در دسترس نیست؛ لطفاً از ترمینال cPanel اجرا کنید: npm install --omit=dev'); return resolve({ ok: false, ran: false, error: 'npm not found', missing }); }
    log(`اجرای npm install (npm ${npm.version})${missing.length ? ' — وابستگی‌های ناقص: ' + missing.join(', ') : ''}`);
    const child = spawn(npm.bin, ['install', '--omit=dev', '--no-audit', '--no-fund', '--no-progress'], { cwd: ROOT, env: Object.assign({}, process.env, { NODE_ENV: 'production', CI: '1' }), stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    const onData = (d) => { buf += d.toString(); const lines = buf.split('\n'); buf = lines.pop(); lines.forEach((l) => l.trim() && log('npm: ' + l.trim())); };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    const timer = setTimeout(() => { log('npm install بیش از حد طول کشید؛ متوقف شد'); child.kill('SIGKILL'); }, 15 * 60 * 1000);
    child.on('close', (code) => { clearTimeout(timer); if (buf.trim()) log('npm: ' + buf.trim()); const stillMissing = missingDeps(); log(code === 0 && !stillMissing.length ? 'npm install با موفقیت انجام شد' : `npm install با کد ${code} پایان یافت${stillMissing.length ? '؛ هنوز ناقص: ' + stillMissing.join(', ') : ''}`); resolve({ ok: code === 0 && !stillMissing.length, ran: true, code, missing: stillMissing }); });
    child.on('error', (e) => { clearTimeout(timer); log('خطا در اجرای npm: ' + e.message); resolve({ ok: false, ran: true, error: e.message }); });
  });
}

/**
 * مراحل به‌روزرسانی (در فرایند جدا یا CLI). به پایگاه داده نیاز دارد (boot انجام شده باشد).
 * @param {object} o { db, schema, schemaSync, settings, log, forceInstall, skipInstall }
 */
async function run({ db, schema, schemaSync, settings, log = () => {}, forceInstall = false, skipInstall = false } = {}) {
  const p = pkg();
  writeState({ running: true, startedAt: new Date().toISOString(), status: 'running', message: null });
  maintenance.setFlag('سامانه در حال به‌روزرسانی است؛ چند دقیقهٔ دیگر دوباره تلاش کنید.');
  log(`شروع به‌روزرسانی به نسخهٔ ${p.version} (Node ${process.versions.node})`);
  const steps = [];
  try {
    if (!skipInstall) { const r = await npmInstall({ log, force: forceInstall }); steps.push({ step: 'npm', ok: r.ok }); if (!r.ok && r.missing && r.missing.length) throw new Error('وابستگی‌ها نصب نشدند: ' + r.missing.join(', ')); }
    if (db && schema && schemaSync) { log('همگام‌سازی ساختار پایگاه داده…'); await schemaSync.sync(db, schema, (m) => log('  ' + m)); steps.push({ step: 'schema', ok: true }); }
    if (settings) { await settings.load(); const prev = settings.get('app_version', ''); await settings.setMany({ app_version: p.version, app_updated_at: new Date().toISOString() }); log(prev && prev !== p.version ? `نسخه از ${prev} به ${p.version} ارتقا یافت` : `نسخهٔ ${p.version} ثبت شد`); steps.push({ step: 'version', ok: true }); }
    // پاک‌سازی tmp
    try { const tmp = path.join(ROOT, 'storage', 'tmp'); for (const f of fs.readdirSync(tmp)) { if (f === '.gitkeep') continue; try { fs.rmSync(path.join(tmp, f), { recursive: true, force: true }); } catch (e) { /* ignore */ } } } catch (e) { /* ignore */ }
    touchRestart();
    log('درخواست ری‌استارت ثبت شد (tmp/restart.txt)');
    writeState({ running: false, finishedAt: new Date().toISOString(), status: 'ok', message: `به‌روزرسانی به ${p.version} انجام شد`, lastVersion: p.version, lockHash: lockHash(), steps });
    log('پایان: موفق');
    return { ok: true, steps };
  } catch (e) {
    writeState({ running: false, finishedAt: new Date().toISOString(), status: 'failed', message: e.message, steps });
    log('پایان: ناموفق — ' + e.message);
    return { ok: false, error: e.message, steps };
  } finally { maintenance.clearFlag(); }
}

/** اجرای به‌روزرسانی در فرایند جدا (برای مسیر وب) */
function spawnRunner(args = []) {
  appendLog('اجرای مراحل به‌روزرسانی در پس‌زمینه…');
  writeState({ running: true, startedAt: new Date().toISOString(), status: 'running', message: null });
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'update.js'), '--web', ...args], { cwd: ROOT, detached: true, stdio: 'ignore', env: Object.assign({}, process.env) });
  child.unref();
  return child.pid;
}

module.exports = { pkg, cmpVersion, state, readState, writeState, notice, missingDeps, npmBin, applyPackage, npmInstall, run, spawnRunner, appendLog, readLog, clearLog, touchRestart, LOG_FILE, STATE_FILE };
