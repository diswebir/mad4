'use strict';
const path = require('path');
const express = require('express');
const modules = require('../../core/modules');
const settings = require('../../core/settings');
const auth = require('../../core/auth');
const activity = require('../../core/activity');
const pkg = require('../../../package.json');
const { TOPICS, PATH_MAP } = require('./content');
const checklist = require('./checklist');

const router = express.Router();
const v = (n) => path.join(__dirname, 'views', n + '.ejs');
router.use(auth.requireAuth);

/** موضوعات قابل مشاهده برای کاربر (نقش + ماژول فعال)، با حذف بخش‌های ماژول/قابلیت خاموش */
function topicsFor(user) {
  const role = user.role;
  return TOPICS.filter((t) => t.roles.includes(role) && (!t.module || modules.isEnabled(t.module)))
    .map((t) => Object.assign({}, t, { sections: t.sections.filter((s) => (!s.module || modules.isEnabled(s.module)) && (!s.feature || modules.isEnabled(s.feature))) }))
    .filter((t) => t.sections.length);
}
function topicForPath(p) { const hit = PATH_MAP.find(([prefix]) => String(p || '').startsWith(prefix)); return hit ? hit[1] : null; }

router.get('/', modules.requireEnabled('help.guide'), (req, res) => {
  const topics = topicsFor(req.user);
  let key = req.query.topic;
  if (!key && req.query.for) key = topicForPath(req.query.for);
  let topic = topics.find((t) => t.key === key);
  if (!topic) topic = topics.find((t) => t.key === 'start') || topics[0];
  const q = String(req.query.q || '').trim();
  let results = null;
  if (q) {
    const needle = q.toLowerCase(); results = [];
    for (const t of topics) for (const s of t.sections) {
      const text = [s.h, ...(s.p || []), ...(s.steps || []), ...(s.tips || [])].join(' ');
      if (text.toLowerCase().includes(needle) || t.title.includes(q)) results.push({ topic: t, section: s });
    }
  }
  res.render(v('index'), { title: 'راهنما', topics, topic, q, results, forPath: req.query.for || '' });
});

router.get('/setup', auth.requireAdmin, modules.requireEnabled('help.checklist'), async (req, res) => {
  const data = await checklist.compute();
  res.render(v('setup'), Object.assign({ title: 'راه‌اندازی اولیه' }, data));
});
router.post('/setup/dismiss', auth.requireAdmin, modules.requireEnabled('help.checklist'), async (req, res) => {
  const on = req.body.state !== '0';
  await settings.set('setup_checklist_dismissed', on ? '1' : '0');
  await activity.log(req, on ? 'checklist_dismiss' : 'checklist_show', 'system', null, on ? 'پنهان‌کردن چک‌لیست راه‌اندازی از داشبورد' : 'نمایش دوبارهٔ چک‌لیست راه‌اندازی');
  req.flash('success', on ? 'چک‌لیست از داشبورد پنهان شد؛ از منوی «راه‌اندازی اولیه» همیشه در دسترس است.' : 'چک‌لیست دوباره در داشبورد نمایش داده می‌شود.');
  res.redirect(on ? '/dashboard' : '/help/setup');
});

router.get('/about', modules.requireEnabled('help.about'), async (req, res) => {
  const db = require('../../core/db');
  const stats = modules.stats();
  const mods = modules.modules.map((m) => ({ key: m.key, name: m.name, icon: m.icon, enabled: modules.isEnabled(m.key), features: m.features.length, featuresOn: m.features.filter((f) => modules.isEnabled(f.fullKey)).length }));
  res.render(v('about'), { title: 'دربارهٔ سامانه', version: pkg.version, node: process.version, dialect: db.info ? db.info.dialect + (db.info.driver ? ' (' + db.info.driver + ')' : '') : '', stats, mods, isAdmin: req.user.role === 'admin' });
});

module.exports = router;
module.exports.topicForPath = topicForPath;
