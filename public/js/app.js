/* رفتارهای عمومی رابط کاربری */
(function () {
  'use strict';
  var body = document.body;
  var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';

  // منوی کناری در موبایل
  document.querySelectorAll('[data-toggle-sidebar]').forEach(function (b) { b.addEventListener('click', function () { body.classList.toggle('sidebar-open'); }); });
  var backdrop = document.querySelector('.sidebar-backdrop');
  if (backdrop) backdrop.addEventListener('click', function () { body.classList.remove('sidebar-open'); });

  // تغییر پوسته
  document.querySelectorAll('[data-toggle-theme]').forEach(function (b) {
    b.addEventListener('click', function () {
      var html = document.documentElement;
      var next = html.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-bs-theme', next);
      try { localStorage.setItem('theme', next); } catch (e) {}
      fetch('/auth/theme', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'Accept': 'application/json' }, body: JSON.stringify({ theme: next }) }).catch(function () {});
      b.querySelector('i') && (b.querySelector('i').className = next === 'dark' ? 'bi bi-sun' : 'bi bi-moon-stars');
    });
  });

  // تأیید حذف و اقدامات حساس
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (f.matches('[data-confirm]')) { if (!window.confirm(f.getAttribute('data-confirm') || 'آیا مطمئن هستید؟')) { e.preventDefault(); return; } }
    var btn = f.querySelector('[type="submit"]');
    if (btn && !f.hasAttribute('data-no-lock')) { setTimeout(function () { btn.disabled = true; btn.classList.add('disabled'); }, 10); setTimeout(function () { btn.disabled = false; btn.classList.remove('disabled'); }, 8000); }
  });
  document.addEventListener('click', function (e) {
    var p = e.target.closest('[data-post]');
    var a = e.target.closest('a[data-confirm]');
    if (a && !p && !window.confirm(a.getAttribute('data-confirm'))) { e.preventDefault(); return; }
    // دکمه‌های POST ساده (data-post)
    if (p) {
      e.preventDefault();
      if (p.hasAttribute('data-confirm') && !window.confirm(p.getAttribute('data-confirm'))) return;
      var form = document.createElement('form');
      form.method = 'POST'; form.action = p.getAttribute('data-post');
      form.innerHTML = '<input type="hidden" name="_csrf" value="' + csrf + '">';
      var extra = p.getAttribute('data-params');
      if (extra) { try { var obj = JSON.parse(extra); Object.keys(obj).forEach(function (k) { var i = document.createElement('input'); i.type = 'hidden'; i.name = k; i.value = obj[k]; form.appendChild(i); }); } catch (err) {} }
      document.body.appendChild(form); form.submit();
    }
    // کپی متن
    var c = e.target.closest('[data-copy]');
    if (c) { var txt = c.getAttribute('data-copy') || c.textContent; navigator.clipboard && navigator.clipboard.writeText(txt.trim()); toast('کپی شد: ' + txt.trim()); }
  });

  // فیلتر زندهٔ فهرست‌ها (data-filter-table="#container" روی input؛ عناصر .filter-item با data-text یا متن ردیف)
  document.querySelectorAll('input[data-filter-table]').forEach(function (inp) {
    var box = document.querySelector(inp.getAttribute('data-filter-table'));
    if (!box) return;
    inp.addEventListener('input', function () {
      var q = inp.value.trim().toLowerCase().replace(/ي/g, 'ی').replace(/ك/g, 'ک');
      var items = box.querySelectorAll('.filter-item, tbody tr');
      items.forEach(function (it) { var t = (it.getAttribute('data-text') || it.textContent).toLowerCase(); it.style.display = !q || t.indexOf(q) !== -1 ? '' : 'none'; });
    });
  });

  // بستن خودکار هشدارها
  setTimeout(function () { document.querySelectorAll('.alert-auto').forEach(function (a) { try { bootstrap.Alert.getOrCreateInstance(a).close(); } catch (e) {} }); }, 6000);

  // تبدیل ارقام فارسی به لاتین در فیلدهای عددی/تلفن
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.matches('input[data-digits], input[type="tel"], input[type="number"], input.en-digits')) {
      var v = t.value.replace(/[۰-۹]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'.indexOf(d); }).replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); });
      if (v !== t.value) t.value = v;
    }
  });

  // انتخاب همه در جدول‌ها
  document.querySelectorAll('[data-check-all]').forEach(function (master) {
    master.addEventListener('change', function () { document.querySelectorAll(master.getAttribute('data-check-all')).forEach(function (c) { c.checked = master.checked; }); });
  });

  // ارسال خودکار فرم فیلتر هنگام تغییر
  document.querySelectorAll('form[data-auto-submit] select, form[data-auto-submit] input[type="date"], select[data-auto-submit], input[data-auto-submit]').forEach(function (el) { el.addEventListener('change', function () { if (el.form) el.form.submit(); }); });

  // تولتیپ‌ها
  if (window.bootstrap) document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(function (el) { new bootstrap.Tooltip(el); });

  // اعلان‌ها: علامت‌گذاری خوانده‌شده هنگام بازکردن
  var notifBtn = document.getElementById('notifBtn');
  if (notifBtn) notifBtn.addEventListener('shown.bs.dropdown', function () {
    fetch('/notifications/read-all', { method: 'POST', headers: { 'X-CSRF-Token': csrf, 'Accept': 'application/json' } }).then(function () { var d = notifBtn.querySelector('.dot'); if (d) d.remove(); }).catch(function () {});
  });

  // نمایش نام فایل انتخاب‌شده
  document.addEventListener('change', function (e) { if (e.target.matches('input[type="file"][data-preview]')) { var img = document.querySelector(e.target.getAttribute('data-preview')); if (img && e.target.files[0]) img.src = URL.createObjectURL(e.target.files[0]); } });

  // چاپ
  document.querySelectorAll('[data-print]').forEach(function (b) { b.addEventListener('click', function () { window.print(); }); });

  // جستجوی سریع (Ctrl+K)
  var search = document.getElementById('globalSearch');
  document.addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && search) { e.preventDefault(); search.focus(); } });

  // فعال‌سازی/غیرفعال‌سازی ماژول‌ها با AJAX
  document.querySelectorAll('[data-module-toggle]').forEach(function (sw) {
    sw.addEventListener('change', function () {
      var key = sw.getAttribute('data-module-toggle');
      fetch('/system/modules/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'Accept': 'application/json' }, body: JSON.stringify({ key: key, enabled: sw.checked }) })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d.ok) { sw.checked = !sw.checked; toast(d.error || 'خطا', 'danger'); return; }
          toast(d.message || 'ذخیره شد', 'success');
          var card = sw.closest('.module-card');
          if (card && !key.includes('.')) card.classList.toggle('disabled', !sw.checked);
          if (d.stats) { var el = document.getElementById('featEnabled'); if (el) el.textContent = Jalali ? Jalali.fa(d.stats.featuresEnabled) : d.stats.featuresEnabled; var em = document.getElementById('modEnabled'); if (em) em.textContent = Jalali ? Jalali.fa(d.stats.modulesEnabled) : d.stats.modulesEnabled; }
          if (d.reload) setTimeout(function () { location.reload(); }, 600);
        }).catch(function () { sw.checked = !sw.checked; toast('خطا در ارتباط', 'danger'); });
    });
  });

  // نوار اعلان کوچک
  function toast(msg, type) {
    var el = document.createElement('div');
    el.className = 'toast align-items-center text-bg-' + (type || 'dark') + ' border-0 show';
    el.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:2000;min-width:220px';
    el.innerHTML = '<div class="d-flex"><div class="toast-body">' + msg + '</div></div>';
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 3000);
  }
  window.appToast = toast;
  // فضای نام عمومی
  window.App = { toast: toast, fa: function (n) { return String(n == null ? '' : n).replace(/\d/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[d]; }); }, en: function (s) { return String(s == null ? '' : s).replace(/[۰-۹]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'.indexOf(d); }); }, csrf: csrf };

  // کمک: ارسال JSON
  window.postJSON = function (url, data) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'Accept': 'application/json' }, body: JSON.stringify(data || {}) }).then(function (r) { return r.json(); });
  };
})();

// پیشنهاد زندهٔ جستجو
(function () {
  var input = document.getElementById('globalSearch');
  if (!input || !document.body.hasAttribute('data-live-search')) return;
  var box = document.createElement('div'); box.className = 'search-suggest d-none'; input.parentNode.appendChild(box);
  var timer = null;
  input.addEventListener('input', function () {
    clearTimeout(timer); var q = input.value.trim();
    if (q.length < 2) { box.classList.add('d-none'); return; }
    timer = setTimeout(function () {
      fetch('/search/api?q=' + encodeURIComponent(q), { headers: { Accept: 'application/json' } }).then(function (r) { return r.json(); }).then(function (d) {
        if (!d.groups || !d.groups.length) { box.innerHTML = '<div class="p-2 text-secondary fs-7">نتیجه‌ای یافت نشد</div>'; box.classList.remove('d-none'); return; }
        box.innerHTML = d.groups.map(function (g) { return '<div class="sg-title"><i class="bi ' + g.icon + ' me-1"></i>' + g.title + '</div>' + g.items.map(function (i) { return '<a class="sg-item" href="' + i.href + '"><span>' + i.title + '</span><span class="fs-7 text-secondary">' + (i.sub || '') + '</span></a>'; }).join(''); }).join('') + '<a class="sg-item text-primary justify-content-center" href="/search?q=' + encodeURIComponent(q) + '">همهٔ نتایج…</a>';
        box.classList.remove('d-none');
      }).catch(function () {});
    }, 250);
  });
  document.addEventListener('click', function (e) { if (!box.contains(e.target) && e.target !== input) box.classList.add('d-none'); });
  input.addEventListener('keydown', function (e) { if (e.key === 'Escape') box.classList.add('d-none'); });
})();

// منوی کناری آکاردئونی: باز/بسته‌کردن گروه‌ها با حافظهٔ محلی؛ گروه صفحهٔ جاری همیشه باز است
(function () {
  var nav = document.getElementById('sideNav');
  if (!nav || !nav.classList.contains('accordion')) return;
  var KEY = 'sb-open';
  var saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { saved = {}; }
  var single = nav.getAttribute('data-single') === '1';
  nav.querySelectorAll('.nav-group:not(.pinned)').forEach(function (g) {
    var key = g.getAttribute('data-group');
    var hasActive = !!g.querySelector('.nav-link.active');
    if (!hasActive && saved[key] === true) g.classList.add('open');
    if (!hasActive && saved[key] === false) g.classList.remove('open');
    var btn = g.querySelector('.group-toggle');
    if (btn) btn.setAttribute('aria-expanded', g.classList.contains('open') ? 'true' : 'false');
    btn && btn.addEventListener('click', function () {
      var open = !g.classList.contains('open');
      if (open && single) nav.querySelectorAll('.nav-group.open:not(.pinned)').forEach(function (o) { if (o !== g) { o.classList.remove('open'); saved[o.getAttribute('data-group')] = false; o.querySelector('.group-toggle').setAttribute('aria-expanded', 'false'); } });
      g.classList.toggle('open', open); btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      saved[key] = open; try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) { /* ignore */ }
    });
  });
  var active = nav.querySelector('.nav-link.active'); if (active && active.scrollIntoView) { try { active.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ } }
})();

/* انتخاب‌گر جستجوپذیر: برای select های بلند (≥ ۱۲ گزینه) یا دارای data-searchable — بدون وابستگی خارجی */
(function () {
  'use strict';
  var MIN = 12;
  function norm(s) { return String(s || '').replace(/[يك]/g, function (c) { return c === 'ي' ? 'ی' : 'ک'; }).replace(/[۰-۹]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'.indexOf(d); }).replace(/\u200c/g, ' ').toLowerCase().trim(); }
  function enhance(sel) {
    if (sel.multiple || sel.dataset.enhanced || sel.hasAttribute('data-no-search') || sel.closest('.no-search')) return;
    var optCount = sel.querySelectorAll('option').length;
    if (!sel.hasAttribute('data-searchable') && optCount < MIN) return;
    sel.dataset.enhanced = '1';
    var wrap = document.createElement('div'); wrap.className = 'ssel' + (sel.classList.contains('form-select-sm') ? ' ssel-sm' : '');
    var btn = document.createElement('button'); btn.type = 'button'; btn.className = sel.className.replace('form-select', 'form-select ssel-btn'); btn.setAttribute('aria-haspopup', 'listbox');
    if (sel.disabled) btn.disabled = true;
    var menu = document.createElement('div'); menu.className = 'ssel-menu'; menu.setAttribute('role', 'listbox');
    var search = document.createElement('input'); search.type = 'search'; search.className = 'form-control form-control-sm ssel-search'; search.placeholder = 'جستجو…'; search.setAttribute('aria-label', 'جستجو در گزینه‌ها');
    var list = document.createElement('div'); list.className = 'ssel-list';
    menu.appendChild(search); menu.appendChild(list);
    sel.parentNode.insertBefore(wrap, sel); wrap.appendChild(sel); wrap.appendChild(btn); wrap.appendChild(menu);
    sel.classList.add('ssel-native'); sel.tabIndex = -1;
    var label = (sel.labels && sel.labels[0]) ? sel.labels[0] : null; if (label && label.htmlFor) { btn.id = sel.id + '_btn'; label.htmlFor = btn.id; }
    function current() { var o = sel.options[sel.selectedIndex]; return o ? o.textContent : ''; }
    function render() { btn.innerHTML = '<span class="ssel-text">' + esc(current() || '—') + '</span>'; btn.classList.toggle('text-secondary', !sel.value); }
    function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function build(q) {
      list.innerHTML = ''; var n = 0; var nq = norm(q);
      Array.prototype.forEach.call(sel.options, function (o, i) {
        if (o.hidden) return;
        var txt = o.textContent; if (nq && norm(txt).indexOf(nq) < 0 && norm(o.value).indexOf(nq) < 0) return;
        var it = document.createElement('div'); it.className = 'ssel-item' + (i === sel.selectedIndex ? ' active' : '') + (o.disabled ? ' disabled' : ''); it.setAttribute('role', 'option'); it.dataset.i = i; it.textContent = txt || '\u00a0'; list.appendChild(it); n++;
      });
      if (!n) { var e = document.createElement('div'); e.className = 'ssel-empty text-secondary'; e.textContent = 'موردی یافت نشد'; list.appendChild(e); }
    }
    function open() { if (btn.disabled) return; document.querySelectorAll('.ssel.open').forEach(function (w) { if (w !== wrap) close(w); }); wrap.classList.add('open'); search.value = ''; build(''); setTimeout(function () { search.focus(); var act = list.querySelector('.active'); if (act) act.scrollIntoView({ block: 'nearest' }); }, 0); }
    function close(w) { (w || wrap).classList.remove('open'); }
    btn.addEventListener('click', function () { wrap.classList.contains('open') ? close() : open(); });
    search.addEventListener('input', function () { build(search.value); });
    search.addEventListener('keydown', function (e) {
      var items = list.querySelectorAll('.ssel-item:not(.disabled)'); var idx = Array.prototype.findIndex.call(items, function (x) { return x.classList.contains('hover'); });
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!items.length) return; items.forEach(function (x) { x.classList.remove('hover'); }); idx = e.key === 'ArrowDown' ? Math.min(items.length - 1, idx + 1) : Math.max(0, idx - 1); items[idx].classList.add('hover'); items[idx].scrollIntoView({ block: 'nearest' }); }
      else if (e.key === 'Enter') { e.preventDefault(); var t = idx >= 0 ? items[idx] : items[0]; if (t) pick(t); }
      else if (e.key === 'Escape') { close(); btn.focus(); }
    });
    function pick(it) { sel.selectedIndex = Number(it.dataset.i); render(); close(); sel.dispatchEvent(new Event('change', { bubbles: true })); btn.focus(); }
    list.addEventListener('click', function (e) { var it = e.target.closest('.ssel-item'); if (it && !it.classList.contains('disabled')) pick(it); });
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) close(); });
    sel.addEventListener('change', render);
    sel.addEventListener('ssel:refresh', render);
    sel.addEventListener('invalid', function (e) { e.preventDefault(); btn.classList.add('is-invalid'); open(); });
    sel.addEventListener('change', function () { btn.classList.remove('is-invalid'); });
    new MutationObserver(function () { render(); }).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'disabled'] });
    render();
  }
  function scan(root) { (root || document).querySelectorAll('select.form-select').forEach(enhance); }
  document.addEventListener('DOMContentLoaded', function () { scan(); });
  document.addEventListener('shown.bs.modal', function (e) { e.target.querySelectorAll('select.ssel-native').forEach(function (s) { s.dispatchEvent(new Event('ssel:refresh')); }); });
  document.addEventListener('show.bs.modal', function (e) { setTimeout(function () { e.target.querySelectorAll('select.ssel-native').forEach(function (s) { s.dispatchEvent(new Event('ssel:refresh')); }); }, 0); });
  window.App = window.App || {}; window.App.enhanceSelects = scan;
})();
