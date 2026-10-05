/* تقویم شمسی سمت کاربر + انتخابگر تاریخ سبک (بدون وابستگی) */
(function (global) {
  'use strict';
  function div(a, b) { return ~~(a / b); }
  function mod(a, b) { return a - ~~(a / b) * b; }
  var breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
  function jalCal(jy) {
    var bl = breaks.length, gy = jy + 621, leapJ = -14, jp = breaks[0], jm, jump, leap, n, i;
    for (i = 1; i < bl; i += 1) { jm = breaks[i]; jump = jm - jp; if (jy < jm) break; leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4); jp = jm; }
    n = jy - jp;
    leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
    if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
    var leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
    var march = 20 + leapJ - leapG;
    if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
    leap = mod(mod(n + 1, 33) - 1, 4);
    if (leap === -1) leap = 4;
    return { leap: leap, gy: gy, march: march };
  }
  function g2d(gy, gm, gd) { var d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408; d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752; return d; }
  function d2g(jdn) { var j = 4 * jdn + 139361631; j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908; var i = div(mod(j, 1461), 4) * 5 + 308; var gd = div(mod(i, 153), 5) + 1; var gm = mod(div(i, 153), 12) + 1; var gy = div(j, 1461) - 100100 + div(8 - gm, 6); return { gy: gy, gm: gm, gd: gd }; }
  function j2d(jy, jm, jd) { var r = jalCal(jy); return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1; }
  function d2j(jdn) { var gy = d2g(jdn).gy, jy = gy - 621, r = jalCal(jy), jdn1f = g2d(gy, 3, r.march), jd, jm, k; k = jdn - jdn1f; if (k >= 0) { if (k <= 185) { jm = 1 + div(k, 31); jd = mod(k, 31) + 1; return { jy: jy, jm: jm, jd: jd }; } else k -= 186; } else { jy -= 1; k += 179; if (r.leap === 1) k += 1; } jm = 7 + div(k, 30); jd = mod(k, 30) + 1; return { jy: jy, jm: jm, jd: jd }; }
  function toJalaali(gy, gm, gd) { return d2j(g2d(gy, gm, gd)); }
  function toGregorian(jy, jm, jd) { return d2g(j2d(jy, jm, jd)); }
  function monthLength(jy, jm) { if (jm <= 6) return 31; if (jm <= 11) return 30; return jalCal(jy).leap === 0 ? 30 : 29; }
  function isValid(jy, jm, jd) { return jy >= 1 && jm >= 1 && jm <= 12 && jd >= 1 && jd <= monthLength(jy, jm); }
  var MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
  var WD = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fa(s) { return String(s).replace(/\d/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[d]; }); }
  function en(s) { return String(s).replace(/[۰-۹]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'.indexOf(d); }).replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); }); }
  function parse(str) { var m = /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/.exec(en(str || '').trim()); if (!m) return null; var jy = +m[1], jm = +m[2], jd = +m[3]; return isValid(jy, jm, jd) ? { jy: jy, jm: jm, jd: jd } : null; }
  function format(j) { return j.jy + '/' + pad(j.jm) + '/' + pad(j.jd); }
  function today() { var d = new Date(); return toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
  function weekday(jy, jm, jd) { var g = toGregorian(jy, jm, jd); var d = new Date(g.gy, g.gm - 1, g.gd); return (d.getDay() + 1) % 7; }

  /* ---------- انتخابگر ---------- */
  var openDp = null;
  function closeDp() { if (openDp) { openDp.remove(); openDp = null; } }
  document.addEventListener('click', function (e) { if (openDp && !openDp.contains(e.target) && e.target !== openDp._input) closeDp(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDp(); });

  function attach(input) {
    if (input._dp) return;
    input._dp = true;
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('inputmode', 'numeric');
    input.setAttribute('dir', 'ltr');
    input.classList.add('text-center');
    if (!input.placeholder) input.placeholder = 'مثال: ' + format(today());
    input.addEventListener('focus', function () { show(input); });
    input.addEventListener('click', function () { show(input); });
    input.addEventListener('blur', function () { var p = parse(input.value); if (p) input.value = format(p); });
    input.addEventListener('input', function () { input.value = en(input.value).replace(/[^\d\/]/g, ''); });
  }

  function show(input) {
    closeDp();
    var cur = parse(input.value) || today();
    var view = { jy: cur.jy, jm: cur.jm };
    var sel = parse(input.value);
    var dp = document.createElement('div');
    dp.className = 'dp';
    dp._input = input;
    function render() {
      var t = today();
      var years = '';
      for (var y = view.jy - 70; y <= view.jy + 10; y++) years += '<option value="' + y + '"' + (y === view.jy ? ' selected' : '') + '>' + fa(y) + '</option>';
      var months = MONTHS.map(function (m, i) { return '<option value="' + (i + 1) + '"' + (i + 1 === view.jm ? ' selected' : '') + '>' + m + '</option>'; }).join('');
      var html = '<div class="dp-head"><button type="button" class="btn btn-sm btn-light" data-nav="-1">&rsaquo;</button><select data-m>' + months + '</select><select data-y>' + years + '</select><button type="button" class="btn btn-sm btn-light" data-nav="1">&lsaquo;</button></div><div class="dp-grid">';
      html += WD.map(function (w) { return '<span>' + w + '</span>'; }).join('');
      var first = weekday(view.jy, view.jm, 1);
      for (var i = 0; i < first; i++) html += '<i></i>';
      var len = monthLength(view.jy, view.jm);
      for (var d = 1; d <= len; d++) {
        var cls = [];
        if (sel && sel.jy === view.jy && sel.jm === view.jm && sel.jd === d) cls.push('sel');
        if (t.jy === view.jy && t.jm === view.jm && t.jd === d) cls.push('today');
        if ((first + d - 1) % 7 === 6) cls.push('fri');
        html += '<button type="button" class="' + cls.join(' ') + '" data-d="' + d + '">' + fa(d) + '</button>';
      }
      html += '</div><div class="dp-foot"><button type="button" data-today>امروز</button><button type="button" data-clear>پاک کردن</button></div>';
      dp.innerHTML = html;
    }
    render();
    dp.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.nav) { view.jm += +b.dataset.nav; if (view.jm > 12) { view.jm = 1; view.jy++; } if (view.jm < 1) { view.jm = 12; view.jy--; } render(); return; }
      if (b.dataset.d) { input.value = format({ jy: view.jy, jm: view.jm, jd: +b.dataset.d }); input.dispatchEvent(new Event('change', { bubbles: true })); closeDp(); return; }
      if (b.hasAttribute('data-today')) { input.value = format(today()); input.dispatchEvent(new Event('change', { bubbles: true })); closeDp(); return; }
      if (b.hasAttribute('data-clear')) { input.value = ''; input.dispatchEvent(new Event('change', { bubbles: true })); closeDp(); }
    });
    dp.addEventListener('change', function (e) { if (e.target.matches('[data-m]')) { view.jm = +e.target.value; render(); } if (e.target.matches('[data-y]')) { view.jy = +e.target.value; render(); } });
    document.body.appendChild(dp);
    var r = input.getBoundingClientRect();
    var top = r.bottom + window.scrollY + 4;
    var left = r.left + window.scrollX;
    if (left + 270 > window.innerWidth) left = Math.max(8, r.right + window.scrollX - 270);
    if (top + 300 > window.scrollY + window.innerHeight && r.top > 300) top = r.top + window.scrollY - 300;
    dp.style.top = top + 'px';
    dp.style.left = left + 'px';
    openDp = dp;
  }

  function init(root) { (root || document).querySelectorAll('input.jdate').forEach(attach); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(); }); else init();

  global.Jalali = { toJalaali: toJalaali, toGregorian: toGregorian, monthLength: monthLength, isValid: isValid, parse: parse, format: format, today: today, fa: fa, en: en, MONTHS: MONTHS, init: init, attach: attach };
})(window);
