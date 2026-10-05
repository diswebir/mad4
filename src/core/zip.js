'use strict';
/**
 * نوشتن/خواندن فایل ZIP بدون وابستگی خارجی (برای خروجی xlsx و پشتیبان کامل).
 *  - نام فایل‌ها UTF-8 (بیت ۱۱ پرچم عمومی) → نام‌های فارسی سالم می‌مانند.
 *  - نوشتن جریانی روی فایل (ZipWriter) برای پشتیبان‌های بزرگ + ساخت در حافظه (build) برای xlsx.
 *  - خواندن از روی فهرست مرکزی (central directory) با پشتیبانی از روش «ذخیره» و «deflate».
 */
const fs = require('fs');
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf, prev) {
  let c = (prev == null ? 0 : prev) ^ 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
  d = d || new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2));
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time: time & 0xffff, date: date & 0xffff };
}

function localHeader(e) {
  const name = Buffer.from(e.name, 'utf8');
  const h = Buffer.alloc(30 + name.length);
  h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(e.flags, 6); h.writeUInt16LE(e.method, 8);
  h.writeUInt16LE(e.time, 10); h.writeUInt16LE(e.date, 12); h.writeUInt32LE(e.flags & 8 ? 0 : e.crc, 14);
  h.writeUInt32LE(e.flags & 8 ? 0 : e.csize, 18); h.writeUInt32LE(e.flags & 8 ? 0 : e.size, 22); h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
  name.copy(h, 30);
  return h;
}
function dataDescriptor(e) { const b = Buffer.alloc(16); b.writeUInt32LE(0x08074b50, 0); b.writeUInt32LE(e.crc, 4); b.writeUInt32LE(e.csize, 8); b.writeUInt32LE(e.size, 12); return b; }
function centralDirectory(entries, offset) {
  const parts = [];
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const h = Buffer.alloc(46 + name.length);
    h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6); h.writeUInt16LE(e.flags, 8); h.writeUInt16LE(e.method, 10);
    h.writeUInt16LE(e.time, 12); h.writeUInt16LE(e.date, 14); h.writeUInt32LE(e.crc, 16); h.writeUInt32LE(e.csize, 20); h.writeUInt32LE(e.size, 24);
    h.writeUInt16LE(name.length, 28); h.writeUInt16LE(0, 30); h.writeUInt16LE(0, 32); h.writeUInt16LE(0, 34); h.writeUInt16LE(0, 36); h.writeUInt32LE(0, 38); h.writeUInt32LE(e.offset, 42);
    name.copy(h, 46); parts.push(h);
  }
  const cd = Buffer.concat(parts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([cd, end]);
}

/** ساخت ZIP در حافظه: entries = [{ name, data: Buffer|string, store?: boolean }] */
function build(entries, opts) {
  opts = opts || {};
  const chunks = []; const list = []; let offset = 0;
  const dt = dosDateTime(opts.date);
  for (const it of entries) {
    const data = Buffer.isBuffer(it.data) ? it.data : Buffer.from(String(it.data == null ? '' : it.data), 'utf8');
    const store = it.store || data.length === 0;
    const comp = store ? data : zlib.deflateRawSync(data, { level: opts.level == null ? 6 : opts.level });
    const e = { name: it.name, flags: 0x800, method: store ? 0 : 8, time: dt.time, date: dt.date, crc: crc32(data), csize: comp.length, size: data.length, offset };
    const h = localHeader(e); chunks.push(h, comp); offset += h.length + comp.length; list.push(e);
  }
  chunks.push(centralDirectory(list, offset));
  return Buffer.concat(chunks);
}

/** نویسندهٔ جریانی روی فایل — برای پشتیبان‌های بزرگ */
class ZipWriter {
  constructor(filePath) { this.path = filePath; this.fd = fs.openSync(filePath, 'w'); this.offset = 0; this.entries = []; this.dt = dosDateTime(); }
  _write(buf) { fs.writeSync(this.fd, buf); this.offset += buf.length; }
  /** افزودن دادهٔ در حافظه */
  add(name, data, opts) {
    opts = opts || {};
    data = Buffer.isBuffer(data) ? data : Buffer.from(String(data == null ? '' : data), 'utf8');
    const store = opts.store || data.length === 0;
    const comp = store ? data : zlib.deflateRawSync(data, { level: opts.level == null ? 6 : opts.level });
    const e = { name, flags: 0x800, method: store ? 0 : 8, time: this.dt.time, date: this.dt.date, crc: crc32(data), csize: comp.length, size: data.length, offset: this.offset };
    this._write(localHeader(e)); this._write(comp); this.entries.push(e);
    return e;
  }
  /** افزودن فایل از دیسک به‌صورت جریانی (با توصیف‌گر داده؛ بدون بارگذاری کامل در حافظه) */
  async addFile(name, absPath, opts) {
    opts = opts || {};
    const e = { name, flags: 0x800 | 8, method: opts.store ? 0 : 8, time: this.dt.time, date: this.dt.date, crc: 0, csize: 0, size: 0, offset: this.offset };
    this._write(localHeader(e));
    await new Promise((resolve, reject) => {
      const src = fs.createReadStream(absPath, { highWaterMark: 1 << 20 });
      let crc = 0, size = 0, csize = 0;
      const onComp = (chunk) => { csize += chunk.length; fs.writeSync(this.fd, chunk); };
      src.on('data', (chunk) => { crc = crc32(chunk, crc); size += chunk.length; });
      src.on('error', reject);
      if (e.method === 0) { src.on('data', onComp); src.on('end', () => { e.crc = crc; e.size = size; e.csize = csize; resolve(); }); }
      else {
        const df = zlib.createDeflateRaw({ level: opts.level == null ? 6 : opts.level });
        df.on('data', onComp); df.on('error', reject); df.on('end', () => { e.crc = crc; e.size = size; e.csize = csize; resolve(); });
        src.pipe(df);
      }
    });
    this.offset += e.csize;
    this._write(dataDescriptor(e)); this.entries.push(e);
    return e;
  }
  close() { this._write(centralDirectory(this.entries, this.offset)); fs.closeSync(this.fd); return { path: this.path, size: this.offset, count: this.entries.length }; }
}

// ---------------- خواندن ----------------
function readEOCD(fd, fileSize) {
  const max = Math.min(fileSize, 22 + 65535);
  const buf = Buffer.alloc(max);
  fs.readSync(fd, buf, 0, max, fileSize - max);
  for (let i = max - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return { count: buf.readUInt16LE(i + 10), cdSize: buf.readUInt32LE(i + 12), cdOffset: buf.readUInt32LE(i + 16) };
  }
  throw new Error('فایل ZIP معتبر نیست (فهرست مرکزی یافت نشد)');
}

/** خوانندهٔ ZIP: entries() فهرست؛ read(entry) → Buffer؛ extractTo(entry, absPath) جریانی */
class ZipReader {
  constructor(filePath) {
    this.path = filePath; this.fd = fs.openSync(filePath, 'r'); this.size = fs.fstatSync(this.fd).size;
    const eocd = readEOCD(this.fd, this.size);
    const cd = Buffer.alloc(eocd.cdSize); fs.readSync(this.fd, cd, 0, eocd.cdSize, eocd.cdOffset);
    this.list = []; let p = 0;
    while (p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50) {
      const flags = cd.readUInt16LE(p + 8), method = cd.readUInt16LE(p + 10), crc = cd.readUInt32LE(p + 16), csize = cd.readUInt32LE(p + 20), size = cd.readUInt32LE(p + 24);
      const nLen = cd.readUInt16LE(p + 28), xLen = cd.readUInt16LE(p + 30), cLen = cd.readUInt16LE(p + 32), offset = cd.readUInt32LE(p + 42);
      const raw = cd.subarray(p + 46, p + 46 + nLen);
      const name = (flags & 0x800) ? raw.toString('utf8') : raw.toString('latin1');
      this.list.push({ name, method, crc, csize, size, offset, dir: name.endsWith('/') });
      p += 46 + nLen + xLen + cLen;
    }
  }
  entries() { return this.list; }
  find(name) { return this.list.find((e) => e.name === name) || null; }
  _dataOffset(e) {
    const h = Buffer.alloc(30); fs.readSync(this.fd, h, 0, 30, e.offset);
    if (h.readUInt32LE(0) !== 0x04034b50) throw new Error('سرآیند ZIP نامعتبر: ' + e.name);
    return e.offset + 30 + h.readUInt16LE(26) + h.readUInt16LE(28);
  }
  read(e) {
    if (typeof e === 'string') { const f = this.find(e); if (!f) throw new Error('در ZIP یافت نشد: ' + e); e = f; }
    const start = this._dataOffset(e);
    const comp = Buffer.alloc(e.csize); if (e.csize) fs.readSync(this.fd, comp, 0, e.csize, start);
    if (e.method === 0) return comp;
    if (e.method === 8) return zlib.inflateRawSync(comp);
    throw new Error('روش فشرده‌سازی پشتیبانی نمی‌شود: ' + e.method);
  }
  extractTo(e, absPath) {
    const start = this._dataOffset(e);
    return new Promise((resolve, reject) => {
      if (!e.csize) { fs.writeFileSync(absPath, Buffer.alloc(0)); return resolve(); }
      const src = fs.createReadStream(this.path, { start, end: start + e.csize - 1 });
      const out = fs.createWriteStream(absPath);
      out.on('finish', resolve); out.on('error', reject); src.on('error', reject);
      if (e.method === 0) src.pipe(out);
      else if (e.method === 8) { const inf = zlib.createInflateRaw(); inf.on('error', reject); src.pipe(inf).pipe(out); }
      else reject(new Error('روش فشرده‌سازی پشتیبانی نمی‌شود: ' + e.method));
    });
  }
  close() { try { fs.closeSync(this.fd); } catch (e) { /* ignore */ } }
}

module.exports = { crc32, build, ZipWriter, ZipReader };
