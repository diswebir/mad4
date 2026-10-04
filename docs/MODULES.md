# راهنمای توسعه: چطور یک ماژول جدید بنویسیم

این سند برای برنامه‌نویسی است که می‌خواهد قابلیت تازه‌ای به سامانه اضافه کند؛ از ساختار پوشه تا تست و مستندسازی. مثال‌های سند بر پایهٔ یک ماژول فرضی «کمد دانش‌آموزی» (`lockers`) نوشته شده‌اند.

> خلاصه: یک پوشه در `src/modules/<key>/` با `index.js` (مانیفست) و `routes.js` بسازید، جدول‌هایش را در `database/schema.js` تعریف کنید، سرور را دوباره اجرا کنید؛ ماژول خودکار کشف، در منو نمایش داده و در «تنظیمات ← ماژول‌ها» قابل خاموش/روشن‌شدن می‌شود.

---

## ۱. معماری در یک نگاه

```
app.js                      ← نقطهٔ ورود Passenger/cPanel (process.env.PORT)
src/app.js                  ← createApp(): میان‌افزارها، نصب، نشست، CSRF، سوارکردن ماژول‌ها
src/core/                   ← هستهٔ مشترک (db، auth، settings، modules، crud، notify، jalali، …)
src/modules/<key>/
  index.js                  ← مانیفست ماژول (کلید، نام، قابلیت‌ها، منو، کارهای زمان‌بندی، routes)
  routes.js                 ← مسیرهای Express (express.Router)
  jobs.js                   ← (اختیاری) کارهای پس‌زمینه
  views/*.ejs               ← قالب‌ها (EJS + express-ejs-layouts)
database/schema.js          ← تعریف همهٔ جدول‌ها (DSL ساده؛ همگام‌سازی خودکار SQLite/MySQL)
database/seeds/demo.js      ← دادهٔ نمونهٔ فارسی
tests/flow-*.js             ← تست‌های جریان کاری روی سرور واقعی
docs/FEATURES.md            ← فهرست قابلیت‌ها (تولید خودکار از مانیفست‌ها)
```

چرخهٔ یک درخواست: `helmet/compression/static` → `urlencoded/json` → `locals` (`J`, `utils`, `S`, `school()`, `enabled()`) → نشست و `flash` → `auth.loadUser()` → **حالت نگهداری** → داده‌های مشترک قالب (منو، نشان‌ها، هشدارهای مدیر) → `csrf()` → `/auth` → **ماژول‌ها** (هر کدام زیر `mount || '/' + key` با `modules.requireEnabled(key)`) → `/files/*` → ۴۰۴ → خطای عمومی.

---

## ۲. مانیفست ماژول (`index.js`)

```js
'use strict';
module.exports = {
  key: 'lockers',                      // یکتا؛ هم نام پوشه، هم پیشوند مسیر (/lockers) و کلید قابلیت‌ها
  name: 'کمد دانش‌آموزی',
  description: 'تخصیص کمد به دانش‌آموزان، پیگیری کلید و تخلیه در پایان سال',
  icon: 'bi-door-closed',              // آیکون Bootstrap Icons
  category: 'services',                // main | people | academic | communication | services | finance | system
  order: 65,                           // ترتیب در منو/فهرست ماژول‌ها (کوچک‌تر = بالاتر)
  // mount: '/custom-path',            // اختیاری؛ پیش‌فرض '/' + key  (هرگز '/' نگذارید)
  features: [
    { key: 'manage', name: 'مدیریت کمدها', description: 'ثبت کمد و تخصیص به دانش‌آموز', locked: true },
    { key: 'student_view', name: 'کمد من', description: 'دانش‌آموز شمارهٔ کمد خود را می‌بیند' },
    { key: 'export', name: 'خروجی Excel/CSV', description: 'دانلود فهرست کمدها' },
    { key: 'reminder', name: 'یادآوری تخلیهٔ پایان سال', description: 'اعلان خودکار به دانش‌آموزان دارای کمد' }
  ],
  menu: [
    { title: 'کمدها', href: '/lockers', icon: 'bi-door-closed', roles: ['admin'], permission: 'lockers.manage' },
    { title: 'کمد من', href: '/lockers/my', roles: ['student', 'parent'], feature: 'student_view' }
  ],
  jobs: require('./jobs'),             // اختیاری
  routes: require('./routes')
};
```

نکته‌ها:

* **`features`**: هر قابلیت با `fullKey = '<module>.<feature>'` (مثلاً `lockers.export`) در جدول `module_states` ذخیره و از «تنظیمات ← ماژول‌ها و قابلیت‌ها» خاموش/روشن می‌شود. `locked: true` یعنی همیشه فعال (قابلیت‌های پایهٔ ماژول). خاموش‌کردن خودِ ماژول، همهٔ مسیرها و منوهایش را می‌بندد.
* **`menu`**: `roles` نقش‌های مجاز، `permission` کلید مجوز (اگر کاربر نقش را ندارد ولی مجوز را دارد، باز هم آیتم را می‌بیند)، `feature` فقط کلید قابلیت همین ماژول. عنوان‌هایی که به «… من» ختم می‌شوند برای والد خودکار «… فرزندم» می‌شوند.
* **`jobs`**: آرایه‌ای از `{ key, name, description, schedule: 'daily'|'hourly'|'every15', defaultTime: 'HH:MM', async run({ db, settings, J, log }) }`. خروجی `run` یک رشتهٔ خلاصه است که در «کارهای زمان‌بندی‌شده» نمایش داده می‌شود. کلیدها باید در کل سامانه یکتا باشند. در ابتدای `run` فعال‌بودن قابلیت را بررسی کنید (`modules.isEnabled('lockers.reminder')`).

---

## ۳. جدول‌ها (`database/schema.js`)

```js
lockers: {
  id: 'increments',
  number: 'string:20 notnull unique',
  location: 'string:120',
  student_id: 'integer index',
  assigned_at: 'date',
  note: 'text',
  created_at: 'datetime',
  __indexes: [['location', 'student_id']]
},
```

* انواع: `increments`, `integer`, `bigint`, `decimal:10,2`, `string:N`, `text`, `boolean`, `date`, `datetime`, `json`؛ پرچم‌ها: `notnull`, `unique`, `index`, `default:X`.
* همگام‌سازی خودکار (`src/core/db/schema.js`) هنگام راه‌اندازی **فقط جدول و ستون جدید اضافه می‌کند**؛ تغییر نوع/حذف ستون را خودتان با یک مهاجرت دستی انجام دهید.
* تاریخ‌ها همیشه **میلادی ISO** (`YYYY-MM-DD`) ذخیره و فقط در نمایش/ورودی به شمسی تبدیل می‌شوند (`J.toJalali`, `J.toGregorian`, `J.formatLong`, `J.todayISO()`).
* روی MySQL و SQLite هر دو باید کار کند: مقادیر عددی را `parseInt` کنید، به ترتیب پیش‌فرض سطرها تکیه نکنید (`orderBy` بگذارید)، در join‌ها `id` را با نام جدول صریح کنید، برای الحاق رشته از `db.concat()` استفاده کنید.

لایهٔ داده (`src/core/db`): `db.table('lockers').where({...}).orderBy('number').paginate(page, perPage)`, `.first()`, `.all()`, `.count()`, `.pluck('id')`, `.search(q, ['number','location'])`, `db.insert/update/findById/count/exists`, `db.now()`.

---

## ۴. مسیرها (`routes.js`)

```js
'use strict';
const path = require('path');
const express = require('express');
const db = require('../../core/db');
const auth = require('../../core/auth');
const modules = require('../../core/modules');
const crud = require('../../core/crud');
const activity = require('../../core/activity');
const utils = require('../../core/utils');
const J = require('../../core/jalali');

const router = express.Router();
const v = (n) => path.join(__dirname, 'views', n + '.ejs');

// ۱) مسیرهای عمومی/بدون ورود را قبل از requireAuth بگذارید (اینجا نداریم)
router.use(auth.requireAuth);

// ۲) مسیرهای ثابت پیش از /:id و پیش از crud()
router.get('/my', auth.requireRole('student', 'parent'), modules.requireEnabled('lockers.student_view'), async (req, res) => {
  const s = await require('../../core/people').studentOf(req);      // دانش‌آموز جاری یا فرزند انتخاب‌شدهٔ والد
  const locker = s ? await db.table('lockers').where('student_id', s.id).first() : null;
  res.render(v('my'), { title: 'کمد من', locker });
});

// ۳) CRUD عمومی: فهرست + جستجو + فیلتر + صفحه‌بندی + ایجاد/ویرایش/حذف + خروجی
crud(router, {
  path: '', table: 'lockers', title: 'کمد', plural: 'کمدها', icon: 'bi-door-closed',
  feature: 'lockers.manage', exportFeature: 'lockers.export',
  roles: ['admin'], permission: 'lockers.manage', orderBy: 'number',
  fields: [
    { name: 'number', label: 'شمارهٔ کمد', type: 'text', required: true, list: true, search: true },
    { name: 'location', label: 'محل', type: 'text', list: true, search: true, filter: true },
    { name: 'student_id', label: 'دانش‌آموز', type: 'select', list: true, searchable: true,
      options: async () => Object.fromEntries((await db.table('students').where('status', 'active').orderBy('last_name').all()).map((s) => [s.id, `${s.first_name} ${s.last_name} (${s.student_number})`])) },
    { name: 'assigned_at', label: 'تاریخ تخصیص', type: 'date', list: true },   // ورودی شمسی، ذخیرهٔ ISO
    { name: 'note', label: 'یادداشت', type: 'textarea' }
  ],
  beforeSave: async (data, req, isNew) => { if (isNew) data.created_at = db.now(); return data; },
  afterSave: async (id, data, req, isNew) => activity.log(req, isNew ? 'create' : 'update', 'locker', id, 'کمد ' + data.number)
});

module.exports = router;
```

قواعد مهم (Express 5):

* پارامتر regex ندارد؛ مسیرهای ثابت (`/my`, `/export`, …) را **قبل از** `/:id` و قبل از `crud()` تعریف کنید. `router.use(...)` باید پیش از `crud()` بیاید.
* `modules.requireEnabled('lockers.student_view')` فقط **یک کلید** می‌گیرد؛ `modules.isEnabled()` را در زمان تعریف ماژول صدا نزنید (وضعیت‌ها بعداً بارگذاری می‌شوند) — داخل هندلر صدا بزنید.
* نقش/مجوز: `auth.requireRole('admin','teacher')`, `auth.requireRoleOrPermission(['admin'], 'lockers.manage')`, درون هندلر `req.can('lockers.manage')`. درخواست‌های معلم `req._teacherId` دارند. برای پاسخ JSON/HTML بسته به درخواست: `auth.wantsJson(req)`.
* فرم‌های `multipart` باید از `upload.form(...)`/`upload.none()` عبور کنند وگرنه CSRF خطا می‌دهد؛ خطای آپلود در `req.uploadError` است. برای فایل‌های دانلودی از `utils.sendExport(res, name, rows, columns, 'xlsx'|'csv')` استفاده کنید.
* همهٔ ورودی‌های فارسی را با `utils.normalizePersian()` و ارقام را با `J.toEnglishDigits()` نرمال کنید؛ اعتبارسنجی با `src/core/validate.js`.
* رخدادهای مهم را با `activity.log(req, action, entity, id, description)` ثبت کنید؛ اعلان درون‌برنامه‌ای با `notify.push([userIds], { title, body, link, type })` یا `notify.pushRole('admin', …)` (عنوان اعلان‌های تکرارشونده باید تاریخ داشته باشد تا با سازوکار ضدتکرار حذف نشود). پیامک/ایمیل با `notify.sms()`/`notify.email()` که در صورت خطا خودکار به صف تلاش مجدد می‌روند.
* دسترسی به فایل‌های آپلودشده با `src/core/fileAccess.js` کنترل می‌شود؛ اگر ماژول شما فایل ذخیره می‌کند، قاعدهٔ مجوز آن را همان‌جا اضافه کنید.

---

## ۵. قالب‌ها (`views/*.ejs`)

* قالب پیش‌فرض `layouts/main` (با سایدبار) است؛ برای صفحات عمومی `layout: 'layouts/public'`، چاپ `layouts/print` (بدون app.js) و خطاها `errors/*`.
* متغیرهای همیشه در دسترس: `currentUser`, `csrfToken`, `J` (تقویم شمسی), `utils`, `e` (escape), `S` (ماژول تنظیمات: `S.get('key')`), `school('school_name')`, `enabled('mod.feature')`, `currentPath`, `query`, `appVersion`.
* **هرگز** متغیری با نام‌های `school`, `settings`, `enabled` به `res.render` ندهید (با توابع سراسری تداخل می‌کند).
* پارشال‌های آماده: `partials/page-header` (`title, icon, breadcrumbs, actions:[{href|post|modal|print, label, icon, class, confirm}]`), `partials/pagination`, `partials/empty`, `partials/avatar`, `partials/disk-gauge`.
* `<%= %>` escape می‌کند، `<%- %>` HTML خام می‌دهد. ارقام را با `J.toPersianDigits()` فارسی کنید. دکمه‌های POST ساده: `<a data-post="/url" data-confirm="…" data-params='{"k":"v"}'>`. فیلد تاریخ شمسی: `<input class="form-control jdate" name="assigned_at" value="<%= J.toJalali(row.assigned_at) %>">` (در سرور با `J.toGregorian()` به ISO برگردانید)؛ سلکت‌های `select.form-select` با گزینه‌های زیاد خودکار جستجوپذیر می‌شوند (`data-searchable` برای اجبار، `data-no-search` برای خاموش‌کردن؛ پس از تزریق پویا `App.enhanceSelects(root)`).
* CSS سراسری در `public/css/app.css`؛ از کلاس‌های Bootstrap 5.3 RTL استفاده کنید و استایل اختصاصی را در همان فایل (نه inline) بگذارید.

---

## ۶. مجوزها، تنظیمات، دادهٔ نمونه

* **مجوز جدید**: در `src/core/permissions.js` به گروه مناسب در `GROUPS` اضافه کنید (`['lockers.manage', 'مدیریت کمدها']`) و در صورت نیاز به سِمت‌های پیش‌فرض (`DEFAULT_POSITIONS`) بدهید. مجوزها در «کاربران ← سِمت‌ها/مجوزها» قابل تخصیص‌اند؛ `req.can('lockers.manage')` در هندلر و `permissions.can(user, key)` در جاهای دیگر.
* **تنظیمات**: کلیدهای جدید را با مقدار پیش‌فرض به `DEFAULTS` در `src/core/settings.js` اضافه کنید و برای نمایش در «تنظیمات مدرسه»، در `src/modules/system/routes.js` یک ورودی به `TABS` (با `feature` مربوط) و کلیدها را به `FIELDS[tab]` اضافه کنید، سپس بخش فرم را در `views/settings.ejs` با کمک `inp()/sel()/sw()` بنویسید. فقط کلیدهای موجود در `FIELDS[tab]` ذخیره می‌شوند. خواندن: `settings.get/getInt/getBool/getList`.
* **دادهٔ نمونه**: در `database/seeds/demo.js` (تابع `run`) چند رکورد فارسی واقعی بسازید تا سامانه پس از نصب خالی نباشد و تست‌ها داده داشته باشند.
* **راهنما**: متن کمکی نقش‌محور را در `src/modules/help/content.js` و مرحلهٔ راه‌اندازی را (در صورت نیاز) در `checklist.js` اضافه کنید.

---

## ۷. تست

* سرور را اجرا کنید (`node app.js`؛ مسیرها و قالب‌ها هنگام راه‌اندازی بارگذاری می‌شوند — پس از هر تغییر، ری‌استارت کنید) و فایل `tests/flow-lockers.js` بنویسید:

```js
'use strict';
const { Client } = require('./client');
const assert = (c, m) => { if (!c) { console.log('FAIL:', m); process.exitCode = 2; } else console.log('ok:', m); };
(async () => {
  const a = new Client(); let r = await a.login('admin', 'admin123'); assert(r.status === 302, 'login');
  r = await a.post('/lockers/new', { number: 'A-' + Date.now(), location: 'طبقهٔ اول' }); assert(r.status === 302, 'create');
  r = await a.get('/lockers?q=A-'); assert(r.status === 200 && /طبقهٔ اول/.test(r.text), 'list + search');
  await a.post('/system/modules/toggle', { key: 'lockers.student_view', enabled: '0' });
  const s = new Client(); await s.login('40001', '123456'); r = await s.get('/lockers/my'); assert(r.status !== 200 || /غیرفعال/.test(r.text), 'feature guard');
  await a.post('/system/modules/toggle', { key: 'lockers.student_view', enabled: '1' });
  console.log(process.exitCode ? 'flow-lockers: FAILED' : 'flow-lockers: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
```

* نام فایل را به فهرست جریان‌ها در `tests/smoke.test.js` اضافه کنید؛ `npm test` همه را روی دادهٔ نمونهٔ مشترک اجرا می‌کند (پس تست‌ها باید **قابل تکرار** باشند: برچسب تصادفی بسازید و پس از خود پاک‌سازی کنید).
* `tests/client.js` توکن CSRF را از هر پاسخ می‌خواند؛ دارایی‌های ایستا را با یک `new Client()` جداگانه بگیرید. CI (`.github/workflows/ci.yml`) تست‌ها را روی SQLite (Node 20/22) و MySQL 8 اجرا می‌کند و بررسی می‌کند `docs/FEATURES.md` به‌روز باشد.

---

## ۸. چک‌لیست انتشار یک ماژول

- [ ] `index.js` با `key/name/description/icon/category/features/menu` و (در صورت نیاز) `jobs`
- [ ] هر مسیر/دکمه‌ای که به یک قابلیت وابسته است با `requireEnabled` یا `enabled()` محافظت شده
- [ ] جدول‌ها در `database/schema.js`؛ تاریخ‌ها ISO؛ روی MySQL هم آزمایش شده
- [ ] مجوزها در `permissions.js`؛ منو برای نقش‌های درست
- [ ] تنظیمات قابل‌تغییر به‌جای مقادیر ثابت در کد (`settings.js` + زبانهٔ تنظیمات)
- [ ] قالب‌ها RTL، ارقام فارسی، بدون متن انگلیسی برای کاربر، بدون `school/settings/enabled` در locals
- [ ] فعالیت‌ها در `activity.log`؛ اعلان‌ها با عنوان یکتا در روز
- [ ] دادهٔ نمونه در `demo.js`؛ راهنما در `help/content.js`
- [ ] `tests/flow-<key>.js` + افزودن به `smoke.test.js`؛ `npm test` سبز
- [ ] `node scripts/features.js` اجرا و `docs/FEATURES.md` کامیت شده؛ `CHANGELOG.md` به‌روز

برای روال به‌روزرسانی نسخه روی سرور، حالت نگهداری و هشدار دیسک به [`docs/UPDATE.md`](UPDATE.md) مراجعه کنید.
