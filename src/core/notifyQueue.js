'use strict';
/**
 * صف تلاش مجدد پیامک/ایمیل
 *  - ارسال‌های ناموفق (خطاهای گذرا) در جدول notify_queue ذخیره و با فاصلهٔ افزایشی دوباره ارسال می‌شوند.
 *  - زمان‌بندی تلاش‌ها: ۲ دقیقه، ۱۰ دقیقه، ۳۰ دقیقه، ۲ ساعت، ۶ ساعت، سپس هر ۱۲ ساعت تا سقف تلاش‌ها.
 *  - پس از رسیدن به سقف، وضعیت «failed» می‌شود و به مدیر اعلان داده می‌شود.
 */
const db = require('./db');
const settings = require('./settings');
const logger = require('./logger');

const BACKOFF_MINUTES = [2, 10, 30, 120, 360];
const STATUSES = { pending: 'در انتظار', sent: 'ارسال شد', failed: 'ناموفق', cancelled: 'لغو شده' };
const CHANNELS = { sms: 'پیامک', email: 'ایمیل' };

function nowPlus(minutes) { return new Date(Date.now() + minutes * 60000).toISOString().slice(0, 19).replace('T', ' '); }
function backoff(attempt) { return BACKOFF_MINUTES[Math.min(attempt - 1, BACKOFF_MINUTES.length - 1)] || 720; }
function maxAttempts() { const n = Number(settings.get('notify_retry_max', '5')); return Number.isFinite(n) && n >= 1 ? Math.min(20, n) : 5; }

/** افزودن به صف؛ items = [{ recipient, payload, context, error }] → آرایهٔ شناسه‌ها */
async function enqueue(channel, items) {
  const now = db.now(); const ids = [];
  for (const it of items) {
    const id = await db.insert('notify_queue', {
      channel, recipient: String(it.recipient).slice(0, 150), payload: JSON.stringify(it.payload || {}), context: it.context || null, status: 'pending',
      attempts: 1, max_attempts: maxAttempts(), next_attempt_at: nowPlus(backoff(1)), last_error: it.error ? String(it.error).slice(0, 255) : null, created_at: now, updated_at: now
    });
    ids.push(id);
  }
  if (ids.length) logger.info('notify queued', { channel, count: ids.length });
  return ids;
}

async function deliver(row) {
  const notify = require('./notify');
  let payload = {}; try { payload = JSON.parse(row.payload || '{}'); } catch (e) { payload = {}; }
  if (row.channel === 'sms') return notify.deliverSms([row.recipient], payload.text || '');
  if (row.channel === 'email') return notify.deliverEmail(row.recipient, payload.subject || '', payload.html || '');
  return { ok: false, error: 'کانال ناشناخته' };
}

/**
 * پردازش صف. opts: { force: نادیده گرفتن زمان تلاش بعدی, ids: فقط این شناسه‌ها, limit }
 * خروجی: { processed, sent, retry, failed }
 */
async function process(opts) {
  opts = opts || {};
  const q = db.table('notify_queue').where('status', 'pending').orderBy('next_attempt_at').limit(opts.limit || 100);
  if (opts.ids) q.whereIn('id', opts.ids);
  if (!opts.force) q.where('next_attempt_at', '<=', db.now());
  const rows = await q.all();
  const out = { processed: rows.length, sent: 0, retry: 0, failed: 0, failedRows: [] };
  for (const row of rows) {
    const res = await deliver(row);
    const now = db.now();
    if (res.ok) {
      out.sent++;
      await db.table('notify_queue').where('id', row.id).update({ status: 'sent', sent_at: now, updated_at: now, last_error: null });
      if (row.channel === 'sms') await db.table('sms_log').where('queue_id', row.id).update({ status: 'sent', error: null });
      continue;
    }
    const attempts = (row.attempts || 0) + 1;
    const notify = require('./notify');
    const giveUp = attempts >= (row.max_attempts || maxAttempts()) || !notify.isTransient(res.error);
    if (giveUp) {
      out.failed++; out.failedRows.push(row);
      await db.table('notify_queue').where('id', row.id).update({ status: 'failed', attempts, last_error: String(res.error || 'خطا').slice(0, 255), updated_at: now });
      if (row.channel === 'sms') await db.table('sms_log').where('queue_id', row.id).update({ status: 'failed', error: String(res.error || 'خطا').slice(0, 255) });
    } else {
      out.retry++;
      await db.table('notify_queue').where('id', row.id).update({ attempts, next_attempt_at: nowPlus(backoff(attempts)), last_error: String(res.error || 'خطا').slice(0, 255), updated_at: now });
    }
  }
  if (out.failed) {
    logger.error('notify queue: giving up', { count: out.failed });
    try {
      const notify = require('./notify');
      await notify.pushRole('admin', { title: `${toFa(out.failed)} پیام پس از چند تلاش ارسال نشد`, body: out.failedRows.slice(0, 5).map((r) => `${CHANNELS[r.channel] || r.channel} به ${r.recipient}: ${r.last_error || ''}`).join('\n'), link: '/system/notify-queue?status=failed', type: 'danger' });
    } catch (e) { /* ignore */ }
  }
  return out;
}

/** بازگرداندن موارد ناموفق/لغوشده به صف (تلاش دوباره) */
async function requeue(ids) {
  const now = db.now();
  const q = db.table('notify_queue').whereIn('status', ['failed', 'cancelled', 'pending']);
  if (ids && ids.length) q.whereIn('id', ids);
  return q.update({ status: 'pending', next_attempt_at: now, max_attempts: maxAttempts(), updated_at: now });
}
async function cancel(ids) { const now = db.now(); return db.table('notify_queue').whereIn('id', ids).where('status', 'pending').update({ status: 'cancelled', updated_at: now }); }
async function purge(days) { return db.table('notify_queue').whereIn('status', ['sent', 'cancelled', 'failed']).where('updated_at', '<', new Date(Date.now() - (days || 30) * 86400000).toISOString().slice(0, 19).replace('T', ' ')).delete(); }

async function stats() {
  const rows = await db.table('notify_queue').select('status', 'channel', 'COUNT(*) as c').groupBy('status', 'channel').all();
  const s = { pending: 0, sent: 0, failed: 0, cancelled: 0, total: 0, sms: 0, email: 0 };
  for (const r of rows) { s[r.status] = (s[r.status] || 0) + Number(r.c); s[r.channel] = (s[r.channel] || 0) + Number(r.c); s.total += Number(r.c); }
  s.due = await db.table('notify_queue').where('status', 'pending').where('next_attempt_at', '<=', db.now()).count();
  return s;
}

function toFa(n) { return String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]); }

module.exports = { enqueue, process, requeue, cancel, purge, stats, STATUSES, CHANNELS, BACKOFF_MINUTES, maxAttempts };
