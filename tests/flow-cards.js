'use strict';
/** جریان: کارت هوشمند دانش‌آموزی — بارکد Code 128، QR استعلام، صفحهٔ عمومی استعلام، ابطال/صدور مجدد، امانت سریع با اسکن (library.scan)، QR اسناد */
const { Client } = require('./client');
const barcode = require('../src/core/barcode');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 2; } else console.log('ok:', m); };
const strip = (h) => String(h || '').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const tokenOf = (html) => (html.match(/کد یکتای کارت: <code>([A-Z0-9]+)<\/code>/) || [])[1];

(async () => {
  // ---------- واحد: Code 128 ----------
  const seq = barcode.symbols('PJJ123C'); // نمونهٔ مرجع (ویکی‌پدیا): چک‌سام در مجموعهٔ A = ۵۴؛ در مجموعهٔ B (شروع ۱۰۴) = ۵۵
  assert(seq[0] === 104 && seq[seq.length - 1] === 106 && seq[seq.length - 2] === 55, 'code128 checksum matches reference example');
  const c = barcode.symbols('400012'); assert(c[0] === 105 && c.length === 6 && c[1] === 40 && c[3] === 12, 'even-length digits use code set C');
  const svg = barcode.code128('40001', { height: 30 });
  assert(/^<svg /.test(svg) && (svg.match(/<rect x=/g) || []).length === 3 * 8 + 1 && /aria-label="40001"/.test(svg), 'code128 svg has 3 bars per symbol (+ stop bar) and a label');
  let threw = false; try { barcode.code128('سلام'); } catch (e) { threw = true; } assert(threw, 'non-ASCII input is rejected');
  const q1 = barcode.qr('https://example.com/students/verify/ABC', { size: 64 }); assert(/^<svg width="64" height="64"/.test(q1) && /<path/.test(q1), 'qr svg generated with size');
  assert(barcode.qr('https://example.com/students/verify/ABC', { size: 64 }) === q1, 'qr result is cached');

  const a = new Client(); let r = await a.login('admin', 'admin123'); assert(r.status === 302, 'admin login');
  for (const key of ['students.id_card', 'students.card_qr', 'library.scan', 'documents.verify']) await a.post('/system/modules/toggle', { key, enabled: '1' });

  // ---------- کارت تکی ----------
  r = await a.get('/students/1/card');
  assert(r.status === 200 && /<svg[^>]*aria-label="40001"/.test(r.text), 'card shows real Code 128 barcode of the student number');
  assert((r.text.match(/<div class="qr"/g) || []).length === 1, 'card shows one QR block');
  const token = tokenOf(r.text); assert(token && /^[A-Z0-9]{12}$/.test(token), 'card token generated (12 chars): ' + token);
  assert(new RegExp('/students/verify/' + token).test(r.text), 'admin toolbar links to verify page');

  // ---------- استعلام عمومی ----------
  const g = new Client();
  r = await g.get('/students/verify/' + token); let t = strip(r.text);
  assert(r.status === 200 && /کارت معتبر است/.test(t) && /۴۰۰۰۱/.test(t) && /هفتم الف/.test(t), 'public verify page shows valid card with number and class');
  assert(!/کد ملی|تلفن|09\d{9}/.test(t), 'verify page exposes no national id / phone');
  r = await g.get('/students/verify/NOPE12345'); assert(r.status === 404 && /یافت نشد/.test(strip(r.text)), 'unknown token → 404 with message');
  r = await g.get('/students/verify?code=' + token); assert(r.status === 302 && r.location === '/students/verify/' + token, 'verify form redirects to token page');
  r = await g.get('/students/verify?code=' + token.toLowerCase()); assert(r.status === 302 && /\/students\/verify\//.test(r.location), 'lower-case input accepted by the form');
  r = await g.get('/students/verify'); assert(r.status === 200 && /استعلام کارت دانش‌آموزی/.test(r.text), 'verify form renders without login');

  // ---------- ابطال و صدور مجدد ----------
  r = await a.post('/students/1/card/reissue', {}); assert(r.status === 302 && r.location === '/students/1/card', 'reissue redirects to card');
  r = await a.get('/students/1/card'); const token2 = tokenOf(r.text); assert(token2 && token2 !== token, 'new token differs from old');
  r = await g.get('/students/verify/' + token); assert(r.status === 404, 'old token no longer valid');
  r = await g.get('/students/verify/' + token2); assert(r.status === 200 && /کارت معتبر است/.test(strip(r.text)), 'new token valid');
  r = await a.get('/system/activity?action=card_reissue'); assert(r.status === 200 && /ابطال و صدور مجدد کارت/.test(strip(r.text)), 'reissue is logged in activity log');

  // ---------- کارت کلاس / گروهی ----------
  r = await a.get('/students/cards/class/1'); const n = (r.text.match(/<div class="qr"/g) || []).length; assert(r.status === 200 && n >= 10, 'class cards all have QR (' + n + ')');
  assert((r.text.match(/aria-label="4000\d"/g) || []).length >= 1, 'class cards have barcodes');

  // ---------- معلم ----------
  const te = new Client(); r = await te.login('teacher1', '123456'); assert(r.status === 302, 'teacher login');
  r = await te.get('/students/1/card'); assert(r.status === 200 && /class="qr"/.test(r.text) && !/ابطال و صدور مجدد/.test(r.text), 'teacher sees card with QR but no reissue button');
  r = await te.post('/students/1/card/reissue', {}); assert(r.status === 403, 'teacher cannot reissue');

  // ---------- دانش‌آموز: کارت خودش ----------
  const s = new Client(); r = await s.login('40001', '123456'); assert(r.status === 302, 'student login');
  r = await s.get('/students/1/card'); assert(r.status === 200 && /class="qr"/.test(r.text), 'student can print own card with QR');
  r = await s.get('/students/2/card'); assert(r.status === 403, 'student cannot open another student card');

  // ---------- امانت سریع با اسکن ----------
  r = await a.get('/library/loans/new'); assert(r.status === 200 && /id="loanScan"/.test(r.text) && /\/library\/api\/lookup/.test(r.text), 'loan form has scan box');
  r = await a.get('/library/api/lookup?code=40001'); let j = JSON.parse(r.text); assert(r.status === 200 && j.student && j.student.id === 1 && /هفتم الف/.test(j.student.class_title), 'lookup by student number');
  r = await a.get('/library/api/lookup?code=۴۰۰۰۱'); j = JSON.parse(r.text); assert(j.student && j.student.id === 1, 'lookup accepts Persian digits');
  r = await a.get('/library/api/lookup?code=1'); j = JSON.parse(r.text); assert(j.book && j.book.id === 1 && typeof j.book.available_copies === 'number', 'lookup by book id');
  const bk = await a.get('/library/api/lookup?code=1'); const book1 = await a.get('/library/1/edit'); const isbn = (book1.text.match(/name="isbn"[^>]*value="([^"]+)"/) || [])[1];
  if (isbn) { r = await a.get('/library/api/lookup?code=' + encodeURIComponent(isbn)); j = JSON.parse(r.text); assert(j.book && j.book.id === 1, 'lookup by ISBN ' + isbn); } else assert(bk.status === 200, 'book 1 has no isbn — skip isbn lookup');
  r = await a.get('/library/api/lookup?code=zzz'); j = JSON.parse(r.text); assert(j.error, 'unknown code → error message');
  r = await a.get('/library/api/lookup?code='); j = JSON.parse(r.text); assert(j.error, 'empty code → error message');
  r = await s.get('/library/api/lookup?code=40001'); assert(r.status === 403, 'student cannot use lookup');

  // ---------- QR روی اسناد ----------
  const docs = await a.get('/documents'); const m = /href="\/documents\/(\d+)"/.exec(docs.text);
  if (m) { r = await a.get('/documents/' + m[1]); const i = r.text.indexOf('signature-block'); assert(i > 0 && /width:52px[^>]*>\s*<svg/.test(r.text.slice(i, i + 1500)), 'issued document shows verification QR in signature block'); }

  // ---------- غیرفعال‌سازی ----------
  r = await a.post('/system/modules/toggle', { key: 'students.card_qr', enabled: '0' }); assert(r.status === 200, 'disable card_qr');
  r = await g.get('/students/verify/' + token2); assert(r.status === 404, 'verify 404 when feature off');
  r = await a.get('/students/1/card'); assert(r.status === 200 && !/class="qr"/.test(r.text) && /aria-label="40001"/.test(r.text), 'card without QR but still with barcode when feature off');
  r = await a.post('/students/1/card/reissue', {}); assert(r.status === 404, 'reissue 404 when feature off');
  await a.post('/system/modules/toggle', { key: 'students.card_qr', enabled: '1' });
  r = await a.post('/system/modules/toggle', { key: 'library.scan', enabled: '0' }); assert(r.status === 200, 'disable library.scan');
  r = await a.get('/library/loans/new'); assert(r.status === 200 && !/id="loanScan"/.test(r.text), 'scan box hidden when off');
  r = await a.get('/library/api/lookup?code=40001'); assert(r.status === 404, 'lookup 404 when off');
  await a.post('/system/modules/toggle', { key: 'library.scan', enabled: '1' });
  console.log('done');
})().catch((e) => { console.error(e); process.exit(1); });
