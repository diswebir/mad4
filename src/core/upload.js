'use strict';
/** بارگذاری فایل با multer — ذخیره در storage/uploads/<folder>/ */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const config = require('./config');
const csrf = require('./csrf');

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const DOC_TYPES = [...IMAGE_TYPES, 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/plain', 'text/csv', 'application/zip', 'application/x-zip-compressed', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'audio/mpeg', 'video/mp4'];
const BLOCKED_EXT = /\.(php|phtml|js|mjs|cjs|exe|sh|bat|cmd|html|htm|svg|jsp|asp|aspx|pl|py|cgi)$/i;

function uploader(folder, opts) {
  opts = opts || {};
  const cfg = config.get();
  const dest = path.join(cfg.uploads.dir, folder);
  const storage = multer.diskStorage({
    destination: (req, file, cb) => { fs.mkdirSync(dest, { recursive: true }); cb(null, dest); },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase().slice(0, 10);
      cb(null, Date.now().toString(36) + '-' + crypto.randomBytes(6).toString('hex') + ext);
    }
  });
  return multer({
    storage,
    limits: { fileSize: (opts.maxMb || cfg.uploads.maxSizeMb) * 1024 * 1024, files: opts.maxFiles || 5 },
    fileFilter: (req, file, cb) => {
      const allowed = opts.images ? IMAGE_TYPES : DOC_TYPES;
      // نام اصلی فایل را به UTF-8 برمی‌گردانیم (مرورگرها latin1 می‌فرستند)
      try { file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8'); } catch (e) { /* ignore */ }
      if (BLOCKED_EXT.test(file.originalname || '')) return cb(new Error('این نوع فایل مجاز نیست'));
      if (!allowed.includes(file.mimetype)) return cb(new Error('نوع فایل مجاز نیست: ' + file.mimetype));
      cb(null, true);
    }
  });
}
/** پوشاندن خطای multer به‌صورت پیام کاربرپسند (و ادامهٔ مسیر با req.uploadError) */
function wrap(mw) {
  return (req, res, next) => mw(req, res, (err) => {
    if (err) { req.uploadError = err.code === 'LIMIT_FILE_SIZE' ? 'حجم فایل بیش از حد مجاز است' : (err.message || 'خطا در بارگذاری فایل'); }
    next();
  });
}
/** زنجیرهٔ میان‌افزار برای فرم‌های multipart: تجزیهٔ فایل‌ها + تأیید CSRF */
function form(folder, kind, fieldsOrName, opts) {
  const u = uploader(folder, opts);
  let mw;
  if (kind === 'single') mw = u.single(fieldsOrName);
  else if (kind === 'array') mw = u.array(fieldsOrName, (opts && opts.maxFiles) || 5);
  else if (kind === 'fields') mw = u.fields(fieldsOrName);
  else mw = multer().none();
  return [wrap(mw), csrf.verify];
}
/** فقط تجزیهٔ فرم multipart بدون فایل */
const none = () => [wrap(multer().none()), csrf.verify];
/** مسیر نسبی برای ذخیره در DB */
function relPath(file) { if (!file) return null; return path.relative(config.get().uploads.dir, file.path).split(path.sep).join('/'); }
function absPath(rel) { return path.join(config.get().uploads.dir, rel); }
function removeFile(rel) { if (!rel) return; try { fs.unlinkSync(absPath(rel)); } catch (e) { /* ignore */ } }
module.exports = { uploader, wrap, form, none, relPath, absPath, removeFile, IMAGE_TYPES, DOC_TYPES };
