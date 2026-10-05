'use strict';
/**
 * بخش عمومی متقاضیان:
 *   /apply            صفحهٔ ورود/شروع (فهرست موقعیت‌ها + ورود با موبایل و کد پیامکی)
 *   /apply/i/:code    ورود از طریق QR / لینک دعوت
 *   /portal           پنل متقاضی: انتخاب موقعیت، فرم چندمرحله‌ای، آزمون، ارسال نهایی، پیگیری
 */
const path = require('path');
const express = require('express');
const db = require('../../core/db');
const auth = require('../../core/auth');
const settings = require('../../core/settings');
const modules = require('../../core/modules');
const utils = require('../../core/utils');
const J = require('../../core/jalali');
const otp = require('../../core/otp');
const upload = require('../../core/upload');
const activity = require('../../core/activity');
const forms = require('./forms');
const service = require('./service');

const v = (n) => path.join(__dirname, 'views', 'apply', n + '.ejs');
const pv = (n) => path.join(__dirname, 'views', 'portal', n + '.ejs');

// ====================== /apply ======================
const applyRouter = express.Router();
applyRouter.use((req, res, next) => { res.locals.layout = 'layouts/public'; res.locals.narrow = true; next(); });

async function openPositions() {
  const today = J.todayISO();
  const rows = await db.table('job_positions as p').select('p.*', 'd.title as department').leftJoin('departments as d', 'p.department_id', 'd.id').where('p.status', 'open').where('p.is_public', 1).orderBy('p.sort_order').orderBy('p.id', 'desc').all();
  return rows.filter((p) => (!p.opens_at || p.opens_at <= today) && (!p.closes_at || p.closes_at >= today));
}

applyRouter.get('/', async (req, res) => {
  if (req.user && req.user.role === 'applicant') return res.redirect('/portal');
  const positions = await openPositions();
  res.render(v('index'), { title: 'استخدام', positions, open: settings.getBool('recruitment_open'), invite: req.session.invite || null, narrow: false });
});

/** لینک/QR دعوت */
applyRouter.get('/i/:code', async (req, res) => {
  const inv = await db.table('invites').where('code', String(req.params.code || '').toUpperCase()).first();
  const today = J.todayISO();
  const bad = !inv || inv.status !== 'active' || (inv.expires_at && inv.expires_at < today) || (inv.max_uses && inv.uses >= inv.max_uses);
  if (bad) { req.flash('warning', 'این لینک دعوت معتبر نیست یا منقضی شده است. می‌توانید از همین صفحه ثبت‌نام کنید.'); return res.redirect('/apply'); }
  req.session.invite = { id: inv.id, code: inv.code, title: inv.title, position_id: inv.position_id };
  if (req.user && req.user.role === 'applicant') return res.redirect('/portal');
  res.redirect('/apply/login');
});

applyRouter.get('/login', (req, res) => {
  if (req.user) return res.redirect(auth.homeFor(req.user));
  res.render(v('login'), { title: 'ورود متقاضیان', step: req.session.otp && req.session.otp.mobile ? 'verify' : 'mobile', otpState: req.session.otp || null, invite: req.session.invite || null });
});

applyRouter.post('/otp', async (req, res) => {
  if (req.user) return res.redirect(auth.homeFor(req.user));
  if (!settings.getBool('recruitment_open') && !req.session.invite) { req.flash('warning', settings.get('recruitment_closed_text')); return res.redirect('/apply'); }
  const mobile = utils.normalizePhone(req.body.mobile);
  if (!utils.isValidMobile(mobile)) { req.flash('danger', 'شمارهٔ موبایل معتبر نیست (مثال: ۰۹۱۲۳۴۵۶۷۸۹).'); req.keepInput(); return res.redirect('/apply/login'); }
  const r = await otp.request(mobile, auth.clientIp(req), 'login');
  if (!r.ok) { req.flash('danger', r.error); req.keepInput(); return res.redirect('/apply/login'); }
  req.session.otp = { mobile, sentAt: Date.now(), ttlMin: r.ttlMin, resendSec: r.resendSec, devCode: r.devCode || null, smsError: r.sent ? null : r.smsError };
  if (!r.sent && !r.devCode) req.flash('warning', 'ارسال پیامک با خطا مواجه شد: ' + (r.smsError || 'نامشخص') + '. لطفاً کمی بعد دوباره تلاش کنید.');
  else req.flash('success', `کد تأیید به شمارهٔ ${J.toPersianDigits(utils.maskMobile(mobile))} ارسال شد.`);
  res.redirect('/apply/login');
});
applyRouter.post('/otp/change', (req, res) => { req.session.otp = null; res.redirect('/apply/login'); });

applyRouter.post('/verify', async (req, res) => {
  if (req.user) return res.redirect(auth.homeFor(req.user));
  const st = req.session.otp;
  if (!st || !st.mobile) return res.redirect('/apply/login');
  const r = await otp.verify(st.mobile, req.body.code, 'login');
  if (!r.ok) { if (r.expired) req.session.otp = null; req.flash('danger', r.error); return res.redirect('/apply/login'); }
  // کاربر متقاضی: ساخت در صورت نبود
  let user = await db.table('users').where('mobile', st.mobile).where('role', 'applicant').first();
  if (!user) {
    // اگر همین موبایل متعلق به کارمند است، اجازهٔ ورود به‌عنوان متقاضی نمی‌دهیم (از پنل کارکنان وارد شود)
    const staff = await db.table('users').where('mobile', st.mobile).whereNotIn('role', ['applicant']).first();
    if (staff) { req.session.otp = null; req.flash('warning', 'این شماره متعلق به یکی از کارکنان است؛ لطفاً از صفحهٔ ورود کارکنان وارد شوید.'); return res.redirect('/auth/login'); }
    const now = db.now();
    let username = 'm' + st.mobile;
    if (await db.table('users').where('username', username).exists()) username = username + '-' + utils.randomString(4).toLowerCase();
    const id = await db.insert('users', { username, password: null, role: 'applicant', name: null, mobile: st.mobile, status: 'active', mobile_verified_at: now, created_at: now, updated_at: now });
    user = await db.findById('users', id);
  } else if (user.status !== 'active') { req.session.otp = null; req.flash('danger', 'حساب شما غیرفعال شده است. با شرکت تماس بگیرید.'); return res.redirect('/apply/login'); }
  const invite = req.session.invite || null;
  await auth.login(req, user, true, { invite });
  await auth.logLogin(req, user, user.username, true, 'otp');
  await activity.log(req, 'login', 'user', user.id, 'ورود متقاضی با کد پیامکی');
  // ثبت استفاده از دعوت
  if (invite && invite.id && !req.session.inviteCounted) { await db.table('invites').where('id', invite.id).increment('uses', 1); req.session.inviteCounted = true; }
  res.redirect('/portal');
});

// ====================== /portal ======================
const portal = express.Router();
portal.use(auth.requireAuth, (req, res, next) => {
  if (req.user.role !== 'applicant') return res.redirect('/dashboard');
  res.locals.layout = 'layouts/public';
  res.locals.narrow = false;
  next();
});

async function loadApp(req) {
  let app = await service.currentApplication(req.user.id);
  if (!app) {
    const inv = req.session.invite || null;
    app = await service.createApplication(req.user, { positionId: inv && inv.position_id ? inv.position_id : null, inviteId: inv ? inv.id : null, source: inv ? 'qr' : 'web' });
  }
  app.d = service.data(app);
  app.position = app.position_id ? await db.findById('job_positions', app.position_id) : null;
  return app;
}
const editable = (app) => app.status === 'draft' || (settings.getBool('recruitment_allow_edit_after_submit') && app.status === 'submitted');

async function portalContext(req, app) {
  const secs = await forms.steps();
  const prog = await forms.progress(app.d);
  let attempts = [];
  if (modules.isEnabled('assessments')) attempts = await db.table('assessment_attempts as a').select('a.*', 't.title', 't.key as test_key').join('assessments as t', 'a.assessment_id', 't.id').where('a.application_id', app.id).all();
  const history = await db.table('application_history').where('application_id', app.id).orderBy('id', 'desc').limit(10).all();
  const requireTest = modules.isEnabled('assessments') && settings.getBool('assessment_required') && (!app.position || Number(app.position.require_test));
  return { secs, prog, attempts, history, requireTest, editable: editable(app) };
}

portal.get('/', async (req, res) => {
  const app = await loadApp(req);
  const ctx = await portalContext(req, app);
  const positions = await openPositions();
  const files = await db.table('application_files').where('application_id', app.id).all();
  res.render(pv('index'), Object.assign({ title: 'پنل متقاضی', app, positions, files }, ctx));
});

/** انتخاب موقعیت شغلی */
portal.post('/position', async (req, res) => {
  const app = await loadApp(req);
  if (!editable(app)) { req.flash('warning', 'پس از ارسال درخواست امکان تغییر موقعیت وجود ندارد.'); return res.redirect('/portal'); }
  const id = parseInt(req.body.position_id, 10);
  const positions = await openPositions();
  const pos = positions.find((p) => p.id === id);
  if (!pos) { req.flash('danger', 'موقعیت شغلی انتخاب‌شده معتبر نیست.'); return res.redirect('/portal'); }
  await db.update('applications', { position_id: pos.id, updated_at: db.now(), last_activity_at: db.now() }, { id: app.id });
  req.flash('success', `موقعیت «${pos.title}» انتخاب شد. حالا فرم استخدام را تکمیل کنید.`);
  res.redirect('/portal/form/' + (await forms.steps())[0].key);
});

/** فرم چندمرحله‌ای */
portal.get('/form/:section', async (req, res) => {
  const app = await loadApp(req);
  const secs = await forms.steps();
  const idx = secs.findIndex((s) => s.key === req.params.section);
  if (idx < 0) return res.redirect('/portal');
  if (!app.position_id) { req.flash('warning', 'ابتدا موقعیت شغلی را انتخاب کنید.'); return res.redirect('/portal'); }
  const section = secs[idx];
  const prog = await forms.progress(app.d);
  const files = await db.table('application_files').where('application_id', app.id).all();
  const dups = section.key === 'declaration' ? await service.duplicates(app, app.d) : [];
  res.render(pv('form'), { title: section.title, app, secs, section, idx, prog, values: app.d[section.key] || (section.repeatable ? [] : { mobile: req.user.mobile }), files, editable: editable(app), dups, declaration: settings.get('recruitment_declaration'), requirePhoto: settings.getBool('recruitment_require_photo'), requireResume: settings.getBool('recruitment_require_resume') });
});

const formUpload = upload.form('applications', 'fields', [{ name: 'photo', maxCount: 1 }, { name: 'resume', maxCount: 1 }], { maxMb: 5, maxFiles: 2, userContent: true });
portal.post('/form/:section', ...formUpload, async (req, res) => {
  const app = await loadApp(req);
  const secs = await forms.steps();
  const idx = secs.findIndex((s) => s.key === req.params.section);
  if (idx < 0) return res.redirect('/portal');
  const section = secs[idx];
  const back = '/portal/form/' + section.key;
  if (!editable(app)) { req.flash('warning', 'این درخواست قابل ویرایش نیست.'); return res.redirect('/portal'); }
  if (req.uploadError) { req.flash('danger', req.uploadError); return res.redirect(back); }
  const draft = req.body._action === 'draft';
  const body = Object.assign({}, req.body);
  if (section.key === 'personal') body.mobile = req.user.mobile; // موبایل تأییدشده قابل تغییر نیست
  const { values, errors } = forms.collectSection(section, body, { draft });
  // فایل‌ها (عکس و رزومه) در بخش مشخصات
  const fileUpd = {};
  if (req.files) {
    for (const key of ['photo', 'resume']) {
      const f = req.files[key] && req.files[key][0];
      if (!f) continue;
      if (key === 'photo' && !upload.IMAGE_TYPES.includes(f.mimetype)) { upload.removeFile(upload.relPath(f)); errors.push('عکس باید تصویر (JPG/PNG) باشد'); continue; }
      // جابه‌جایی به پوشهٔ پرونده
      const rel = moveToApp(f, app.id);
      if (app[key]) upload.removeFile(app[key]);
      fileUpd[key] = rel;
      await db.table('application_files').where('application_id', app.id).where('field_key', key).delete();
      await db.insert('application_files', { application_id: app.id, field_key: key, path: rel, original_name: f.originalname, mime: f.mimetype, size: f.size, uploaded_by: req.user.id, created_at: db.now() });
    }
  }
  if (section.key === 'personal' && !draft) {
    if (settings.getBool('recruitment_require_photo') && !app.photo && !fileUpd.photo) errors.push('بارگذاری عکس پرسنلی الزامی است');
    if (settings.getBool('recruitment_require_resume') && !app.resume && !fileUpd.resume) errors.push('بارگذاری فایل رزومه الزامی است');
  }
  const d = app.d; d[section.key] = values;
  await service.saveData(app, d, fileUpd);
  if (errors.length) { req.flash('danger', errors.slice(0, 6).join('<br>')); return res.redirect(back); }
  if (draft) { req.flash('success', 'پیش‌نویس ذخیره شد.'); return res.redirect(back); }
  // ارسال نهایی در آخرین مرحله
  if (section.key === 'declaration' || idx === secs.length - 1) {
    const prog = await forms.progress(d);
    const missing = secs.filter((s) => !prog.done.includes(s.key));
    if (missing.length) { req.flash('danger', 'بخش‌های زیر کامل نیستند: ' + missing.map((s) => s.title).join('، ')); return res.redirect('/portal/form/' + missing[0].key); }
    if (app.status === 'draft') {
      const fresh = await db.findById('applications', app.id);
      await service.submit(fresh, req.user);
      await activity.log(req, 'create', 'application', app.id, 'ارسال درخواست استخدام ' + fresh.tracking_code);
      // نام کاربر متقاضی را از فرم به‌روز می‌کنیم
      await db.update('users', { name: [fresh.first_name, fresh.last_name].filter(Boolean).join(' ') || null, email: fresh.email || null, updated_at: db.now() }, { id: req.user.id });
    }
    return res.redirect('/portal/done');
  }
  req.flash('success', `بخش «${section.title}» ذخیره شد.`);
  res.redirect('/portal/form/' + secs[idx + 1].key);
});

function moveToApp(file, appId) {
  const fs = require('fs');
  const dir = path.join(require('../../core/config').get().uploads.dir, 'applications', String(appId));
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, path.basename(file.path));
  try { fs.renameSync(file.path, target); } catch (e) { fs.copyFileSync(file.path, target); fs.unlinkSync(file.path); }
  return ['applications', String(appId), path.basename(file.path)].join('/');
}

portal.post('/file/:key/delete', async (req, res) => {
  const app = await loadApp(req);
  const key = req.params.key === 'photo' ? 'photo' : 'resume';
  if (!editable(app)) return res.redirect('/portal');
  if (app[key]) upload.removeFile(app[key]);
  await db.update('applications', { [key]: null, updated_at: db.now() }, { id: app.id });
  await db.table('application_files').where('application_id', app.id).where('field_key', key).delete();
  req.flash('success', 'فایل حذف شد.');
  res.redirect('/portal/form/personal');
});

portal.get('/done', async (req, res) => {
  const app = await loadApp(req);
  if (app.status === 'draft') return res.redirect('/portal');
  const ctx = await portalContext(req, app);
  res.render(pv('done'), Object.assign({ title: 'ثبت درخواست', app, thanks: settings.get('recruitment_thanks_text') }, ctx));
});

/** انصراف از درخواست */
portal.post('/withdraw', async (req, res) => {
  const app = await loadApp(req);
  if (['hired', 'archived'].includes(app.status)) return res.redirect('/portal');
  await service.setStatus(app, 'withdrawn', req.user, { note: 'انصراف متقاضی', notifyApplicant: false });
  req.flash('info', 'درخواست شما لغو شد.');
  res.redirect('/portal');
});

/** چاپ/مشاهدهٔ فرم خود */
portal.get('/print', async (req, res) => {
  const app = await loadApp(req);
  const secs = await forms.definition();
  res.render(path.join(__dirname, 'views', 'hr', 'print.ejs'), { layout: 'layouts/print', title: 'فرم استخدام', app, secs, forms, evaluations: [], forApplicant: true });
});

module.exports = { applyRouter, portal, openPositions };
