'use strict';
/**
 * دادهٔ نمونه: کاربران HR/کارمند، واحدها، موقعیت‌های شغلی، دعوت‌نامه، ۱۲ متقاضی با فرم کامل، آزمون MBTI تکمیل‌شده، مصاحبه، ارزیابی، اعلان
 * run({ log, adminId }) — idempotent (با وجود hrmanager دوباره اجرا نمی‌شود)
 * clear({ keepUserId }) — پاک‌کردن همهٔ داده‌ها به‌جز حساب مدیر ارشد، تنظیمات، نقش‌ها، فرم و آزمون
 */
const db = require('../../src/core/db');
const auth = require('../../src/core/auth');
const J = require('../../src/core/jalali');
const utils = require('../../src/core/utils');

const DEMO_PASS = '123456';
const pick = (arr, i) => arr[i % arr.length];
const ago = (days, hour) => { const d = new Date(Date.now() - days * 86400000); d.setUTCHours(hour == null ? 8 : hour, Math.floor(Math.random() * 50), 0, 0); return d.toISOString().slice(0, 19).replace('T', ' '); };

const FIRST_M = ['علی', 'محمد', 'حسین', 'رضا', 'امیر', 'مهدی', 'سعید', 'حامد'];
const FIRST_F = ['زهرا', 'فاطمه', 'مریم', 'سارا', 'نرگس', 'الهام', 'نازنین', 'مینا'];
const LAST = ['احمدی', 'کریمی', 'رضایی', 'موسوی', 'حسینی', 'صادقی', 'جعفری', 'نوروزی', 'قاسمی', 'عباسی', 'شریفی', 'طاهری'];
const COMPANIES = ['فولاد مبارکه', 'ذوب‌آهن اصفهان', 'پالایشگاه اصفهان', 'شرکت توسعه صنایع نفت', 'پتروشیمی اصفهان', 'شرکت مهندسی نیرو', 'گروه صنعتی انتخاب', 'شرکت فناوری پیشرو'];
const POSITIONS_TITLES = ['کارشناس', 'کارشناس ارشد', 'سرپرست', 'تکنسین', 'مهندس'];
const FIELDS = ['مهندسی مکانیک', 'مهندسی برق', 'مهندسی صنایع', 'مهندسی کامپیوتر', 'حسابداری', 'مدیریت بازرگانی', 'مهندسی شیمی', 'مهندسی مواد'];
const UNIS = ['دانشگاه صنعتی اصفهان', 'دانشگاه اصفهان', 'دانشگاه آزاد اسلامی واحد نجف‌آباد', 'دانشگاه صنعتی شریف', 'دانشگاه تهران', 'دانشگاه کاشان'];

// الگوهای پاسخ MBTI برای تنوع تیپ‌ها: برای هر بُعد، احتمال انتخاب قطب اول
const PROFILES = [
  { E: 0.85, N: 0.3, T: 0.8, J: 0.85 }, { E: 0.25, N: 0.75, T: 0.8, J: 0.75 }, { E: 0.8, N: 0.8, T: 0.3, J: 0.3 }, { E: 0.2, N: 0.25, T: 0.3, J: 0.85 },
  { E: 0.7, N: 0.25, T: 0.75, J: 0.3 }, { E: 0.3, N: 0.8, T: 0.25, J: 0.4 }, { E: 0.85, N: 0.7, T: 0.75, J: 0.4 }, { E: 0.2, N: 0.3, T: 0.8, J: 0.8 },
  { E: 0.5, N: 0.5, T: 0.55, J: 0.5 }, { E: 0.75, N: 0.3, T: 0.3, J: 0.8 }, { E: 0.3, N: 0.8, T: 0.75, J: 0.3 }, { E: 0.8, N: 0.75, T: 0.3, J: 0.8 }
];

function rnd(seed) { let x = seed * 9301 + 49297; return () => { x = (x * 9301 + 49297) % 233280; return x / 233280; }; }

async function run({ log, adminId }) {
  log = log || (() => {});
  if (await db.table('users').where('username', 'hrmanager').exists()) { log('دادهٔ نمونه قبلاً بارگذاری شده است'); return; }
  const now = db.now();
  const pw = await auth.hashPassword(DEMO_PASS);
  // ---- کاربران ----
  const mk = async (u) => db.insert('users', Object.assign({ password: pw, status: 'active', is_super: 0, login_count: 0, created_by: adminId || null, created_at: now, updated_at: now }, u));
  const hrManagerId = await mk({ username: 'hrmanager', role: 'hr_manager', name: 'مریم صادقی', email: 'hr@example.com', mobile: '09131000001' });
  const hrStaffId = await mk({ username: 'hrstaff', role: 'hr_staff', name: 'علی رضایی', email: 'hr2@example.com', mobile: '09131000002' });
  // سطح دسترسی سفارشی: مصاحبه‌کنندهٔ فنی
  const roleId = await db.insert('roles', { key: 'interviewer', title: 'مصاحبه‌کنندهٔ فنی', description: 'فقط مشاهدهٔ پرونده‌های ارجاع‌شده، ثبت نظر مصاحبه و مشاهدهٔ تحلیل آزمون', base_role: 'hr_staff', color: 'purple', permissions: JSON.stringify(['applicants.view', 'applicants.evaluate', 'interviews.manage', 'assessments.view']), is_system: 0, sort_order: 20, created_at: now, updated_at: now });
  const interviewerId = await mk({ username: 'interviewer', role: 'hr_staff', role_id: roleId, name: 'حسین موسوی', email: 'tech@example.com', mobile: '09131000003' });
  const emp1 = await mk({ username: 'employee1', role: 'employee', name: 'سعید کریمی', email: 'saeed@example.com', mobile: '09131000004' });
  const emp2 = await mk({ username: 'employee2', role: 'employee', name: 'نرگس جعفری', email: 'narges@example.com', mobile: '09131000005' });
  log('کاربران نمونه ساخته شدند');

  // ---- واحدها ----
  const depts = {};
  for (const [i, [title, code]] of [['فنی و مهندسی', 'ENG'], ['تحقیق و توسعه', 'RND'], ['تولید', 'PRD'], ['مالی و اداری', 'FIN'], ['فروش و بازرگانی', 'SAL'], ['منابع انسانی', 'HR']].entries()) depts[code] = await db.insert('departments', { title, code, manager_id: i === 5 ? hrManagerId : null, sort_order: i * 10, created_at: now, updated_at: now });

  // ---- موقعیت‌های شغلی ----
  const P = async (p) => db.insert('job_positions', Object.assign({ status: 'open', is_public: 1, capacity: 1, require_test: 1, gender: 'any', min_experience: 0, sort_order: 0, created_by: hrManagerId, created_at: now, updated_at: now, employment_type: 'full_time', location: 'اصفهان' }, p));
  const pos = {};
  pos.mech = await P({ title: 'مهندس طراح مکانیک', code: 'ENG-01', department_id: depts.ENG, description: 'طراحی و مدل‌سازی تجهیزات صنعتی با SolidWorks، تهیهٔ نقشه‌های ساخت و همکاری با تیم تولید.', requirements: 'کارشناسی مهندسی مکانیک، تسلط به SolidWorks و AutoCAD، حداقل ۳ سال سابقهٔ طراحی', benefits: 'بیمهٔ تکمیلی، سرویس، ناهار، پاداش پروژه', salary_range: 'توافقی بر اساس سابقه', capacity: 2, preferred_types: 'INTJ,ISTJ,INTP', min_experience: 3, education_min: 'bachelor', sort_order: 10 });
  pos.ctrl = await P({ title: 'مهندس برق و کنترل (PLC)', code: 'ENG-02', department_id: depts.ENG, description: 'برنامه‌نویسی PLC زیمنس، طراحی تابلو برق و راه‌اندازی خطوط اتوماسیون صنعتی.', requirements: 'کارشناسی مهندسی برق، تسلط به TIA Portal، آشنایی با HMI و درایو', benefits: 'بیمهٔ تکمیلی، سرویس، ناهار', salary_range: '۲۵ تا ۴۰ میلیون تومان', preferred_types: 'ISTP,INTJ,ISTJ,ENTJ', min_experience: 2, education_min: 'bachelor', sort_order: 20 });
  pos.rnd = await P({ title: 'کارشناس تحقیق و توسعه', code: 'RND-01', department_id: depts.RND, description: 'پژوهش و توسعهٔ محصولات جدید دانش‌بنیان، تدوین مستندات فنی و ثبت اختراع.', requirements: 'کارشناسی ارشد مهندسی (مکانیک/مواد/شیمی)، روحیهٔ پژوهشی، تسلط به زبان انگلیسی', benefits: 'حمایت از انتشار مقاله، بیمهٔ تکمیلی', salary_range: 'توافقی', preferred_types: 'INTP,INTJ,ENTP,INFJ', education_min: 'master', sort_order: 30 });
  pos.prod = await P({ title: 'سرپرست تولید', code: 'PRD-01', department_id: depts.PRD, description: 'سرپرستی خط تولید، برنامه‌ریزی شیفت‌ها، کنترل کیفیت و ایمنی.', requirements: 'کارشناسی صنایع/مکانیک، ۵ سال سابقهٔ تولید، توان رهبری تیم', benefits: 'حق سرپرستی، بیمهٔ تکمیلی، سرویس', salary_range: '۳۰ تا ۴۵ میلیون تومان', preferred_types: 'ESTJ,ENTJ,ISTJ', min_experience: 5, education_min: 'bachelor', sort_order: 40 });
  pos.acc = await P({ title: 'کارشناس حسابداری', code: 'FIN-01', department_id: depts.FIN, description: 'ثبت اسناد، تهیهٔ گزارش‌های مالی، امور بیمه و مالیات.', requirements: 'کارشناسی حسابداری، تسلط به نرم‌افزار سپیدار/همکاران سیستم و Excel', benefits: 'بیمهٔ تکمیلی، ناهار', salary_range: '۱۸ تا ۲۸ میلیون تومان', preferred_types: 'ISTJ,ISFJ,ESTJ', min_experience: 2, education_min: 'bachelor', sort_order: 50 });
  pos.sales = await P({ title: 'کارشناس فروش صنعتی', code: 'SAL-01', department_id: depts.SAL, description: 'توسعهٔ بازار محصولات صنعتی، مذاکره با مشتریان سازمانی و پیگیری قراردادها.', requirements: 'کارشناسی، روابط عمومی قوی، آمادگی مأموریت', benefits: 'پورسانت فروش، خودرو مأموریت', salary_range: 'ثابت + پورسانت', preferred_types: 'ESTP,ENFP,ENTP,ESFJ', employment_type: 'full_time', sort_order: 60 });
  pos.hr = await P({ title: 'کارشناس منابع انسانی', code: 'HR-01', department_id: depts.HR, description: 'جذب و استخدام، امور کارکنان، آموزش و ارزیابی عملکرد.', requirements: 'کارشناسی مدیریت/روان‌شناسی صنعتی، آشنایی با قانون کار', benefits: 'بیمهٔ تکمیلی', salary_range: '۲۰ تا ۳۰ میلیون تومان', preferred_types: 'ENFJ,ESFJ,INFJ,ISFJ', sort_order: 70 });
  pos.intern = await P({ title: 'کارآموز نرم‌افزار', code: 'RND-02', department_id: depts.RND, description: 'توسعهٔ ابزارهای داخلی با Node.js و Python زیر نظر تیم R&D.', requirements: 'دانشجو یا فارغ‌التحصیل کامپیوتر، علاقه به یادگیری', benefits: 'حقوق کارآموزی، امکان جذب', salary_range: 'کارآموزی', employment_type: 'internship', preferred_types: 'INTP,ENTP,ISTP', sort_order: 80 });
  pos.closed = await P({ title: 'کارشناس انبار', code: 'PRD-02', department_id: depts.PRD, description: 'کنترل موجودی و ورود و خروج کالا.', status: 'closed', sort_order: 90 });
  const posList = [pos.mech, pos.ctrl, pos.rnd, pos.prod, pos.acc, pos.sales, pos.hr, pos.intern];
  log('موقعیت‌های شغلی ساخته شدند');

  // ---- دعوت‌نامه ----
  await db.insert('invites', { code: 'EXPO1404', title: 'نمایشگاه صنعت اصفهان ۱۴۰۴', position_id: null, max_uses: 0, uses: 3, expires_at: J.addDays(J.todayISO(), 60), status: 'active', note: 'QR چاپ‌شده در غرفهٔ نمایشگاه', created_by: hrManagerId, created_at: now, updated_at: now });
  await db.insert('invites', { code: 'WALKIN', title: 'مراجعهٔ حضوری — نگهبانی', position_id: null, max_uses: 0, uses: 5, expires_at: null, status: 'active', note: 'QR نصب‌شده در ورودی شرکت', created_by: hrManagerId, created_at: now, updated_at: now });
  await db.insert('invites', { code: 'PLC-REF', title: 'معرفی‌شدگان برای PLC', position_id: pos.ctrl, max_uses: 10, uses: 2, expires_at: J.addDays(J.todayISO(), 20), status: 'active', note: null, created_by: hrStaffId, created_at: now, updated_at: now });

  // ---- متقاضیان ----
  const mbti = require('../../src/modules/assessments/mbti');
  const asvc = require('../../src/modules/assessments/service');
  const test = await db.table('assessments').where('key', 'mbti').first();
  const qs = test ? await asvc.questionsOf(test.id) : [];
  const statuses = ['submitted', 'submitted', 'screening', 'screening', 'test', 'interview', 'interview', 'offer', 'hired', 'rejected', 'screening', 'submitted'];
  const apps = [];
  for (let i = 0; i < 12; i++) {
    const female = i % 3 === 1;
    const first = female ? pick(FIRST_F, i) : pick(FIRST_M, i), last = pick(LAST, i);
    const mobile = '0913' + String(2000000 + i * 7919).padStart(7, '0');
    const nid = String(1270000000 + i * 1237).padStart(10, '0');
    const uid = await db.insert('users', { username: 'm' + mobile, password: null, role: 'applicant', name: first + ' ' + last, mobile, email: `applicant${i + 1}@example.com`, status: 'active', is_super: 0, login_count: 2, mobile_verified_at: ago(20 - i), last_login_at: ago(Math.max(0, 10 - i)), created_at: ago(20 - i), updated_at: now });
    const positionId = pick(posList, i);
    const birthYear = 1365 + (i % 12);
    const married = i % 2 === 0;
    const r = rnd(i + 11);
    const data = {
      personal: { first_name: first, last_name: last, father_name: pick(FIRST_M, i + 3), national_id: nid, id_number: String(100 + i * 37), birth_date: J.toGregorian(`${birthYear}/0${1 + (i % 9)}/1${i % 9}`), birth_place: pick(['اصفهان', 'نجف‌آباد', 'شهرضا', 'کاشان', 'تهران'], i), gender: female ? 'زن' : 'مرد', religion: 'اسلام', sect: 'شیعه', mobile, phone: '0313' + String(2000000 + i * 311), email: `applicant${i + 1}@example.com`, insurance_history: i % 4 === 3 ? 'ندارد' : 'دارد', insurance_years: i % 4 === 3 ? null : 2 + (i % 7), insurance_number: i % 4 === 3 ? null : String(8000000 + i * 13), military_status: female ? 'مشمول نمی‌شوم' : pick(['پایان خدمت', 'معافیت دائم', 'پایان خدمت'], i), marital_status: married ? 'متأهل' : 'مجرد', spouse_name: married ? (female ? pick(FIRST_M, i + 1) : pick(FIRST_F, i + 1)) + ' ' + pick(LAST, i + 2) : null, spouse_phone: married ? '0913' + String(3000000 + i * 17) : null, spouse_job: married ? pick(['کارمند بانک', 'معلم', 'آزاد', 'خانه‌دار', 'مهندس'], i) : null, children_count: married ? i % 3 : null, address: `اصفهان، ${pick(['خیابان چهارباغ بالا', 'خیابان هشت‌بهشت', 'سپاهان‌شهر', 'خیابان کاوه', 'ملک‌شهر', 'بهارستان'], i)}، کوچهٔ ${J.toPersianDigits(i + 3)}، پلاک ${J.toPersianDigits(10 + i)}`, postal_code: String(8100000000 + i * 1111) },
      work: Array.from({ length: 1 + (i % 3) }, (_, k) => ({ company: pick(COMPANIES, i + k), position: pick(POSITIONS_TITLES, i + k) + ' ' + pick(['طراحی', 'کنترل کیفیت', 'تولید', 'فروش', 'مالی'], i + k), work_phone: '0313' + String(5000000 + i * 97 + k), start_date: `${1395 + k * 2 + (i % 3)}/01`, end_date: k === 0 ? 'ادامه دارد' : `${1397 + k * 2 + (i % 3)}/06`, duration: `${J.toPersianDigits(1 + k + (i % 3))} سال`, last_salary: 12000000 + (i + k) * 1500000, leave_reason: k === 0 ? 'جست‌وجوی فرصت رشد بهتر' : pick(['اتمام قرارداد', 'جابه‌جایی محل سکونت', 'تعدیل نیرو', 'ارتقای شغلی'], i + k) })),
      education: [{ degree: pick(['کارشناسی', 'کارشناسی ارشد', 'کارشناسی', 'کاردانی'], i), field: pick(FIELDS, i), institute: pick(UNIS, i), grad_year: 1388 + (i % 12), gpa: 14 + (i % 6) + 0.25 }].concat(i % 3 === 0 ? [{ degree: 'کارشناسی ارشد', field: pick(FIELDS, i + 1), institute: pick(UNIS, i + 2), grad_year: 1392 + (i % 10), gpa: 16.5 }] : []),
      languages: [{ language: 'انگلیسی', level: pick(['خوب', 'بسیار خوب', 'متوسط'], i) }].concat(i % 4 === 0 ? [{ language: 'آلمانی', level: 'ضعیف' }] : []),
      skills: [{ software: 'Microsoft Office', level: 'عالی' }, { software: pick(['SolidWorks', 'AutoCAD', 'TIA Portal', 'MATLAB', 'Excel پیشرفته', 'سپیدار', 'Python', 'Power BI'], i), level: pick(['خوب', 'عالی', 'متوسط'], i + 1) }],
      courses: i % 2 ? [{ course: pick(['ISO 9001', 'ایمنی صنعتی HSE', 'مدیریت پروژه PMBOK', 'Six Sigma', 'حسابداری مالیاتی'], i), institute: pick(['سازمان فنی و حرفه‌ای', 'جهاد دانشگاهی', 'مؤسسهٔ آموزش عالی آزاد'], i), duration: `${J.toPersianDigits(20 + i * 4)} ساعت`, certificate: 'دارد' }] : [],
      expectations: { satisfaction: pick(['محیط حرفه‌ای و احترام متقابل', 'امکان یادگیری و رشد', 'شفافیت در وظایف و حقوق به‌موقع', 'کار تیمی و مدیر حمایت‌گر'], i), dissatisfaction: pick(['بی‌نظمی و تصمیم‌های لحظه‌ای', 'نبود مسیر رشد', 'تبعیض و بی‌عدالتی', 'فشار کاری بدون قدردانی'], i), cooperation_type: i % 5 === 4 ? ['تمام‌وقت', 'پاره‌وقت'] : ['تمام‌وقت'], part_time_schedule: i % 5 === 4 ? 'روزهای فرد ۸ تا ۱۴' : null, expected_salary: 18000000 + i * 2500000, desired_position: null, available_from: J.addDays(J.todayISO(), 7 + i * 3), referral_source: pick(['سایت‌های کاریابی', 'معرفی دوستان / آشنایان', 'شبکه‌های اجتماعی', 'مراجعهٔ حضوری', 'سایت شرکت'], i) },
      conditions: { overtime: pick(['آمادگی کامل دارم', 'در شرایط خاص و با اطلاع قبلی', 'آمادگی کامل دارم'], i), travel: i % 3 === 0 ? ['مأموریت کوتاه‌مدت داخلی', 'مأموریت کوتاه‌مدت خارجی'] : i % 3 === 1 ? ['مأموریت کوتاه‌مدت و بلندمدت داخلی'] : ['امکان مأموریت ندارم'], health: 'بله', illness: null },
      references: [{ name: pick(FIRST_M, i + 5) + ' ' + pick(LAST, i + 5), relation: pick(['مدیر سابق', 'استاد دانشگاه', 'همکار'], i), phone: '0913' + String(4000000 + i * 23) }],
      declaration: { accept: 1 }
    };
    const status = statuses[i];
    const submittedAt = ago(18 - i, 9);
    const code = 'EM-04' + String(10000 + i * 731).slice(-5);
    const appId = await db.insert('applications', {
      user_id: uid, position_id: positionId, invite_id: i % 4 === 0 ? 2 : null, tracking_code: code, status, first_name: first, last_name: last, national_id: nid, mobile, email: data.personal.email, birth_date: data.personal.birth_date,
      data: JSON.stringify(data), progress: JSON.stringify(['personal', 'work', 'education', 'languages', 'skills', 'courses', 'expectations', 'conditions', 'references', 'declaration']), current_step: 9, completion: 100,
      rating: i % 6, tags: i % 3 === 0 ? 'معرفی‌شده' : (i % 3 === 1 ? 'اولویت' : null), assigned_to: i % 2 ? hrStaffId : (i % 4 === 0 ? interviewerId : null), source: i % 4 === 0 ? 'qr' : 'web',
      final_decision: status === 'hired' ? 'suitable' : status === 'rejected' ? 'rejected' : null, decided_by: ['hired', 'rejected'].includes(status) ? hrManagerId : null, decided_at: ['hired', 'rejected'].includes(status) ? ago(2) : null,
      submitted_at: submittedAt, last_activity_at: ago(Math.max(0, 8 - i)), hired_at: status === 'hired' ? ago(1) : null, created_at: ago(19 - i), updated_at: now
    });
    apps.push({ id: appId, uid, first, last, mobile, status, positionId, i });
    await db.insert('application_history', { application_id: appId, from_status: 'draft', to_status: 'submitted', user_id: uid, note: 'ارسال توسط متقاضی', created_at: submittedAt });
    const flow = ['submitted', 'screening', 'test', 'interview', 'offer', 'hired'];
    const idx = flow.indexOf(status);
    for (let k = 1; k <= idx; k++) await db.insert('application_history', { application_id: appId, from_status: flow[k - 1], to_status: flow[k], user_id: hrStaffId, note: null, created_at: ago(16 - i - k) });
    if (status === 'rejected') await db.insert('application_history', { application_id: appId, from_status: 'interview', to_status: 'rejected', user_id: hrManagerId, note: 'عدم تطابق با نیازهای فنی', created_at: ago(2) });
    // آزمون MBTI
    if (test && qs.length && !['submitted'].includes(status)) {
      const prof = PROFILES[i];
      const answers = {};
      for (const q of qs) { const [o1, o2] = q.options; const p1 = prof[o1.pole] != null ? prof[o1.pole] : (prof[o2.pole] != null ? 1 - prof[o2.pole] : 0.5); answers[q.number] = r() < p1 ? o1.key : o2.key; }
      const result = mbti.score(answers, qs);
      const started = ago(15 - i, 10);
      await db.insert('assessment_attempts', { assessment_id: test.id, application_id: appId, user_id: uid, status: 'completed', answers: JSON.stringify(answers), result: JSON.stringify(result), result_type: result.type, started_at: started, completed_at: ago(15 - i, 11), duration_sec: 420 + i * 37, assigned_by: null, created_at: started, updated_at: now });
    } else if (test && status === 'submitted' && i % 2 === 0) {
      await db.insert('assessment_attempts', { assessment_id: test.id, application_id: appId, user_id: uid, status: 'assigned', assigned_by: null, created_at: submittedAt, updated_at: now });
    }
    // یادداشت
    if (i % 2 === 0) await db.insert('application_notes', { application_id: appId, user_id: hrStaffId, body: pick(['تماس اولیه انجام شد؛ برای مصاحبه اعلام آمادگی کرد.', 'رزومهٔ قوی در حوزهٔ طراحی. پیشنهاد می‌شود مصاحبهٔ فنی با مهندس موسوی برگزار شود.', 'حقوق درخواستی بالاتر از بودجهٔ موقعیت است؛ نیاز به مذاکره.', 'معرفی‌شده از طرف واحد تولید.'], i), kind: 'note', is_private: 0, created_at: ago(10 - i) });
    // مصاحبه
    if (['interview', 'offer', 'hired', 'rejected'].includes(status)) {
      const done = ['offer', 'hired', 'rejected'].includes(status);
      await db.insert('interviews', { application_id: appId, interviewer_id: i % 2 ? interviewerId : hrManagerId, scheduled_at: done ? ago(4 - (i % 3), 10) : J.addDays(J.todayISO(), 1 + (i % 4)) + ' 10:30:00', duration_min: 45, location: 'دفتر مرکزی — اتاق جلسات طبقهٔ دوم', kind: i % 3 === 2 ? 'online' : 'in_person', status: done ? 'done' : 'scheduled', result: done ? 'مصاحبه برگزار شد؛ تسلط فنی خوب، نیاز به تقویت مهارت ارائه.' : null, notified_at: ago(5), created_by: hrStaffId, created_at: ago(6), updated_at: now });
    }
    // ارزیابی
    if (['interview', 'offer', 'hired', 'rejected'].includes(status)) {
      await db.insert('application_evaluations', { application_id: appId, stage: 'interviewer', user_id: interviewerId, opinion: 'دانش فنی مناسب، پاسخ‌گویی دقیق به سؤال‌های تخصصی. تجربهٔ عملی با تجهیزات مشابه دارد.', decision: status === 'rejected' ? 'review' : 'suitable', score: status === 'rejected' ? 5 : 7 + (i % 3), strengths: 'تسلط فنی، انگیزهٔ بالا', weaknesses: 'مهارت ارائه', created_at: ago(3), updated_at: ago(3) });
      await db.insert('application_evaluations', { application_id: appId, stage: 'hr', user_id: hrStaffId, opinion: 'تطابق خوب با فرهنگ سازمانی؛ انتظارات حقوقی در بازهٔ موقعیت.', decision: status === 'rejected' ? 'rejected' : 'suitable', score: status === 'rejected' ? 4 : 8, strengths: 'ثبات شغلی، روحیهٔ همکاری', weaknesses: null, created_at: ago(3), updated_at: ago(3) });
    }
    if (['offer', 'hired', 'rejected'].includes(status)) await db.insert('application_evaluations', { application_id: appId, stage: 'management', user_id: hrManagerId, opinion: status === 'rejected' ? 'با توجه به نیاز فوری به تخصص خاص، در این مرحله رد می‌شود؛ برای فرصت‌های آینده نگهداری شود.' : 'تأیید استخدام با دورهٔ آزمایشی سه‌ماهه.', decision: status === 'rejected' ? 'rejected' : 'suitable', score: status === 'rejected' ? 4 : 9, strengths: null, weaknesses: null, created_at: ago(2), updated_at: ago(2) });
    // اعلان به متقاضی
    await db.insert('notifications', { user_id: uid, title: 'درخواست شما ثبت شد', body: `کد پیگیری: ${code}`, link: '/portal', type: 'success', is_read: i % 2, created_at: submittedAt });
  }
  // متقاضی با پیش‌نویس ناقص
  const draftMobile = '09139990001';
  const draftUid = await db.insert('users', { username: 'm' + draftMobile, password: null, role: 'applicant', name: null, mobile: draftMobile, status: 'active', is_super: 0, login_count: 1, mobile_verified_at: ago(1), created_at: ago(1), updated_at: now });
  await db.insert('applications', { user_id: draftUid, position_id: pos.intern, tracking_code: 'EM-04DRAFT', status: 'draft', mobile: draftMobile, data: JSON.stringify({ personal: { first_name: 'امیر', last_name: 'نوروزی', mobile: draftMobile } }), progress: '[]', current_step: 0, completion: 10, source: 'web', last_activity_at: ago(1), created_at: ago(1), updated_at: now });
  log('۱۲ پروندهٔ استخدام با آزمون و ارزیابی ساخته شد');

  // ---- کارمند استخدام‌شده ----
  const hiredApp = apps.find((a) => a.status === 'hired');
  if (hiredApp) { try { await require('../../src/modules/employees/service').fromApplication(await db.findById('applications', hiredApp.id), null, { department_id: depts.ENG, position_title: 'مهندس طراح مکانیک', hire_date: J.todayISO() }); } catch (e) { log('ایجاد کارمند از پرونده: ' + e.message); } }
  await db.insert('employees', { user_id: emp1, application_id: null, employee_code: '1001', first_name: 'سعید', last_name: 'کریمی', national_id: '1271111111', mobile: '09131000004', email: 'saeed@example.com', department_id: depts.ENG, position_title: 'کارشناس ارشد طراحی', hire_date: J.addDays(J.todayISO(), -800), status: 'active', data: '{}', created_at: now, updated_at: now });
  await db.insert('employees', { user_id: emp2, application_id: null, employee_code: '1002', first_name: 'نرگس', last_name: 'جعفری', national_id: '1272222222', mobile: '09131000005', email: 'narges@example.com', department_id: depts.FIN, position_title: 'کارشناس حسابداری', hire_date: J.addDays(J.todayISO(), -400), status: 'active', data: '{}', created_at: now, updated_at: now });
  await db.insert('announcements', { title: 'به سامانهٔ منابع انسانی خوش آمدید', body: 'از این پس فرایند استخدام، آزمون‌ها و اطلاعیه‌های داخلی از طریق این سامانه انجام می‌شود.', audience: 'all', is_pinned: 1, publish_at: J.todayISO(), expires_at: null, created_by: hrManagerId, created_at: now, updated_at: now });
  await db.insert('announcements', { title: 'جلسهٔ هماهنگی تیم جذب', body: 'جلسهٔ هفتگی بررسی پرونده‌ها یکشنبه ساعت ۱۰ در اتاق جلسات برگزار می‌شود.', audience: 'hr', is_pinned: 0, publish_at: J.todayISO(), expires_at: J.addDays(J.todayISO(), 10), created_by: hrManagerId, created_at: now, updated_at: now });
  // اعلان‌های HR
  for (const uid of [hrManagerId, hrStaffId]) await db.insert('notifications', { user_id: uid, title: 'درخواست استخدام جدید', body: `${apps[0].first} ${apps[0].last} — مهندس طراح مکانیک`, link: '/recruitment/applications/' + apps[0].id, type: 'info', is_read: 0, created_at: ago(0, 7) });
  // لاگ پیامک نمونه
  await db.insertMany('sms_logs', apps.slice(0, 5).map((a, k) => ({ mobile: a.mobile, message: `${a.first} گرامی، درخواست استخدام شما ثبت شد.`, kind: 'submitted', status: k === 3 ? 'failed' : 'sent', provider: 'log', provider_id: null, error: k === 3 ? 'اعتبار پنل کافی نیست' : null, cost: 0, user_id: a.uid, created_at: ago(18 - k), sent_at: k === 3 ? null : ago(18 - k) })));
  // لاگ فعالیت
  await db.insertMany('activity_logs', [
    { user_id: hrManagerId, action: 'create', entity: 'job_position', entity_id: pos.mech, description: 'ایجاد موقعیت مهندس طراح مکانیک', ip: '127.0.0.1', created_at: ago(25) },
    { user_id: hrStaffId, action: 'update', entity: 'application', entity_id: apps[2].id, description: 'تغییر وضعیت پرونده به در حال بررسی', ip: '127.0.0.1', created_at: ago(5) },
    { user_id: hrManagerId, action: 'update', entity: 'application', entity_id: apps[8].id, description: 'تصمیم نهایی: استخدام', ip: '127.0.0.1', created_at: ago(1) }
  ]);
  log('کارمندان، اطلاعیه‌ها و لاگ‌های نمونه ساخته شدند');
}

async function clear({ keepUserId }) {
  for (const t of ['assessment_attempts', 'application_evaluations', 'interviews', 'application_notes', 'application_history', 'application_files', 'applications', 'invites', 'employees', 'announcements', 'notifications', 'sms_logs', 'otp_codes', 'login_logs', 'activity_logs', 'job_runs']) await db.table(t).delete();
  await db.table('job_positions').delete();
  await db.table('departments').delete();
  const q = db.table('users').where('is_super', 0); if (keepUserId) q.where('id', '!=', keepUserId); await q.delete();
  await db.table('roles').where('is_system', 0).delete();
  require('../../src/core/permissions').reload();
  // فایل‌های بارگذاری‌شدهٔ پرونده‌ها
  try { const fs = require('fs'); const path = require('path'); const dir = path.join(require('../../src/core/config').get().uploads.dir, 'applications'); fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

module.exports = { run, clear, DEMO_PASS };
