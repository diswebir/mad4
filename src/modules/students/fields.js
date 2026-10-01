'use strict';
/** تعریف فیلدهای پروندهٔ دانش‌آموز (برای فرم، ورود و خروجی) */
const db = require('../../core/db');
const utils = require('../../core/utils');
const modules = require('../../core/modules');
const J = require('../../core/jalali');

const optClasses = async () => (await db.table('classes as c').leftJoin('grade_levels as g', 'g.id', 'c.grade_level_id').select('c.id', 'c.title', 'g.title as grade').where('c.is_active', 1).orderBy('g.sort_order').orderBy('c.title').all()).map((r) => ({ value: r.id, label: r.title + (r.grade ? ' — ' + r.grade : '') }));
const optGrades = async () => (await db.table('grade_levels').orderBy('sort_order').all()).map((r) => ({ value: r.id, label: r.title }));
const optRoutes = async () => (await db.table('transport_routes').where('is_active', 1).orderBy('title').all()).map((r) => ({ value: r.id, label: r.title }));

const all = [
  { name: '_identity', label: 'اطلاعات هویتی', type: 'heading', icon: 'bi-person-vcard' },
  { name: 'first_name', label: 'نام', type: 'text', required: true, col: 3 },
  { name: 'last_name', label: 'نام خانوادگی', type: 'text', required: true, col: 3 },
  { name: 'student_number', label: 'شماره دانش‌آموزی', type: 'en', col: 3, help: 'نام کاربری ورود دانش‌آموز' },
  { name: 'national_id', label: 'کد ملی', type: 'en', col: 3 },
  { name: 'gender', label: 'جنسیت', type: 'select', required: true, options: utils.GENDERS, col: 3 },
  { name: 'birth_date', label: 'تاریخ تولد', type: 'date', col: 3 },
  { name: 'birth_place', label: 'محل تولد', type: 'text', col: 3 },
  { name: 'nationality', label: 'ملیت', type: 'text', col: 3 },
  { name: 'religion', label: 'دین / مذهب', type: 'text', col: 3 },
  { name: 'photo', label: 'عکس دانش‌آموز', type: 'file', images: true, accept: 'image/*', col: 3, feature: 'students.photo' },
  { name: 'password', label: 'رمز عبور حساب', type: 'password', virtual: true, col: 3, help: 'خالی = رمز پیش‌فرض (کد ملی یا ۱۲۳۴۵۶)' },

  { name: '_academic', label: 'اطلاعات تحصیلی', type: 'heading', icon: 'bi-mortarboard' },
  { name: 'class_id', label: 'کلاس', type: 'select', options: optClasses, col: 3 },
  { name: 'grade_level_id', label: 'پایه', type: 'select', options: optGrades, col: 3, help: 'در صورت خالی بودن از کلاس گرفته می‌شود' },
  { name: 'enrollment_date', label: 'تاریخ ثبت‌نام', type: 'date', col: 3 },
  { name: 'status', label: 'وضعیت', type: 'select', options: utils.STUDENT_STATUS, col: 3, default: 'active' },
  { name: 'previous_school', label: 'مدرسهٔ قبلی', type: 'text', col: 6 },
  { name: 'transport_route_id', label: 'سرویس رفت‌وآمد', type: 'select', options: optRoutes, col: 6, feature: 'transport' },

  { name: '_contact', label: 'اطلاعات تماس و نشانی', type: 'heading', icon: 'bi-geo-alt' },
  { name: 'mobile', label: 'موبایل دانش‌آموز', type: 'tel', col: 3 },
  { name: 'home_phone', label: 'تلفن منزل', type: 'tel', col: 3 },
  { name: 'email', label: 'ایمیل', type: 'email', col: 3 },
  { name: 'postal_code', label: 'کد پستی', type: 'en', col: 3 },
  { name: 'address', label: 'نشانی منزل', type: 'textarea', rows: 2, col: 12 },

  { name: '_father', label: 'اطلاعات پدر', type: 'heading', icon: 'bi-person', feature: 'students.parents' },
  { name: 'father_name', label: 'نام پدر', type: 'text', col: 3, feature: 'students.parents' },
  { name: 'father_national_id', label: 'کد ملی پدر', type: 'en', col: 3, feature: 'students.parents' },
  { name: 'father_phone', label: 'موبایل پدر', type: 'tel', col: 3, feature: 'students.parents' },
  { name: 'father_job', label: 'شغل پدر', type: 'text', col: 3, feature: 'students.parents' },
  { name: 'father_education', label: 'تحصیلات پدر', type: 'select', options: utils.EDUCATIONS, col: 3, feature: 'students.parents' },
  { name: '_mother', label: 'اطلاعات مادر', type: 'heading', icon: 'bi-person', feature: 'students.parents' },
  { name: 'mother_name', label: 'نام مادر', type: 'text', col: 3, feature: 'students.parents' },
  { name: 'mother_national_id', label: 'کد ملی مادر', type: 'en', col: 3, feature: 'students.parents' },
  { name: 'mother_phone', label: 'موبایل مادر', type: 'tel', col: 3, feature: 'students.parents' },
  { name: 'mother_job', label: 'شغل مادر', type: 'text', col: 3, feature: 'students.parents' },
  { name: 'mother_education', label: 'تحصیلات مادر', type: 'select', options: utils.EDUCATIONS, col: 3, feature: 'students.parents' },
  { name: '_guardian', label: 'سرپرست قانونی', type: 'heading', icon: 'bi-shield-check', feature: 'students.parents' },
  { name: 'guardian_type', label: 'سرپرست', type: 'select', options: { father: 'پدر', mother: 'مادر', other: 'سایر' }, col: 3, default: 'father', feature: 'students.parents' },
  { name: 'guardian_name', label: 'نام سرپرست (در صورت سایر)', type: 'text', col: 3, feature: 'students.parents' },
  { name: 'guardian_phone', label: 'موبایل سرپرست', type: 'tel', col: 3, feature: 'students.parents' },
  { name: 'guardian_relation', label: 'نسبت', type: 'text', col: 3, feature: 'students.parents' },

  { name: '_emergency', label: 'تماس اضطراری', type: 'heading', icon: 'bi-telephone-forward', feature: 'students.emergency' },
  { name: 'emergency_name', label: 'نام', type: 'text', col: 4, feature: 'students.emergency' },
  { name: 'emergency_phone', label: 'تلفن', type: 'tel', col: 4, feature: 'students.emergency' },
  { name: 'emergency_relation', label: 'نسبت', type: 'text', col: 4, feature: 'students.emergency' },

  { name: '_medical', label: 'اطلاعات پزشکی', type: 'heading', icon: 'bi-heart-pulse', feature: 'students.medical' },
  { name: 'blood_type', label: 'گروه خونی', type: 'select', options: utils.BLOOD_TYPES, col: 3, feature: 'students.medical' },
  { name: 'height', label: 'قد (سانتی‌متر)', type: 'number', min: 0, max: 250, col: 3, feature: 'students.medical' },
  { name: 'weight', label: 'وزن (کیلوگرم)', type: 'number', min: 0, max: 250, col: 3, feature: 'students.medical' },
  { name: 'insurance_number', label: 'شماره بیمه', type: 'en', col: 3, feature: 'students.medical' },
  { name: 'allergies', label: 'حساسیت‌ها', type: 'textarea', rows: 2, col: 6, feature: 'students.medical' },
  { name: 'medical_conditions', label: 'بیماری‌های خاص', type: 'textarea', rows: 2, col: 6, feature: 'students.medical' },
  { name: 'medications', label: 'داروهای مصرفی', type: 'textarea', rows: 2, col: 6, feature: 'students.medical' },
  { name: 'special_needs', label: 'نیازهای ویژه / توضیحات', type: 'textarea', rows: 2, col: 6, feature: 'students.medical' },

  { name: '_notes', label: 'سایر', type: 'heading', icon: 'bi-journal-text' },
  { name: 'notes', label: 'توضیحات تکمیلی', type: 'textarea', rows: 3, col: 12 }
];

/** بخش‌بندی فیلدها بر اساس سرفصل‌ها و فعال‌بودن قابلیت‌ها (برای فرم) */
async function sections() {
  const out = [];
  let cur = null;
  for (const f of all) {
    if (f.feature && !modules.isEnabled(f.feature)) continue;
    if (f.type === 'heading') { cur = { heading: f, fields: [] }; out.push(cur); continue; }
    const g = Object.assign({}, f);
    if (typeof g.options === 'function') g.options = await g.options();
    if (cur) cur.fields.push(g);
  }
  return out.filter((s) => s.fields.length);
}

const IMPORT_KEYS = ['first_name', 'last_name', 'student_number', 'national_id', 'gender', 'birth_date', 'birth_place', 'mobile', 'home_phone', 'email', 'postal_code', 'address', 'father_name', 'father_national_id', 'father_phone', 'father_job', 'mother_name', 'mother_national_id', 'mother_phone', 'mother_job', 'emergency_name', 'emergency_phone', 'blood_type', 'allergies', 'medical_conditions', 'previous_school', 'enrollment_date', 'notes'];
function importColumns() { return IMPORT_KEYS.map((k) => { const f = all.find((x) => x.name === k); return { key: k, label: f ? f.label : k }; }); }
function exportColumns() {
  const cols = [
    { label: 'شماره دانش‌آموزی', value: (r) => r.student_number }, { label: 'نام', value: (r) => r.first_name }, { label: 'نام خانوادگی', value: (r) => r.last_name },
    { label: 'کد ملی', value: (r) => r.national_id }, { label: 'جنسیت', value: (r) => utils.GENDERS[r.gender] || '' }, { label: 'تاریخ تولد', value: (r) => J.toJalali(r.birth_date) },
    { label: 'کلاس', value: (r) => r.class_title }, { label: 'پایه', value: (r) => r.grade_title }, { label: 'وضعیت', value: (r) => utils.STUDENT_STATUS[r.status] || r.status },
    { label: 'موبایل', value: (r) => r.mobile }, { label: 'تلفن منزل', value: (r) => r.home_phone }, { label: 'نشانی', value: (r) => r.address }
  ];
  if (modules.isEnabled('students.parents')) cols.push({ label: 'نام پدر', value: (r) => r.father_name }, { label: 'موبایل پدر', value: (r) => r.father_phone }, { label: 'شغل پدر', value: (r) => r.father_job }, { label: 'نام مادر', value: (r) => r.mother_name }, { label: 'موبایل مادر', value: (r) => r.mother_phone });
  if (modules.isEnabled('students.emergency')) cols.push({ label: 'تماس اضطراری', value: (r) => (r.emergency_name ? `${r.emergency_name} (${r.emergency_phone || ''})` : '') });
  if (modules.isEnabled('students.medical')) cols.push({ label: 'گروه خونی', value: (r) => r.blood_type }, { label: 'حساسیت‌ها', value: (r) => r.allergies });
  return cols;
}

module.exports = { all, sections, importColumns, exportColumns };
