'use strict';
/**
 * زمان‌بند کارهای پس‌زمینه
 *  - هر ماژول می‌تواند در مانیفست خود `jobs: [{ key, name, description, schedule: 'daily'|'hourly'|'every15', defaultTime: 'HH:MM', run(ctx) }]` تعریف کند.
 *  - وضعیت هر کار در جدول scheduled_jobs نگهداری می‌شود (فعال/غیرفعال، ساعت اجرا، آخرین اجرا) و با قفل اتمی بین چند پروسه ایمن است.
 *  - سه راه اجرا: تیکِ داخلی هر دقیقه (پیش‌فرض)، `node scripts/cron.js` (cron هاست) یا GET /cron?token=... (سرویس‌های cron بیرونی).
 */
const crypto = require('crypto');
const db = require('./db');
const modules = require('./modules');
const settings = require('./settings');
const J = require('./jalali');

const LOCK_MINUTES = 15;
let timer = null;
let running = false;

function definitions() {
  const list = [];
  for (const mod of modules.modules) for (const j of mod.jobs || []) list.push(Object.assign({ module: mod.key, moduleName: mod.name, schedule: 'daily', defaultTime: '08:00' }, j));
  return list;
}
async function ensureRows() {
  const defs = definitions();
  const existing = new Set(await db.table('scheduled_jobs').pluck('key'));
  for (const d of defs) if (!existing.has(d.key)) await db.insert('scheduled_jobs', { key: d.key, is_enabled: d.enabledByDefault === false ? 0 : 1, run_at: d.defaultTime, updated_at: db.now() });
}
/** فهرست کارها همراه با وضعیت ذخیره‌شده */
async function state() {
  await ensureRows();
  const rows = await db.table('scheduled_jobs').all();
  return definitions().map((d) => Object.assign({}, d, rows.find((r) => r.key === d.key) || {}, { moduleEnabled: modules.isEnabled(d.module) }));
}
/** دقیقه‌های سپری‌شده از یک datetime ذخیره‌شده (UTC) */
function minutesSince(iso) { if (!iso) return Infinity; return (Date.now() - Date.parse(String(iso).replace(' ', 'T') + 'Z')) / 60000; }
function isDue(job, row) {
  if (!row || !row.is_enabled) return false;
  if (!modules.isEnabled(job.module)) return false;
  if (job.schedule === 'hourly') return minutesSince(row.last_run_at) >= 60;
  if (job.schedule === 'every15') return minutesSince(row.last_run_at) >= 15;
  const runAt = row.run_at || job.defaultTime || '08:00';
  if (J.nowTime() < runAt) return false;
  return !row.last_run_at || J.localDateOf(row.last_run_at) < J.todayISO();
}
async function claim(key) {
  const token = crypto.randomBytes(12).toString('hex');
  const staleBefore = new Date(Date.now() - LOCK_MINUTES * 60000).toISOString().slice(0, 19).replace('T', ' ');
  const n = await db.table('scheduled_jobs').where('key', key).where((b) => b.whereNull('lock_token').orWhereNull('locked_at').orWhere('locked_at', '<', staleBefore)).update({ lock_token: token, locked_at: db.now() });
  if (!n) return null;
  const row = await db.table('scheduled_jobs').where('key', key).first();
  return row && row.lock_token === token ? token : null;
}
async function release(key) { await db.table('scheduled_jobs').where('key', key).update({ lock_token: null, locked_at: null }); }

/** اجرای یک کار (force: بدون توجه به زمان‌بندی) */
async function runJob(key, trigger, force) {
  const job = definitions().find((j) => j.key === key);
  if (!job) return { ok: false, message: 'کار ناشناخته' };
  await ensureRows();
  const row = await db.table('scheduled_jobs').where('key', key).first();
  if (!force && !isDue(job, row)) return { ok: false, skipped: true, message: 'زمان اجرا نرسیده' };
  if (!(await claim(key))) return { ok: false, skipped: true, message: 'در حال اجرا توسط پروسهٔ دیگر' };
  const started = db.now(); const t0 = Date.now();
  const runId = await db.insert('job_runs', { job_key: key, started_at: started, status: 'running', trigger: trigger || 'auto' });
  let status = 'ok'; let message = '';
  try { const r = await job.run({ db, settings, J, trigger, force: !!force }); message = typeof r === 'string' ? r : (r && r.message) || 'انجام شد'; }
  catch (e) { status = 'failed'; message = e.message || String(e); console.error(`[scheduler] ${key} failed:`, e); require('./logger').error(`job ${key} failed`, e, null, { job: key, trigger }); }
  const ms = Date.now() - t0;
  await db.update('job_runs', { finished_at: db.now(), status, message: String(message).slice(0, 2000) }, { id: runId });
  await db.table('scheduled_jobs').where('key', key).update({ last_run_at: started, last_status: status, last_message: String(message).slice(0, 2000), last_duration_ms: ms, lock_token: null, locked_at: null, updated_at: db.now() });
  return { ok: status === 'ok', status, message, ms };
}
/** اجرای همهٔ کارهای سررسیدشده */
async function runDue(trigger) {
  if (running) return [];
  running = true; const results = [];
  try {
    await ensureRows();
    const rows = await db.table('scheduled_jobs').all();
    for (const job of definitions()) {
      const row = rows.find((r) => r.key === job.key);
      if (!isDue(job, row)) continue;
      results.push(Object.assign({ key: job.key }, await runJob(job.key, trigger || 'auto', false)));
    }
  } catch (e) { console.error('[scheduler]', e); }
  finally { running = false; }
  return results;
}
async function tick() {
  try {
    if (!modules.isEnabled('system.scheduler')) return;
    if ((settings.get('scheduler_mode') || 'internal') !== 'internal') return;
    await runDue('auto');
  } catch (e) { console.error('[scheduler] tick', e); }
}
function start() {
  if (timer) return;
  timer = setInterval(tick, 60 * 1000);
  if (timer.unref) timer.unref();
  setTimeout(tick, 15 * 1000).unref();
}
function stop() { if (timer) clearInterval(timer); timer = null; }
async function recentRuns(limit) { return db.table('job_runs').orderBy('id', 'desc').limit(limit || 50).all(); }
/** توکن cron بیرونی (در صورت نبود ساخته می‌شود) */
async function cronToken() {
  let t = settings.get('cron_token');
  if (!t) { t = crypto.randomBytes(16).toString('hex'); await settings.set('cron_token', t); }
  return t;
}
module.exports = { definitions, state, runJob, runDue, start, stop, recentRuns, cronToken, isDue };
