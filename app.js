'use strict';
/**
 * نقطهٔ ورود برنامه (برای cPanel / Passenger و اجرای مستقیم با node)
 * cPanel → Setup Node.js App → Application startup file: app.js
 */
process.title = 'madrese';
// پنهان‌کردن هشدار آزمایشی node:sqlite
process.removeAllListeners('warning');
process.on('warning', (w) => { if (w && w.name !== 'ExperimentalWarning') console.warn(w); });

const { createApp, boot } = require('./src/app');
const config = require('./src/core/config');

const app = createApp();
const cfg = config.get();

boot((m) => console.log(m))
  .then((state) => {
    app.locals.booted = true;
    const server = app.listen(cfg.port, cfg.host, () => {
      const addr = server.address();
      const where = typeof addr === 'string' ? addr : `http://${addr.address === '::' ? 'localhost' : addr.address}:${addr.port}`;
      console.log(`[madrese] v${require('./package.json').version} | ${state.installed ? 'آماده' : 'نیاز به نصب → /install'} | ${where}`);
    });
    server.keepAliveTimeout = 65000;
    const shutdown = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  })
  .catch((err) => {
    console.error('[madrese] خطا در راه‌اندازی:', err);
    // حتی در صورت خطای اتصال، برنامه بالا می‌آید تا صفحهٔ نصب/خطا نمایش داده شود
    app.locals.bootError = err;
    app.listen(cfg.port, cfg.host, () => console.log('[madrese] در حالت محدود اجرا شد (خطای پایگاه داده)'));
  });

module.exports = app;
