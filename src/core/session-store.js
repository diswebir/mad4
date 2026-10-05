'use strict';
/**
 * ذخیره‌ساز نشست روی پایگاه داده (سازگار با express-session)
 */
const session = require('express-session');
const db = require('./db');

class DbSessionStore extends session.Store {
  constructor(opts) {
    super();
    this.ttl = (opts && opts.ttlMs) || 7 * 86400000;
    this._cleanupTimer = setInterval(() => this.cleanup().catch(() => {}), 30 * 60000);
    if (this._cleanupTimer.unref) this._cleanupTimer.unref();
  }
  get(sid, cb) {
    db.table('sessions').where('sid', sid).first()
      .then((row) => {
        if (!row) return cb(null, null);
        if (row.expires_at && Number(row.expires_at) < Date.now()) { this.destroy(sid, () => cb(null, null)); return; }
        try { cb(null, JSON.parse(row.data)); } catch (e) { cb(null, null); }
      }).catch((e) => cb(e));
  }
  set(sid, sess, cb) {
    const expires = sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + this.ttl;
    const data = JSON.stringify(sess);
    db.table('sessions').where('sid', sid).first()
      .then((row) => row
        ? db.update('sessions', { data, expires_at: expires }, { sid })
        : db.insert('sessions', { sid, data, expires_at: expires }))
      .then(() => cb && cb(null)).catch((e) => cb && cb(e));
  }
  touch(sid, sess, cb) {
    const expires = sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + this.ttl;
    db.update('sessions', { expires_at: expires }, { sid }).then(() => cb && cb(null)).catch((e) => cb && cb(e));
  }
  destroy(sid, cb) { db.remove('sessions', { sid }).then(() => cb && cb(null)).catch((e) => cb && cb(e)); }
  async cleanup() { if (db.isReady()) await db.table('sessions').where('expires_at', '<', Date.now()).delete(); }
  /** حذف همهٔ نشست‌های یک کاربر (مثلاً پس از غیرفعال شدن) */
  static async destroyUser(userId) {
    const rows = await db.table('sessions').all();
    for (const r of rows) {
      try { const s = JSON.parse(r.data); if (s.userId === userId) await db.remove('sessions', { id: r.id }); } catch (e) { /* ignore */ }
    }
  }
}
module.exports = DbSessionStore;
