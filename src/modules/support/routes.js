'use strict';
/**
 * ماژول پشتیبانی (سمت کاربران مدرسه):
 *  - POST /support/report  → ثبت گزارش خطا/پیشنهاد/سؤال از دکمهٔ شناور (JSON) — یک تصویر تا ۵ مگابایت
 *  - GET  /support/my      → گزارش‌های من + پاسخ سازنده
 *  - GET  /support/modules → (مدیر) فهرست ماژول‌ها/قابلیت‌ها با وضعیت و دکمهٔ «درخواست فعال‌سازی»
 *  - POST /support/request → (مدیر) ثبت درخواست ماژول/قابلیت برای سازنده
 * گزارش‌ها فقط در کنسول سازنده (/console/reports) دیده و پاسخ داده می‌شوند.
 */
const path = require('path');
const express = require('express');
const db = require('../../core/db');
const auth = require('../../core/auth');
const modules = require('../../core/modules');
const settings = require('../../core/settings');
const notify = require('../../core/notify');
const activity = require('../../core/activity');
const utils = require('../../core/utils');
const upload = require('../../core/upload');
const J = require('../../core/jalali');
const pkg = require('../../../package.json');

const router = express.Router();
const v = (n) => path.join(__dirname, 'views', n + '.ejs');
router.use(auth.requireAuth);

const KINDS = { bug: 'خطا / مشکل', suggestion: 'پیشنهاد', question: 'سؤال', module_request: 'درخواست ماژول' };
const STATUSES = { new: 'جدید', seen: 'دیده شد', in_progress: 'در حال بررسی', resolved: 'رفع شد', closed: 'بسته' };
const STATUS_COLOR = { new: 'danger', seen: 'secondary', in_progress: 'warning', resolved: 'success', closed: 'dark' };
const clean = (s, n) => utils.normalizePersian(String(s || '')).replace(/\s+/g, ' ').trim().slice(0, n);

/** سقف تعداد گزارش هر کاربر در ساعت (support_max_per_hour؛ پیش‌فرض ۱۰) */
async function overLimit(userId) {
  const max = Math.max(1, settings.getInt('support_max_per_hour', 10));
  const since = new Date(Date.now() - 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const n = await db.table('support_reports').where('user_id', userId).where('created_at', '>=', since).count();
  return Number(n) >= max;
}
async function notifySuper(id, kind, subject, req) {
  const who = `${req.user.name} (${utils.ROLES[req.user.role] || req.user.role})`;
  const title = kind === 'module_request' ? 'درخواست فعال‌سازی ماژول' : `گزارش ${KINDS[kind] || 'خطا'} جدید`;
  try { await notify.pushSuper({ title, body: `${who}: ${subject}`, link: kind === 'module_request' ? '/console/requests' : '/console/reports/' + id, type: kind === 'bug' ? 'danger' : 'info' }); } catch (e) { /* ignore */ }
}

// ---------- ثبت گزارش از دکمهٔ شناور ----------
router.post('/report', modules.requireEnabled('support.widget'), ...upload.form('support', 'single', 'image', { images: true, maxMb: 5, maxFiles: 1 }), async (req, res) => {
  const fail = (code, msg) => res.status(code).json({ ok: false, error: msg });
  if (req.uploadError) return fail(400, req.uploadError);
  const message = utils.normalizePersian(String(req.body.message || '')).trim().slice(0, 4000);
  if (message.length < 5) { if (req.file) upload.removeFile(upload.relPath(req.file)); return fail(400, 'شرح مشکل باید حداقل ۵ کاراکتر باشد.'); }
  if (await overLimit(req.user.id)) { if (req.file) upload.removeFile(upload.relPath(req.file)); return fail(429, 'تعداد گزارش‌های شما در یک ساعت گذشته بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.'); }
  const kind = ['bug', 'suggestion', 'question'].includes(req.body.kind) ? req.body.kind : 'bug';
  const subject = clean(req.body.subject, 200) || message.slice(0, 80);
  const tech = req.body.tech !== '0';
  const id = await db.insert('support_reports', {
    user_id: req.user.id, role: req.user.role, kind, subject, message,
    page_url: tech ? clean(req.body.page_url, 255) || null : null,
    user_agent: tech ? String(req.get('user-agent') || '').slice(0, 250) : null,
    screen: tech ? clean(req.body.screen, 40) || null : null,
    app_version: pkg.version, image: req.file ? upload.relPath(req.file) : null, status: 'new', created_at: db.now(), updated_at: db.now()
  });
  await activity.log(req, 'create', 'support_report', id, `گزارش ${KINDS[kind]}: ${subject}`);
  await notifySuper(id, kind, subject, req);
  res.json({ ok: true, id, message: 'گزارش شما ثبت شد.' });
});

// ---------- گزارش‌های من ----------
router.get('/my', modules.requireEnabled('support.my_reports'), async (req, res) => {
  const rows = await db.table('support_reports').where('user_id', req.user.id).orderBy('id', 'desc').limit(100).all();
  res.render(v('my'), { title: 'گزارش‌های من', rows, KINDS, STATUSES, STATUS_COLOR });
});

// ---------- ماژول‌ها (نمای مدیر) و درخواست فعال‌سازی ----------
const adminGate = [auth.requireRoleOrPermission(['admin'], 'system.modules'), modules.requireEnabled('support.module_requests')];
router.get('/modules', ...adminGate, async (req, res) => {
  const pending = await db.table('support_reports').where('kind', 'module_request').whereIn('status', ['new', 'seen', 'in_progress']).all();
  const pendingKeys = new Set(pending.map((p) => p.module_key).filter(Boolean));
  const list = modules.modules.map((m) => ({
    key: m.key, name: m.name, description: m.description, icon: m.icon, category: m.category, core: !!m.core, enabled: modules.isEnabled(m.key), dependencies: m.dependencies || [],
    features: m.features.map((f) => ({ key: f.fullKey, name: f.name, description: f.description, locked: !!f.locked, enabled: modules.isEnabled(f.fullKey), pending: pendingKeys.has(f.fullKey) })),
    pending: pendingKeys.has(m.key)
  }));
  const history = await db.table('support_reports').where('kind', 'module_request').orderBy('id', 'desc').limit(20).all();
  res.render(v('modules'), { title: 'ماژول‌های سامانه', list, stats: modules.stats(), categories: modules.CATEGORIES, history, STATUSES, STATUS_COLOR, note: settings.get('module_request_note'), contact: settings.get('support_contact_text') });
});
router.post('/request', ...adminGate, async (req, res) => {
  const back = '/support/modules';
  const key = String(req.body.key || '').trim();
  const [modKey, featKey] = key.split('.');
  const mod = modules.getModule(modKey);
  const feat = mod && featKey ? mod.features.find((f) => f.key === featKey) : null;
  const custom = clean(req.body.title, 200);
  if (!mod && !custom) { req.flash('danger', 'ماژول نامعتبر است.'); return res.redirect(back); }
  if (mod && (featKey ? !feat : false)) { req.flash('danger', 'قابلیت نامعتبر است.'); return res.redirect(back); }
  if (mod && modules.isEnabled(key)) { req.flash('info', 'این مورد هم‌اکنون فعال است.'); return res.redirect(back); }
  const existing = mod ? await db.table('support_reports').where('kind', 'module_request').where('module_key', key).whereIn('status', ['new', 'seen', 'in_progress']).first() : null;
  if (existing) { req.flash('info', 'درخواست فعال‌سازی این مورد قبلاً ثبت شده و در انتظار بررسی سازنده است.'); return res.redirect(back); }
  if (await overLimit(req.user.id)) { req.flash('danger', 'تعداد درخواست‌ها در یک ساعت گذشته بیش از حد مجاز است.'); return res.redirect(back); }
  const name = mod ? (feat ? `${mod.name} › ${feat.name}` : mod.name) : custom;
  const subject = `درخواست فعال‌سازی: ${name}`;
  const message = clean(req.body.message, 2000) || (mod ? `مدیر مدرسه درخواست فعال‌سازی «${name}» را دارد.` : custom);
  const id = await db.insert('support_reports', {
    user_id: req.user.id, role: req.user.role, kind: 'module_request', subject, message, module_key: mod ? key : null,
    page_url: back, app_version: pkg.version, status: 'new', created_at: db.now(), updated_at: db.now()
  });
  await activity.log(req, 'create', 'support_report', id, subject);
  await notifySuper(id, 'module_request', name, req);
  req.flash('success', `درخواست فعال‌سازی «${name}» برای سازندهٔ سامانه ارسال شد. پس از بررسی، نتیجه از طریق اعلان به شما اطلاع داده می‌شود.`);
  res.redirect(back);
});

module.exports = router;
module.exports.KINDS = KINDS;
module.exports.STATUSES = STATUSES;
module.exports.STATUS_COLOR = STATUS_COLOR;
