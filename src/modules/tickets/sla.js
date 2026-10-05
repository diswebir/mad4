'use strict';
/**
 * SLA تیکت‌ها: مهلت پاسخ اول بر اساس اولویت + مهلت حل نهایی
 *  - targetHours(priority): مهلت پاسخ (ساعت) از تنظیمات
 *  - info(ticket, now): وضعیت SLA یک تیکت (ok / warning / overdue / n/a) با زمان باقی‌مانده/تأخیر
 *  - compute(rows): افزودن فیلد sla به هر ردیف
 *  - overdueIds(q): شناسهٔ تیکت‌های بازِ خارج از مهلت در یک کوئری
 */
const settings = require('../../core/settings');
const J = require('../../core/jalali');

const parse = (s) => { if (!s) return null; const d = new Date(String(s).replace(' ', 'T') + (String(s).length <= 19 ? 'Z' : '')); return Number.isNaN(d.getTime()) ? null : d.getTime(); };
const nowMs = () => Date.now(); // زمان‌های ذخیره‌شده UTC هستند (db.now)

function targetHours(priority) {
  const base = settings.getInt('ticket_sla_hours', 48) || 48;
  if (priority === 'urgent') return settings.getInt('ticket_sla_urgent_hours', 4) || base;
  if (priority === 'high') return settings.getInt('ticket_sla_high_hours', 24) || base;
  if (priority === 'low') return Math.max(base, settings.getInt('ticket_sla_low_hours', base * 2) || base);
  return base;
}
function resolveDays() { return settings.getInt('ticket_sla_resolve_days', 7) || 0; }
const warnRatio = () => Math.min(0.95, Math.max(0.3, (settings.getInt('ticket_sla_warn_percent', 75) || 75) / 100));

/** زمان شروع انتظار برای پاسخ کارکنان: آخرین پیام کاربر (در وضعیت باز) یا زمان ایجاد */
function waitingSince(t) { return (t.status === 'open' && t.last_reply_at) ? t.last_reply_at : t.created_at; }

function fmtHours(h) {
  h = Math.abs(h);
  if (h < 1) return J.toPersianDigits(Math.max(1, Math.round(h * 60))) + ' دقیقه';
  if (h < 48) return J.toPersianDigits(Math.round(h * 10) / 10) + ' ساعت';
  return J.toPersianDigits(Math.round(h / 24 * 10) / 10) + ' روز';
}

/** وضعیت SLA پاسخ اول برای یک تیکت */
function info(t, now) {
  now = now || nowMs();
  const target = targetHours(t.priority);
  const out = { target, targetLabel: J.toPersianDigits(target) + ' ساعت', state: 'na', label: '', badge: 'secondary', elapsed: 0, remaining: null, dueAt: null, resolveOverdue: false, resolveDays: resolveDays() };
  // حل نهایی
  if (out.resolveDays && t.status !== 'closed') { const c = parse(t.created_at); if (c && now - c > out.resolveDays * 86400e3) { out.resolveOverdue = true; out.resolveElapsedDays = Math.floor((now - c) / 86400e3); } }
  if (t.status !== 'open') { out.label = t.status === 'closed' ? 'بسته' : t.status === 'pending' ? 'در انتظار کاربر' : 'پاسخ داده شده'; return out; }
  const since = parse(waitingSince(t));
  if (!since) return out;
  const elapsed = (now - since) / 36e5;
  out.elapsed = Math.round(elapsed * 10) / 10;
  out.remaining = Math.round((target - elapsed) * 10) / 10;
  out.dueAt = new Date(since + target * 36e5).toISOString().slice(0, 19).replace('T', ' ');
  if (elapsed >= target) { out.state = 'overdue'; out.badge = 'danger'; out.label = fmtHours(elapsed - target) + ' تأخیر'; }
  else if (elapsed >= target * warnRatio()) { out.state = 'warning'; out.badge = 'warning'; out.label = fmtHours(target - elapsed) + ' مانده'; }
  else { out.state = 'ok'; out.badge = 'success'; out.label = fmtHours(target - elapsed) + ' مانده'; }
  return out;
}
function compute(rows) { const now = nowMs(); for (const r of rows) r.sla = info(r, now); return rows; }

/** شناسهٔ تیکت‌های باز که از مهلت گذشته‌اند / نزدیک مهلت‌اند (روی کوئری محدودشده به دسترسی کاربر) */
async function classify(q) {
  const rows = await q.select('t.id', 't.status', 't.priority', 't.created_at', 't.last_reply_at').where('t.status', 'open').all();
  const now = nowMs();
  const overdue = [], warning = [], ok = [];
  for (const r of rows) { const s = info(r, now).state; (s === 'overdue' ? overdue : s === 'warning' ? warning : ok).push(r.id); }
  return { overdue, warning, ok, open: rows.length };
}

/** رعایت SLA پاسخ اول در گذشته: درصد تیکت‌هایی که اولین پاسخ کارکنان در مهلت بوده است */
function compliance(firstReplies) {
  let within = 0, total = 0, sum = 0; const byPriority = {};
  for (const r of firstReplies) {
    const c = parse(r.created_at), f = parse(r.first_reply); if (!c || !f || f < c) continue;
    const hrs = (f - c) / 36e5, target = targetHours(r.priority);
    total++; sum += hrs; if (hrs <= target) within++;
    const p = byPriority[r.priority || 'normal'] = byPriority[r.priority || 'normal'] || { n: 0, within: 0, sum: 0, target };
    p.n++; p.sum += hrs; if (hrs <= target) p.within++;
  }
  for (const p of Object.values(byPriority)) { p.avg = Math.round(p.sum / p.n * 10) / 10; p.percent = Math.round(p.within / p.n * 100); }
  return { total, within, percent: total ? Math.round(within / total * 100) : null, avgHours: total ? Math.round(sum / total * 10) / 10 : null, byPriority };
}

module.exports = { targetHours, resolveDays, waitingSince, info, compute, classify, compliance, fmtHours };
