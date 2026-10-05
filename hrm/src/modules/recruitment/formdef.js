'use strict';
/**
 * تعریف پیش‌فرض فرم استخدام (برگرفته از فرم OF-FR-01-03 شرکت) — در جدول‌های form_sections / form_fields ذخیره می‌شود
 * و منابع انسانی می‌تواند فیلدها را فعال/غیرفعال، الزامی/اختیاری و ویرایش کند یا فیلد سفارشی اضافه کند.
 *
 * انواع فیلد: text, textarea, number, date, select, radio, multi (چندگزینه‌ای), checkbox (بله/خیر), mobile, email, national_id, year, money, accept
 * show_if: «key=value» نمایش شرطی در همان بخش
 */
const SECTIONS = [
  { key: 'personal', title: 'مشخصات متقاضی', icon: 'bi-person-vcard', description: 'اطلاعات هویتی و تماس', repeatable: 0 },
  { key: 'work', title: 'سوابق کاری', icon: 'bi-briefcase', description: 'از آخرین محل کار شروع کنید', repeatable: 1, min_rows: 0, max_rows: 6 },
  { key: 'education', title: 'تحصیلات', icon: 'bi-mortarboard', description: 'مدارک تحصیلی', repeatable: 1, min_rows: 1, max_rows: 5 },
  { key: 'languages', title: 'زبان خارجی', icon: 'bi-translate', description: '', repeatable: 1, min_rows: 0, max_rows: 3 },
  { key: 'skills', title: 'مهارت‌های نرم‌افزاری', icon: 'bi-pc-display', description: '', repeatable: 1, min_rows: 0, max_rows: 10 },
  { key: 'courses', title: 'دوره‌های آموزشی', icon: 'bi-award', description: 'دوره‌ها و گواهینامه‌ها', repeatable: 1, min_rows: 0, max_rows: 6 },
  { key: 'expectations', title: 'دیدگاه‌ها و انتظارات', icon: 'bi-chat-square-heart', description: '', repeatable: 0 },
  { key: 'conditions', title: 'شرایط و الزامات شغل', icon: 'bi-clipboard2-check', description: '', repeatable: 0 },
  { key: 'references', title: 'اطلاعات معرف', icon: 'bi-people', description: 'افرادی که می‌توانند دربارهٔ شما نظر دهند', repeatable: 1, min_rows: 0, max_rows: 3 },
  { key: 'declaration', title: 'تأیید و ارسال', icon: 'bi-pen', description: 'اقرار صحت اطلاعات', repeatable: 0 }
];

const F = (section, key, label, type, extra) => Object.assign({ section_key: section, key, label, type: type || 'text', required: 0, width: 6, options: null, help: null, placeholder: null, show_if: null, locked: 0 }, extra || {});

const FIELDS = [
  // ---- مشخصات متقاضی ----
  F('personal', 'first_name', 'نام', 'text', { required: 1, width: 4, locked: 1 }),
  F('personal', 'last_name', 'نام خانوادگی', 'text', { required: 1, width: 4, locked: 1 }),
  F('personal', 'father_name', 'نام پدر', 'text', { required: 1, width: 4 }),
  F('personal', 'national_id', 'کد ملی', 'national_id', { required: 1, width: 4, locked: 1 }),
  F('personal', 'id_number', 'شمارهٔ شناسنامه', 'text', { width: 4 }),
  F('personal', 'birth_date', 'تاریخ تولد', 'date', { required: 1, width: 4 }),
  F('personal', 'birth_place', 'محل صدور', 'text', { width: 4 }),
  F('personal', 'gender', 'جنسیت', 'select', { width: 4, options: ['مرد', 'زن'] }),
  F('personal', 'religion', 'دین', 'select', { width: 4, options: ['اسلام', 'مسیحیت', 'کلیمی', 'زرتشتی', 'سایر'] }),
  F('personal', 'sect', 'مذهب', 'select', { width: 4, options: ['شیعه', 'سنی', 'سایر'] }),
  F('personal', 'mobile', 'تلفن همراه', 'mobile', { required: 1, width: 4, locked: 1, help: 'همان شماره‌ای که با آن وارد شده‌اید' }),
  F('personal', 'phone', 'تلفن ثابت', 'text', { width: 4, placeholder: '031…' }),
  F('personal', 'email', 'ایمیل', 'email', { width: 4 }),
  F('personal', 'insurance_history', 'سابقهٔ بیمه', 'radio', { width: 4, options: ['دارد', 'ندارد'] }),
  F('personal', 'insurance_years', 'سنوات بیمه (سال)', 'number', { width: 4, show_if: 'insurance_history=دارد' }),
  F('personal', 'insurance_number', 'شمارهٔ بیمه', 'text', { width: 4, show_if: 'insurance_history=دارد' }),
  F('personal', 'military_status', 'وضعیت نظام وظیفه', 'select', { width: 4, options: ['پایان خدمت', 'معافیت دائم', 'معافیت تحصیلی', 'مشمول', 'مشمول نمی‌شوم'] }),
  F('personal', 'marital_status', 'وضعیت تأهل', 'radio', { width: 4, required: 1, options: ['مجرد', 'متأهل', 'سایر'] }),
  F('personal', 'marital_other', 'توضیح وضعیت تأهل', 'text', { width: 4, show_if: 'marital_status=سایر' }),
  F('personal', 'spouse_name', 'نام و نام خانوادگی همسر', 'text', { width: 4, show_if: 'marital_status=متأهل' }),
  F('personal', 'spouse_phone', 'تلفن همسر', 'text', { width: 4, show_if: 'marital_status=متأهل' }),
  F('personal', 'spouse_job', 'شغل و محل کار همسر', 'text', { width: 4, show_if: 'marital_status=متأهل' }),
  F('personal', 'children_count', 'تعداد فرزند', 'number', { width: 4, show_if: 'marital_status=متأهل' }),
  F('personal', 'address', 'آدرس محل سکونت', 'textarea', { required: 1, width: 8 }),
  F('personal', 'postal_code', 'کد پستی', 'text', { width: 4 }),
  // ---- سوابق کاری ----
  F('work', 'company', 'نام شرکت / سازمان', 'text', { required: 1, width: 4 }),
  F('work', 'position', 'سمت سازمانی', 'text', { required: 1, width: 4 }),
  F('work', 'work_phone', 'تلفن محل کار', 'text', { width: 4 }),
  F('work', 'start_date', 'تاریخ شروع', 'text', { width: 3, placeholder: '۱۳۹۸/۰۱' }),
  F('work', 'end_date', 'تاریخ پایان', 'text', { width: 3, placeholder: '۱۴۰۲/۰۶ یا «ادامه دارد»' }),
  F('work', 'duration', 'مدت همکاری', 'text', { width: 3, placeholder: 'مثلاً ۴ سال و ۵ ماه' }),
  F('work', 'last_salary', 'آخرین حقوق دریافتی (تومان)', 'money', { width: 3 }),
  F('work', 'leave_reason', 'علت قطع همکاری', 'text', { width: 12 }),
  // ---- تحصیلات ----
  F('education', 'degree', 'مقطع', 'select', { required: 1, width: 3, options: ['زیر دیپلم', 'دیپلم', 'کاردانی', 'کارشناسی', 'کارشناسی ارشد', 'دکتری'] }),
  F('education', 'field', 'رشته / گرایش', 'text', { required: 1, width: 3 }),
  F('education', 'institute', 'محل تحصیل', 'text', { width: 3 }),
  F('education', 'grad_year', 'سال اخذ مدرک', 'year', { width: 2 }),
  F('education', 'gpa', 'معدل', 'number', { width: 1 }),
  // ---- زبان ----
  F('languages', 'language', 'عنوان زبان', 'text', { required: 1, width: 6, placeholder: 'انگلیسی، عربی، آلمانی…' }),
  F('languages', 'level', 'سطح تسلط', 'select', { required: 1, width: 6, options: ['بسیار خوب', 'خوب', 'متوسط', 'ضعیف'] }),
  // ---- مهارت نرم‌افزاری ----
  F('skills', 'software', 'نام نرم‌افزار / مهارت', 'text', { required: 1, width: 6 }),
  F('skills', 'level', 'سطح', 'select', { required: 1, width: 6, options: ['عالی', 'خوب', 'متوسط'] }),
  // ---- دوره‌ها ----
  F('courses', 'course', 'نام دوره', 'text', { required: 1, width: 4 }),
  F('courses', 'institute', 'مؤسسهٔ برگزارکننده', 'text', { width: 3 }),
  F('courses', 'duration', 'مدت دوره', 'text', { width: 2, placeholder: 'مثلاً ۴۰ ساعت' }),
  F('courses', 'certificate', 'مدرک', 'radio', { width: 3, options: ['دارد', 'ندارد'] }),
  // ---- دیدگاه‌ها و انتظارات ----
  F('expectations', 'satisfaction', 'چه عواملی باعث رضایت شما از محیط کار می‌شود؟', 'textarea', { width: 6 }),
  F('expectations', 'dissatisfaction', 'چه عواملی باعث عدم رضایت شما از محیط کار می‌شود؟', 'textarea', { width: 6 }),
  F('expectations', 'cooperation_type', 'نوع همکاری مورد تمایل', 'multi', { required: 1, width: 6, options: ['تمام‌وقت', 'پاره‌وقت', 'دورکاری', 'پروژه‌ای'] }),
  F('expectations', 'part_time_schedule', 'در صورت پاره‌وقت: روزها و ساعات', 'text', { width: 6, show_if: 'cooperation_type=پاره‌وقت' }),
  F('expectations', 'expected_salary', 'حقوق مورد انتظار (تومان)', 'money', { required: 1, width: 4 }),
  F('expectations', 'desired_position', 'سمت مورد تمایل', 'text', { width: 4 }),
  F('expectations', 'available_from', 'تاریخ آمادگی شروع به کار', 'date', { width: 4 }),
  F('expectations', 'referral_source', 'نحوهٔ آشنایی با شرکت', 'select', { width: 6, options: ['سایت‌های کاریابی', 'شبکه‌های اجتماعی', 'معرفی دوستان / آشنایان', 'سایت شرکت', 'آگهی', 'مراجعهٔ حضوری', 'سایر'] }),
  // ---- شرایط و الزامات ----
  F('conditions', 'overtime', 'آیا آمادگی اضافه‌کاری دارید؟', 'radio', { required: 1, width: 12, options: ['آمادگی کامل دارم', 'در شرایط خاص و با اطلاع قبلی', 'خیر'] }),
  F('conditions', 'travel', 'آمادگی مأموریت (می‌توانید چند مورد انتخاب کنید)', 'multi', { required: 1, width: 12, options: ['مأموریت کوتاه‌مدت داخلی', 'مأموریت کوتاه‌مدت و بلندمدت داخلی', 'مأموریت کوتاه‌مدت خارجی', 'مأموریت کوتاه‌مدت و بلندمدت خارجی', 'امکان مأموریت ندارم'] }),
  F('conditions', 'health', 'آیا از سلامت جسمی و روانی مطلوب برخوردارید؟', 'radio', { required: 1, width: 6, options: ['بله', 'خیر'] }),
  F('conditions', 'illness', 'در صورت داشتن بیماری خاص، توضیح دهید', 'textarea', { width: 6 }),
  // ---- معرف ----
  F('references', 'name', 'نام و نام خانوادگی', 'text', { required: 1, width: 4 }),
  F('references', 'relation', 'نسبت', 'text', { required: 1, width: 4, placeholder: 'مدیر سابق، همکار، استاد…' }),
  F('references', 'phone', 'تلفن تماس', 'text', { required: 1, width: 4 }),
  // ---- اقرار ----
  F('declaration', 'accept', 'صحت اطلاعات را تأیید می‌کنم', 'accept', { required: 1, width: 12, locked: 1 })
];

module.exports = { SECTIONS, FIELDS };
