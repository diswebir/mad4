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
