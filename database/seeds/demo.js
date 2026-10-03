'use strict';
/**
 * دادهٔ نمونه (دمو) — یک مدرسهٔ کامل با معلم، کلاس، دانش‌آموز، حضور و غیاب، آزمون، تکلیف، تیکت، مالی و…
 * قابل اجرا از ویزارد نصب یا `node scripts/seed.js`.
 * همهٔ داده‌ها با یک مولد تصادفی قطعی ساخته می‌شوند تا هر بار خروجی یکسان باشد.
 */
const J = require('../../src/core/jalali');
const auth = require('../../src/core/auth');
const settingsStore = require('../../src/core/settings');

// ---------- مولد تصادفی قطعی ----------
let seed = 20250923;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;
const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const gauss = () => { let u = 0, v = 0; while (u === 0) u = rnd(); while (v === 0) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const pad = (n, l) => String(n).padStart(l, '0');
const digits = (l) => { let s = ''; for (let i = 0; i < l; i++) s += ri(0, 9); return s; };
const mobile = () => '09' + pick(['12', '13', '19', '35', '36', '37', '38', '39', '01', '02', '03', '90', '91', '92']) + digits(7);
const nationalId = () => { const d = []; for (let i = 0; i < 9; i++) d.push(ri(0, 9)); let s = 0; for (let i = 0; i < 9; i++) s += d[i] * (10 - i); const r = s % 11; d.push(r < 2 ? r : 11 - r); return d.join(''); };

// ---------- داده‌های پایه ----------
const MALE = ['امیرعلی', 'محمدحسین', 'علی', 'امیرحسین', 'ابوالفضل', 'محمد', 'حسین', 'رضا', 'مهدی', 'سینا', 'آرمین', 'پارسا', 'آرش', 'کیان', 'سامان', 'بنیامین', 'ماهان', 'آریا', 'سبحان', 'طاها', 'یاسین', 'دانیال', 'ایلیا', 'نیما', 'سهیل', 'امیرمحمد', 'محمدرضا', 'عرفان', 'متین', 'شایان', 'پوریا', 'رادین', 'حامد', 'سجاد', 'مبین', 'آرتین', 'بردیا', 'کوروش', 'فرهاد', 'هومن'];
const FEMALE = ['فاطمه', 'زهرا', 'مریم', 'نرگس', 'ریحانه', 'سارا', 'حنانه', 'آیدا', 'نازنین', 'مبینا', 'یسنا', 'هستی', 'ستایش', 'رها', 'آوا', 'باران', 'ثنا', 'الینا', 'کیانا', 'نیایش', 'محدثه', 'زینب', 'معصومه', 'مهسا', 'نگار', 'پریا', 'شیدا', 'غزل', 'ترانه', 'دینا', 'آتنا', 'ملیکا', 'هلیا', 'سوگند', 'روژان', 'پرنیان', 'عسل', 'نیلوفر', 'بهار', 'الهام'];
const LAST = ['احمدی', 'محمدی', 'رضایی', 'حسینی', 'موسوی', 'کریمی', 'جعفری', 'صادقی', 'نوری', 'رحیمی', 'اکبری', 'قاسمی', 'حیدری', 'عباسی', 'ابراهیمی', 'مرادی', 'نظری', 'یوسفی', 'سلطانی', 'شریفی', 'زارعی', 'کاظمی', 'هاشمی', 'امینی', 'بهرامی', 'فتحی', 'سعیدی', 'طاهری', 'عزیزی', 'مهدوی', 'کاویانی', 'نجفی', 'توکلی', 'رستمی', 'شیرازی', 'اصفهانی', 'تهرانی', 'خسروی', 'عسگری', 'فرهادی', 'میرزایی', 'ملکی', 'نیکنام', 'پورمحمد', 'عالی‌پور', 'دهقان', 'باقری', 'جلالی', 'سبحانی', 'رنجبر'];
const FATHER_JOBS = ['کارمند', 'آزاد', 'مهندس عمران', 'راننده', 'معلم', 'پزشک', 'کارگر', 'فروشنده', 'حسابدار', 'بازنشسته', 'کشاورز', 'برنامه‌نویس', 'مغازه‌دار', 'پرستار', 'نظامی', 'وکیل'];
const MOTHER_JOBS = ['خانه‌دار', 'خانه‌دار', 'خانه‌دار', 'معلم', 'کارمند', 'پرستار', 'آرایشگر', 'خیاط', 'حسابدار', 'پزشک', 'مربی مهدکودک', 'فروشنده'];
const EDUS = ['زیر دیپلم', 'دیپلم', 'دیپلم', 'کاردانی', 'کارشناسی', 'کارشناسی', 'کارشناسی ارشد', 'دکتری'];
const STREETS = ['خیابان آزادی', 'خیابان انقلاب', 'بلوار کشاورز', 'خیابان ولیعصر', 'خیابان شریعتی', 'بلوار فردوسی', 'خیابان امام خمینی', 'خیابان طالقانی', 'بلوار دانشجو', 'خیابان مطهری', 'کوی استادان', 'شهرک گلستان'];
const CITIES = ['تهران', 'تهران', 'تهران', 'کرج', 'اصفهان', 'شیراز', 'مشهد', 'تبریز', 'قم', 'رشت'];
const BLOOD = ['O+', 'O+', 'A+', 'A+', 'B+', 'AB+', 'O-', 'A-'];
const ALLERGIES = ['حساسیت به گرده', 'حساسیت به بادام‌زمینی', 'حساسیت فصلی', 'حساسیت به پنی‌سیلین', 'حساسیت به گرد و غبار'];
const CONDITIONS = ['آسم خفیف', 'ضعف بینایی (عینک)', 'میگرن', 'دیابت نوع ۱', 'کم‌خونی خفیف'];

const SUBJECTS = [
  { title: 'ریاضی', code: 'MATH', hours: 4, field: 'ریاضی' },
  { title: 'علوم تجربی', code: 'SCI', hours: 3, field: 'علوم' },
  { title: 'ادبیات فارسی', code: 'LIT', hours: 3, field: 'ادبیات' },
  { title: 'مطالعات اجتماعی', code: 'SOC', hours: 3, field: 'مطالعات' },
  { title: 'عربی', code: 'ARB', hours: 2, field: 'دینی' },
  { title: 'زبان انگلیسی', code: 'ENG', hours: 2, field: 'انگلیسی' },
  { title: 'قرآن', code: 'QRN', hours: 2, field: 'دینی' },
  { title: 'پیام‌های آسمان', code: 'REL', hours: 2, field: 'معارف' },
  { title: 'تفکر و سبک زندگی', code: 'THK', hours: 1, field: 'مطالعات' },
  { title: 'کار و فناوری', code: 'TEC', hours: 1, field: 'هنر' },
  { title: 'هنر', code: 'ART', hours: 1, field: 'هنر' },
  { title: 'تربیت بدنی', code: 'PE', hours: 1, field: 'ورزش' }
];
// ۱۴ معلم: رشته + کلاس‌هایی که در آن رشته تدریس می‌کنند (اندیس کلاس ۰..۹)
const TEACHERS = [
  { name: 'محمدرضا کاظمی', gender: 'male', field: 'ریاضی', edu: 'کارشناسی ارشد', classes: [0, 1, 2, 3, 4] },
  { name: 'سمیه رحیمی', gender: 'female', field: 'ریاضی', edu: 'کارشناسی', classes: [5, 6, 7, 8, 9] },
  { name: 'علیرضا نوری', gender: 'male', field: 'علوم', edu: 'کارشناسی ارشد', classes: [0, 1, 2, 3, 4] },
  { name: 'مریم صادقی', gender: 'female', field: 'علوم', edu: 'کارشناسی', classes: [5, 6, 7, 8, 9] },
  { name: 'حسین مرادی', gender: 'male', field: 'ادبیات', edu: 'کارشناسی ارشد', classes: [0, 1, 2, 3, 4] },
  { name: 'فاطمه حسینی', gender: 'female', field: 'ادبیات', edu: 'دکتری', classes: [5, 6, 7, 8, 9] },
  { name: 'سیدمهدی موسوی', gender: 'male', field: 'دینی', edu: 'کارشناسی', classes: [0, 1, 2, 3, 4] },
  { name: 'زهرا کریمی', gender: 'female', field: 'دینی', edu: 'کارشناسی', classes: [5, 6, 7, 8, 9] },
  { name: 'احمد جعفری', gender: 'male', field: 'معارف', edu: 'کارشناسی ارشد', classes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
  { name: 'نسرین اکبری', gender: 'female', field: 'انگلیسی', edu: 'کارشناسی', classes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
  { name: 'رضا عباسی', gender: 'male', field: 'مطالعات', edu: 'کارشناسی', classes: [0, 1, 2, 3, 4, 5, 6] },
  { name: 'لیلا قاسمی', gender: 'female', field: 'مطالعات', edu: 'کارشناسی ارشد', classes: [7, 8, 9] },
  { name: 'امیر هاشمی', gender: 'male', field: 'هنر', edu: 'کارشناسی', classes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
  { name: 'سعید بهرامی', gender: 'male', field: 'ورزش', edu: 'کارشناسی', classes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] }
];
// تفکر و سبک زندگی: معلم مطالعات ۹ها (لیلا قاسمی) برای همهٔ کلاس‌ها
const CLASSES = [
  { grade: 0, title: 'هفتم الف' }, { grade: 0, title: 'هفتم ب' }, { grade: 0, title: 'هفتم ج' }, { grade: 0, title: 'هفتم د' },
  { grade: 1, title: 'هشتم الف' }, { grade: 1, title: 'هشتم ب' }, { grade: 1, title: 'هشتم ج' },
  { grade: 2, title: 'نهم الف' }, { grade: 2, title: 'نهم ب' }, { grade: 2, title: 'نهم ج' }
];
const GRADES = [{ title: 'هفتم', sort: 7 }, { title: 'هشتم', sort: 8 }, { title: 'نهم', sort: 9 }];
const PERIOD_TIMES = ['07:45-08:30', '08:40-09:25', '09:45-10:30', '10:40-11:25', '11:35-12:20'];
const SCHOOL_DAYS = [0, 1, 2, 3, 4];

const BOOKS = [
  ['شازده کوچولو', 'آنتوان دو سنت اگزوپری', 'نگاه', 'داستان'], ['قصه‌های مجید', 'هوشنگ مرادی کرمانی', 'معین', 'داستان'], ['کلیله و دمنه', 'نصرالله منشی', 'امیرکبیر', 'ادبیات کهن'],
  ['ماهی سیاه کوچولو', 'صمد بهرنگی', 'کانون پرورش فکری', 'داستان'], ['هری پاتر و سنگ جادو', 'جی.کی. رولینگ', 'کتابسرای تندیس', 'فانتزی'], ['دایرةالمعارف علوم', 'جمعی از نویسندگان', 'محراب قلم', 'علمی'],
  ['فیزیک به زبان ساده', 'ریچارد فاینمن', 'مازیار', 'علمی'], ['دور دنیا در هشتاد روز', 'ژول ورن', 'افق', 'ماجراجویی'], ['بیست هزار فرسنگ زیر دریا', 'ژول ورن', 'افق', 'ماجراجویی'],
  ['گلستان سعدی', 'سعدی', 'هرمس', 'ادبیات کهن'], ['شاهنامه برای نوجوانان', 'فردوسی / بازنویسی', 'قدیانی', 'ادبیات کهن'], ['ریاضیات شیرین', 'پرویز شهریاری', 'مدرسه', 'علمی'],
  ['تاریخ ایران باستان', 'حسن پیرنیا', 'نگاه', 'تاریخ'], ['بچه‌های راه‌آهن', 'ادیت نسبیت', 'افق', 'داستان'], ['خاطرات یک بچه چلمن', 'جف کینی', 'پرتقال', 'طنز'],
  ['دنیای سوفی', 'یوستین گردر', 'نیلوفر', 'فلسفه'], ['اطلس جغرافیای جهان', 'گیتاشناسی', 'گیتاشناسی', 'مرجع'], ['فرهنگ فارسی معین', 'محمد معین', 'امیرکبیر', 'مرجع'],
  ['داستان‌های شاهنامه', 'آتوسا صالحی', 'افق', 'ادبیات کهن'], ['معمای ریاضی', 'مارتین گاردنر', 'فاطمی', 'علمی'], ['رباتیک برای نوجوانان', 'جمعی از مؤلفان', 'نارنج', 'فناوری'],
  ['برنامه‌نویسی با اسکرچ', 'مجید رنجبر', 'نارنج', 'فناوری'], ['اولین دایرةالمعارف من', 'جین الیوت', 'پیدایش', 'مرجع'], ['قلعه حیوانات', 'جورج اورول', 'نیلوفر', 'داستان'],
  ['پینوکیو', 'کارلو کلودی', 'امیرکبیر', 'داستان'], ['ژان والژان (بینوایان)', 'ویکتور هوگو', 'افق', 'داستان'], ['رنگین‌کمان شیمی', 'نرگس شفیعی', 'مدرسه', 'علمی'],
  ['اختراعات بزرگ', 'دیوید مکالی', 'پیدایش', 'علمی'], ['دخترک کبریت‌فروش و قصه‌های دیگر', 'هانس کریستین اندرسن', 'قدیانی', 'داستان'], ['ادبیات نوجوان: شعر و ترانه', 'مصطفی رحماندوست', 'کانون پرورش فکری', 'شعر']
];

const TICKET_TOPICS = [
  ['درخواست مرخصی برای مراجعه به پزشک', 'با سلام، فرزندم روز سه‌شنبه نوبت پزشک دارد و باید ساعت ۱۰ مدرسه را ترک کند. لطفاً مجوز خروج صادر فرمایید.', 'leave'],
  ['سؤال دربارهٔ نمرهٔ آزمون ریاضی', 'سلام استاد، نمرهٔ آزمون میان‌ترم ریاضی من ۱۴ ثبت شده ولی به نظرم پاسخ سؤال ۳ درست بود. امکان بازبینی هست؟', 'academic'],
  ['مشکل در دریافت فایل تکلیف', 'فایل تکلیف علوم باز نمی‌شود و خطا می‌دهد. لطفاً دوباره بارگذاری کنید.', 'technical'],
  ['درخواست گواهی اشتغال به تحصیل', 'برای ثبت‌نام کلاس زبان به گواهی اشتغال به تحصیل نیاز دارم. چه زمانی می‌توانم دریافت کنم؟', 'admin'],
  ['پیشنهاد برگزاری اردوی علمی', 'با توجه به علاقهٔ بچه‌ها پیشنهاد می‌کنم اردوی بازدید از موزهٔ علوم برگزار شود.', 'suggestion'],
  ['غیبت اشتباه ثبت شده', 'روز یکشنبه در کلاس حاضر بودم اما غیبت برایم ثبت شده. لطفاً اصلاح کنید.', 'attendance'],
  ['درخواست تغییر سرویس مدرسه', 'به دلیل تغییر آدرس منزل، درخواست تغییر مسیر سرویس به مسیر شمال شهر را دارم.', 'admin'],
  ['سؤال دربارهٔ شهریه', 'امکان پرداخت قسطی شهریهٔ نوبت دوم وجود دارد؟', 'finance'],
  ['گزارش مشکل در کلاس', 'یکی از همکلاسی‌ها مرتباً مزاحم درس می‌شود. لطفاً رسیدگی شود.', 'discipline'],
  ['درخواست کلاس تقویتی', 'آیا برای درس عربی کلاس تقویتی برگزار می‌شود؟', 'academic'],
  ['عدم دسترسی به کارنامه', 'در پنل من کارنامهٔ نوبت اول نمایش داده نمی‌شود.', 'technical'],
  ['تشکر از معلم علوم', 'از زحمات معلم علوم بابت آزمایش‌های جذاب کلاس تشکر می‌کنم.', 'other']
];
const REPLIES_STAFF = ['با سلام، درخواست شما بررسی شد و اقدام لازم انجام خواهد شد.', 'سلام، ممنون از پیگیری شما. موضوع به همکار مربوطه ارجاع داده شد.', 'با سلام، مورد اصلاح شد. در صورت تداوم مشکل اطلاع دهید.', 'سلام، لطفاً فردا به دفتر مدرسه مراجعه کنید.', 'با سلام، پس از بررسی برگه، نمرهٔ شما اصلاح شد.'];
const REPLIES_STUDENT = ['ممنون از پاسخ‌گویی شما.', 'سپاسگزارم، مشکل حل شد.', 'باز هم همان خطا را می‌دهد.', 'چشم، حتماً مراجعه می‌کنم.'];
const ANNOUNCEMENTS = [
  ['برنامهٔ امتحانات میان‌نوبت اول', 'برنامهٔ امتحانات میان‌نوبت اول از تاریخ ۱۵ آبان آغاز می‌شود. جدول کامل در بخش تقویم و آزمون‌ها قابل مشاهده است. دانش‌آموزان عزیز لطفاً با آمادگی کامل در جلسات حاضر شوند.', 'all', 1],
  ['جلسهٔ انجمن اولیا و مربیان', 'جلسهٔ انجمن اولیا و مربیان روز چهارشنبه ساعت ۱۶ در سالن اجتماعات مدرسه برگزار می‌شود. حضور اولیای محترم موجب امتنان است.', 'all', 1],
  ['یادآوری: تحویل تکالیف تا پایان هفته', 'همکاران محترم، لطفاً نمرات تکالیف ثبت‌شده را تا پایان هفته در سامانه وارد کنند.', 'teachers', 0],
  ['برگزاری مسابقات ورزشی درون‌مدرسه‌ای', 'مسابقات فوتسال و والیبال بین کلاس‌ها از هفتهٔ آینده آغاز می‌شود. ثبت‌نام تیم‌ها نزد معلم تربیت بدنی.', 'students', 0],
  ['تعطیلی روز پنج‌شنبه', 'به اطلاع می‌رساند مدرسه روز پنج‌شنبه این هفته به مناسبت تعطیلی رسمی تعطیل است.', 'all', 0],
  ['اردوی علمی موزهٔ علوم', 'اردوی بازدید از موزهٔ علوم و فناوری برای پایهٔ هشتم برگزار می‌شود. فرم رضایت‌نامه را از معلم کلاس دریافت کنید.', 'students', 0],
  ['کارگاه آموزشی روش تدریس فعال', 'کارگاه «روش‌های تدریس فعال» ویژهٔ همکاران، پنج‌شنبه ساعت ۹ صبح در کتابخانه برگزار می‌شود.', 'teachers', 0],
  ['کتابخانه: کتاب‌های جدید رسید', 'بیش از ۳۰ عنوان کتاب جدید به کتابخانهٔ مدرسه اضافه شد. برای امانت به کتابخانه مراجعه کنید.', 'all', 0]
];
const HOMEWORK_TITLES = {
  MATH: ['حل تمرین‌های صفحهٔ ۲۴ تا ۲۶', 'کاربرگ اعداد صحیح', 'تمرین‌های فصل دوم (توان و جذر)', 'حل مسائل هندسه'],
  SCI: ['گزارش آزمایش اندازه‌گیری چگالی', 'خلاصهٔ فصل اول (اتم‌ها)', 'پژوهش دربارهٔ انرژی‌های تجدیدپذیر'],
  LIT: ['حفظ شعر درس سوم', 'نگارش: توصیف یک روز بارانی', 'معنی لغات درس چهارم'],
  SOC: ['نقشهٔ استان‌های ایران', 'تحقیق دربارهٔ قانون اساسی', 'خلاصهٔ درس ۵'],
  ARB: ['ترجمهٔ متن درس دوم', 'صرف فعل ماضی'],
  ENG: ['Workbook pages 10-12', 'Write about your family'],
  QRN: ['روخوانی صفحهٔ ۳۰ تا ۳۲', 'حفظ سورهٔ کوتاه'],
  REL: ['پاسخ به پرسش‌های درس ۳'],
  THK: ['نوشتن برنامهٔ هفتگی شخصی'],
  TEC: ['ساخت الگوریتم ساده با فلوچارت'],
  ART: ['طراحی با مداد: طبیعت بی‌جان'],
  PE: ['ثبت فعالیت بدنی روزانه']
};
const EXAM_TYPES = [['quiz', 'کوئیز'], ['midterm', 'میان‌ترم'], ['classwork', 'فعالیت کلاسی'], ['oral', 'پرسش شفاهی']];
const DISCIPLINE_NEG = [['تأخیر مکرر', -2], ['بی‌نظمی در کلاس', -3], ['عدم انجام تکلیف', -1], ['استفاده از موبایل', -3], ['غیبت غیرموجه', -2], ['درگیری با همکلاسی', -5]];
const DISCIPLINE_POS = [['کمک به همکلاسی', 3], ['مشارکت فعال در کلاس', 2], ['نظم و انضباط نمونه', 3], ['کسب رتبه در مسابقه', 5], ['حضور منظم', 2], ['مسئولیت‌پذیری', 3]];
const HEALTH = [['checkup', 'معاینهٔ دوره‌ای', 'معاینهٔ سالانه؛ قد و وزن ثبت شد', ''], ['injury', 'آسیب در زنگ ورزش', 'پیچ‌خوردگی خفیف مچ پا', 'کمپرس سرد و استراحت'], ['illness', 'سردرد و تب', 'تب ۳۸ درجه در کلاس', 'تماس با ولی و ارسال به منزل'], ['vaccine', 'واکسیناسیون', 'واکسن دوگانهٔ بزرگسالان', ''], ['allergy', 'واکنش آلرژیک', 'حساسیت پوستی خفیف', 'مصرف آنتی‌هیستامین با هماهنگی ولی']];
const COUNSEL = ['اضطراب امتحان', 'افت تحصیلی', 'مشکل در ارتباط با همکلاسی‌ها', 'برنامه‌ریزی درسی', 'انتخاب رشته', 'کاهش انگیزه', 'مدیریت زمان', 'مشکلات خانوادگی'];
const EVENTS = [
  ['آغاز سال تحصیلی', 'event', '07/01', '07/01', '#2563eb'], ['جلسهٔ انجمن اولیا و مربیان', 'meeting', '07/15', '07/15', '#7c3aed'], ['اردوی علمی موزهٔ علوم', 'trip', '07/23', '07/23', '#0891b2'],
  ['هفتهٔ کتاب و کتابخوانی', 'event', '08/24', '08/30', '#16a34a'], ['آزمون‌های میان‌نوبت اول', 'exam', '08/15', '08/22', '#dc2626'], ['شهادت حضرت فاطمه (س)', 'holiday', '09/04', '09/04', '#6b7280'],
  ['شب یلدا — جشن مدرسه', 'event', '09/30', '09/30', '#f59e0b'], ['امتحانات نوبت اول', 'exam', '10/15', '10/28', '#dc2626'], ['دههٔ فجر', 'event', '11/12', '11/22', '#16a34a'],
  ['تعطیلات نوروز', 'holiday', '01/01', '01/13', '#6b7280'], ['مسابقات ورزشی درون‌مدرسه‌ای', 'event', '07/20', '08/05', '#0891b2'], ['جلسهٔ شورای معلمان', 'meeting', '07/10', '07/10', '#7c3aed']
];
const CANNED = [['خوش‌آمدگویی', 'با سلام و احترام، پیام شما دریافت شد و در اسرع وقت بررسی می‌شود.'], ['مراجعه حضوری', 'با سلام، لطفاً برای پیگیری این موضوع در ساعات اداری به دفتر مدرسه مراجعه فرمایید.'], ['ارجاع به معلم', 'با سلام، درخواست شما به معلم مربوطه ارجاع شد و پاسخ از طریق همین تیکت اعلام می‌شود.'], ['بستن تیکت', 'با تشکر از پیگیری شما، این تیکت بسته می‌شود. در صورت نیاز می‌توانید تیکت جدید ثبت کنید.'], ['اصلاح شد', 'با سلام، مورد مطرح‌شده بررسی و اصلاح شد.']];
const ROUTES = [['مسیر ۱ — شمال شهر', 'اصغر رضایی', 'پراید وانت سفید — ۱۲ب۳۴۵', 14], ['مسیر ۲ — مرکز شهر', 'محمود نظری', 'ون دلیکا — ۴۵ج۶۷۸', 14], ['مسیر ۳ — غرب', 'کاظم طاهری', 'مینی‌بوس هیوندای — ۲۳د۴۵۶', 22], ['مسیر ۴ — شرق', 'ناصر حیدری', 'ون — ۸۹ه۱۲۳', 14], ['مسیر ۵ — جنوب', 'جواد سلطانی', 'مینی‌بوس — ۵۶و۷۸۹', 22]];
const NOTES = ['در درس ریاضی پیشرفت خوبی داشته است.', 'نیاز به تقویت در خواندن و نگارش دارد.', 'والدین در جلسهٔ مشاوره حضور یافتند و همکاری خوبی دارند.', 'در فعالیت‌های گروهی بسیار فعال است.', 'به دلیل تأخیرهای مکرر با ولی تماس گرفته شد.', 'استعداد ویژه در هنر و نقاشی دارد.', 'توصیه شد در کلاس تقویتی عربی شرکت کند.', 'رفتار بسیار محترمانه با معلمان و همکلاسی‌ها دارد.'];
const MESSAGES = [['برنامهٔ جلسهٔ شورای معلمان', 'همکاران گرامی، جلسهٔ شورای معلمان روز سه‌شنبه ساعت ۱۳ برگزار می‌شود.'], ['درخواست گزارش عملکرد کلاس', 'لطفاً گزارش وضعیت درسی کلاس خود را تا پایان هفته ارسال کنید.'], ['تشکر', 'از زحمات شما در برگزاری مراسم هفتهٔ گذشته صمیمانه سپاسگزارم.'], ['هماهنگی آزمون', 'آزمون میان‌ترم ریاضی پایهٔ هشتم را روز شنبه برگزار می‌کنم؛ لطفاً برنامهٔ خود را هماهنگ کنید.'], ['پیگیری دانش‌آموز', 'وضعیت درسی یکی از دانش‌آموزان کلاس شما نیاز به پیگیری دارد؛ لطفاً در فرصت مناسب صحبت کنیم.']];

// ---------- ابزارهای تاریخ ----------
function schoolDaysBack(count, endISO) {
  const days = [];
  let d = endISO;
  while (days.length < count) {
    if (SCHOOL_DAYS.includes(J.weekdayIndex(d))) days.unshift(d);
    d = J.addDays(d, -1);
  }
  return days;
}
function isoFromJalali(jy, mmdd) { return J.toGregorian(`${jy}/${mmdd}`); }

// ---------- اجرای اصلی ----------
async function run({ db, log, adminId, yearId, adminUsername }) {
  log = log || (() => {});
  const now = db.now();
  const today = J.todayISO();
  const ay = J.currentAcademicYear();
  const jy = ay.startYear;
  const passHash = await auth.hashPassword('123456');
  const demoDays = schoolDaysBack(45, today);
  const firstDemoDay = demoDays[0];

  const stats = {};
  await db.transaction(async (tx) => {
    const insert = async (table, row) => tx.insert(table, row);
    const insertMany = async (table, rows) => { for (const r of rows) await tx.insert(table, r); };
    /** ساخت کاربر؛ اگر نام کاربری قبلاً وجود داشت همان را برمی‌گرداند (اجرای مجدد seed) */
    const ensureUser = async (username, data) => { const ex = await tx.findOne('users', { username }); if (ex) return ex.id; return insert('users', Object.assign({ username }, data)); };

    // --- سال تحصیلی / نوبت‌ها ---
    let termRows = await tx.table('terms').where('academic_year_id', yearId).orderBy('number').all();
    if (!termRows.length) {
      await insertMany('terms', [
        { academic_year_id: yearId, title: 'نوبت اول', number: 1, start_date: ay.startDate, end_date: J.toGregorian(`${jy}/10/30`), is_current: 1, created_at: now },
        { academic_year_id: yearId, title: 'نوبت دوم', number: 2, start_date: J.toGregorian(`${jy}/11/01`), end_date: ay.endDate, is_current: 0, created_at: now }
      ]);
      termRows = await tx.table('terms').where('academic_year_id', yearId).orderBy('number').all();
    }
    const term1 = termRows[0].id;
    // سال گذشته (برای سابقه)
    const prevYearId = await insert('academic_years', { title: `${jy - 1}-${jy}`, start_date: J.toGregorian(`${jy - 1}/07/01`), end_date: J.toGregorian(`${jy}/06/31`), is_current: 0, created_at: now });

    // --- پایه‌ها، اتاق‌ها، درس‌ها ---
    const gradeIds = [];
    for (const g of GRADES) gradeIds.push(await insert('grade_levels', { title: g.title, stage: 'متوسطه اول', sort_order: g.sort, grading_type: 'numeric', created_at: now }));
    const roomIds = [];
    for (let i = 1; i <= 12; i++) roomIds.push(await insert('rooms', { title: i <= 10 ? `کلاس ${J.toPersianDigits(100 + i)}` : i === 11 ? 'آزمایشگاه علوم' : 'سایت رایانه', capacity: i <= 10 ? 30 : 24, floor: i <= 5 ? 1 : 2, type: i <= 10 ? 'class' : i === 11 ? 'lab' : 'computer', equipment: i <= 10 ? 'تخته هوشمند، ویدئو پروژکتور' : 'تجهیزات تخصصی', created_at: now }));
    const subjectIds = {}; // grade -> code -> id
    for (let g = 0; g < GRADES.length; g++) {
      subjectIds[g] = {};
      for (const s of SUBJECTS) subjectIds[g][s.code] = await insert('subjects', { title: s.title, code: `${s.code}${7 + g}`, grade_level_id: gradeIds[g], weekly_hours: s.hours, is_active: 1, created_at: now });
    }
    stats.subjects = GRADES.length * SUBJECTS.length;

    // --- معلمان ---
    const teacherIds = []; const teacherUserIds = [];
    for (let i = 0; i < TEACHERS.length; i++) {
      const t = TEACHERS[i];
      const uid = await ensureUser(`teacher${i + 1}`, { password: passHash, role: 'teacher', name: t.name, email: `teacher${i + 1}@school.test`, phone: mobile(), status: 'active', must_change_password: 0, login_count: ri(3, 60), last_login_at: J.addDays(today, -ri(0, 5)) + ' 08:1' + ri(0, 9) + ':00', created_at: now });
      const exT = await tx.findOne('teachers', { user_id: uid });
      const tid = exT ? exT.id : await insert('teachers', { user_id: uid, personnel_code: String(1001 + i), national_id: nationalId(), birth_date: J.toGregorian(`${ri(1350, 1372)}/${ri(1, 12)}/${ri(1, 29)}`), gender: t.gender, education: t.edu, field: t.field, hire_date: J.toGregorian(`${ri(1385, 1402)}/07/01`), employment_type: pick(['رسمی', 'رسمی', 'پیمانی', 'حق‌التدریس']), address: `${pick(CITIES)}، ${pick(STREETS)}، پلاک ${ri(1, 120)}`, bio: `دبیر ${t.field} با ${ri(5, 25)} سال سابقهٔ تدریس`, status: 'active', created_at: now });
      teacherIds.push(tid); teacherUserIds.push(uid);
    }
    await insert('canned_responses', { user_id: adminId, title: CANNED[0][0], body: CANNED[0][1], created_at: now });
    for (const c of CANNED.slice(1)) await insert('canned_responses', { user_id: adminId, title: c[0], body: c[1], created_at: now });
    stats.teachers = TEACHERS.length;

    // --- کارمند دفتر ---
    const staffUid = await ensureUser('staff1', { password: passHash, role: 'staff', name: 'معصومه نیکنام', phone: mobile(), status: 'active', created_at: now });
    { // سمت «معاون آموزشی» برای کارمند نمونه (سمت‌های پیش‌فرض اگر هنوز ساخته نشده‌اند، ایجاد می‌شوند)
      const perms = require('../../src/core/permissions');
      if (!(await tx.table('positions').exists())) for (const p of perms.DEFAULT_POSITIONS) await tx.insert('positions', { title: p.title, description: p.description, permissions: JSON.stringify(p.permissions), is_system: 1, created_at: now, updated_at: now });
      const pos = await tx.findOne('positions', { title: 'معاون آموزشی' });
      if (pos) await tx.update('users', { position_id: pos.id }, { id: staffUid });
      // کارمند دوم: دفتردار و مسئول ثبت‌نام (برای پذیرش و گواهی‌ها)
      const clerkUid = await ensureUser('staff2', { password: passHash, role: 'staff', name: 'سمیه رستگار', phone: mobile(), status: 'active', created_at: now });
      const pos2 = await tx.findOne('positions', { title: 'دفتردار و مسئول ثبت‌نام' });
      if (pos2) await tx.update('users', { position_id: pos2.id }, { id: clerkUid });
    }

    // --- مسیرهای سرویس ---
    const routeIds = [];
    for (const r of ROUTES) routeIds.push(await insert('transport_routes', { title: r[0], driver_name: r[1], driver_phone: mobile(), vehicle: r[2].split(' — ')[0], plate: r[2].split(' — ')[1], capacity: r[3], fee: 1800000, path_description: 'حرکت از میدان اصلی، توقف در ایستگاه‌های مسیر', departure_time: '07:00', is_active: 1, created_at: now }));

    // --- کلاس‌ها ---
    const classIds = [];
    const homeroom = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]; // معلم راهنمای کلاس i = معلم i
    for (let i = 0; i < CLASSES.length; i++) {
      const c = CLASSES[i];
      classIds.push(await insert('classes', { academic_year_id: yearId, grade_level_id: gradeIds[c.grade], title: c.title, teacher_id: teacherIds[homeroom[i]], room_id: roomIds[i], capacity: 30, shift: 'morning', is_active: 1, created_at: now }));
    }
    stats.classes = CLASSES.length;

    // --- درس‌های کلاس (class_subjects) ---
    const csByClass = {}; // classIdx -> [{id, code, teacherIdx, hours, subjectId}]
    const teacherForSubject = (classIdx, code) => {
      const sub = SUBJECTS.find((s) => s.code === code);
      if (code === 'THK') return 11;
      if (code === 'TEC' || code === 'ART') return 12;
      const t = TEACHERS.findIndex((tt) => tt.field === sub.field && tt.classes.includes(classIdx));
      return t === -1 ? TEACHERS.findIndex((tt) => tt.field === sub.field) : t;
    };
    for (let ci = 0; ci < CLASSES.length; ci++) {
      csByClass[ci] = [];
      const g = CLASSES[ci].grade;
      for (const s of SUBJECTS) {
        const ti = teacherForSubject(ci, s.code);
        const id = await insert('class_subjects', { class_id: classIds[ci], subject_id: subjectIds[g][s.code], teacher_id: teacherIds[ti], weekly_hours: s.hours, created_at: now });
        csByClass[ci].push({ id, code: s.code, title: s.title, teacherIdx: ti, hours: s.hours, subjectId: subjectIds[g][s.code] });
      }
    }

    // --- برنامهٔ هفتگی (حریصانه، بدون تداخل معلم) ---
    const busy = {}; // teacherIdx -> Set('d-p')
    const slotRows = []; // برای دفتر کلاسی
    let slotCount = 0;
    for (let ci = 0; ci < CLASSES.length; ci++) {
      const need = []; // لیست درس‌ها به تعداد ساعت
      for (const cs of csByClass[ci]) for (let h = 0; h < cs.hours; h++) need.push(cs);
      const ordered = shuffle(need).sort((a, b) => b.hours - a.hours); // درس‌های پرساعت زودتر
      const cells = []; for (const d of SCHOOL_DAYS) for (let p = 1; p <= PERIOD_TIMES.length; p++) cells.push([d, p]);
      const used = new Set();
      const perDay = {}; // 'ci-d-code' -> count
      for (const cs of ordered) {
        let placed = false;
        for (const [d, p] of shuffle(cells)) {
          const key = `${d}-${p}`;
          if (used.has(key)) continue;
          if ((perDay[`${d}-${cs.code}`] || 0) >= (cs.hours >= 3 ? 2 : 1)) continue;
          busy[cs.teacherIdx] = busy[cs.teacherIdx] || new Set();
          if (busy[cs.teacherIdx].has(key)) continue;
          used.add(key); busy[cs.teacherIdx].add(key); perDay[`${d}-${cs.code}`] = (perDay[`${d}-${cs.code}`] || 0) + 1;
          const [st, en] = PERIOD_TIMES[p - 1].split('-');
          await insert('schedule_slots', { class_id: classIds[ci], class_subject_id: cs.id, day_of_week: d, period: p, start_time: st, end_time: en, room_id: cs.code === 'SCI' && chance(0.5) ? roomIds[10] : cs.code === 'TEC' ? roomIds[11] : roomIds[ci], created_at: now });
          slotRows.push({ ci, cs, d, p }); slotCount++; placed = true; break;
        }
        if (!placed) { /* ظرفیت پر — نادیده */ }
      }
    }
    stats.slots = slotCount;

    // --- دانش‌آموزان ---
    const students = []; // {id, uid, classIdx, ability, gender}
    let num = 40001;
    const usedNid = new Set();
    for (let ci = 0; ci < CLASSES.length; ci++) {
      const count = 20;
      const g = CLASSES[ci].grade;
      for (let k = 0; k < count; k++) {
        const gender = chance(0.5) ? 'male' : 'female';
        const first = gender === 'male' ? pick(MALE) : pick(FEMALE);
        const last = pick(LAST);
        const birthYear = jy - 13 - g; // هفتم ≈ ۱۳ سال
        const fatherFirst = pick(['محمد', 'علی', 'حسین', 'رضا', 'احمد', 'مهدی', 'حسن', 'مجید', 'سعید', 'جواد', 'مصطفی', 'ناصر', 'کاظم', 'امیر', 'بهروز', 'فرهاد']);
        const motherFirst = pick(['فاطمه', 'زهرا', 'مریم', 'معصومه', 'لیلا', 'سمیه', 'نرگس', 'الهام', 'سارا', 'مینا', 'زینب', 'شهلا', 'پروین', 'افسانه']);
        let nid; do { nid = nationalId(); } while (usedNid.has(nid)); usedNid.add(nid);
        const city = pick(CITIES);
        const hasMedical = chance(0.25);
        const routeId = chance(0.3) ? pick(routeIds) : null;
        const ability = Math.max(-2, Math.min(2, gauss())); // توانایی تحصیلی
        const sn = String(num++);
        const uid = await ensureUser(sn, { password: passHash, role: 'student', name: `${first} ${last}`, phone: null, status: 'active', must_change_password: 0, login_count: ri(0, 40), last_login_at: chance(0.7) ? J.addDays(today, -ri(0, 10)) + ' 1' + ri(2, 9) + ':0' + ri(0, 9) + ':00' : null, created_at: now });
        const sid = await insert('students', {
          user_id: uid, student_number: sn, national_id: nid, first_name: first, last_name: last,
          birth_date: J.toGregorian(`${birthYear}/${ri(1, 12)}/${ri(1, 29)}`), birth_place: city, gender, class_id: classIds[ci], grade_level_id: gradeIds[g],
          enrollment_date: g === 0 ? ay.startDate : J.toGregorian(`${jy - g}/06/${ri(10, 30)}`), status: 'active', nationality: 'ایرانی', religion: 'اسلام',
          address: `${city}، ${pick(STREETS)}، کوچه ${pick(['گلها', 'بهار', 'لاله', 'نسترن', 'یاس', 'شقایق', 'بنفشه'])}، پلاک ${ri(1, 150)}، واحد ${ri(1, 12)}`, postal_code: digits(10),
          home_phone: '0' + ri(21, 89) + digits(8), mobile: chance(0.6) ? mobile() : null, email: chance(0.3) ? `${sn}@student.test` : null,
          father_name: `${fatherFirst} ${last}`, father_national_id: nationalId(), father_phone: mobile(), father_job: pick(FATHER_JOBS), father_education: pick(EDUS),
          mother_name: `${motherFirst} ${pick(LAST)}`, mother_national_id: nationalId(), mother_phone: mobile(), mother_job: pick(MOTHER_JOBS), mother_education: pick(EDUS),
          guardian_type: chance(0.9) ? 'father' : chance(0.6) ? 'mother' : 'other', guardian_name: null, guardian_phone: null, guardian_relation: null,
          emergency_name: `${pick(['عمو', 'دایی', 'خاله', 'عمه', 'پدربزرگ'])} — ${pick(MALE.concat(FEMALE))} ${last}`, emergency_phone: mobile(), emergency_relation: pick(['عمو', 'دایی', 'خاله', 'عمه', 'پدربزرگ']),
          blood_type: pick(BLOOD), height: ri(140, 175), weight: ri(35, 70), allergies: hasMedical && chance(0.5) ? pick(ALLERGIES) : null, medical_conditions: hasMedical && chance(0.5) ? pick(CONDITIONS) : null, medications: hasMedical && chance(0.3) ? 'طبق تجویز پزشک' : null,
          insurance_number: chance(0.8) ? digits(10) : null, special_needs: chance(0.03) ? 'نیاز به نشستن در ردیف جلو' : null, previous_school: g === 0 ? pick(['دبستان شهید بهشتی', 'دبستان امام رضا (ع)', 'دبستان فرهنگ', 'دبستان سعدی', 'دبستان نور']) : null,
          transport_route_id: routeId, notes: null, created_at: now
        });
        students.push({ id: sid, uid, classIdx: ci, ability, gender, name: `${first} ${last}`, routeId, sn, fatherName: `${fatherFirst} ${last}`, motherName: `${motherFirst} ${pick(LAST)}` });
      }
    }
    stats.students = students.length;
    // چند خواهر/برادر (کد ملی پدر مشترک)
    for (let i = 0; i < 4; i++) {
      const a = pick(students), b = pick(students);
      if (a.id !== b.id) { const row = await tx.findById('students', a.id); await tx.update('students', { father_national_id: row.father_national_id, father_name: row.father_name, father_phone: row.father_phone, last_name: row.last_name, address: row.address, home_phone: row.home_phone }, { id: b.id }); }
    }
    // چند وضعیت غیرفعال
    const inactive = shuffle(students).slice(0, 5);
    await tx.update('students', { status: 'transferred' }, { id: inactive[0].id });
    await tx.update('students', { status: 'transferred' }, { id: inactive[1].id });
    await tx.update('students', { status: 'dropped' }, { id: inactive[2].id });
    await tx.update('students', { status: 'suspended' }, { id: inactive[3].id });
    for (const s of inactive.slice(0, 4)) { s.inactive = true; await tx.update('users', { status: 'inactive' }, { id: s.uid }); }
    const active = students.filter((s) => !s.inactive);
    // --- حساب‌های اولیا (برای ۴۰ دانش‌آموز اول؛ نام کاربری = موبایل پدر، رمز ۱۲۳۴۵۶) ---
    {
      let parentCount = 0;
      const usedPhones = new Set();
      for (const st of active.slice(0, 40)) {
        const full = await tx.findOne('students', { id: st.id });
        if (!full) continue;
        let phone = full.father_phone; if (!phone || usedPhones.has(phone)) { phone = mobile(); while (usedPhones.has(phone)) phone = mobile(); await tx.update('students', { father_phone: phone }, { id: st.id }); }
        usedPhones.add(phone);
        const puid = await ensureUser(phone, { password: passHash, role: 'parent', name: full.father_name, phone, status: 'active', must_change_password: 0, created_at: now });
        const pid = await insert('parents', { user_id: puid, name: full.father_name, national_id: full.father_national_id, phone, relation: 'father', job: full.father_job, education: full.father_education, address: full.address, created_at: now, updated_at: now });
        await insert('student_parents', { student_id: st.id, parent_id: pid, relation: 'father', is_primary: 1, created_at: now });
        parentCount++;
        if (parentCount <= 6 && full.mother_phone && !usedPhones.has(full.mother_phone)) { // چند مادر هم حساب دارند
          usedPhones.add(full.mother_phone);
          const muid = await ensureUser(full.mother_phone, { password: passHash, role: 'parent', name: full.mother_name, phone: full.mother_phone, status: 'active', must_change_password: 0, created_at: now });
          const mid = await insert('parents', { user_id: muid, name: full.mother_name, national_id: full.mother_national_id, phone: full.mother_phone, relation: 'mother', job: full.mother_job, education: full.mother_education, address: full.address, created_at: now, updated_at: now });
          await insert('student_parents', { student_id: st.id, parent_id: mid, relation: 'mother', is_primary: 0, created_at: now });
          parentCount++;
        }
      }
      // یک ولی با دو فرزند (دانش‌آموزان ۱ و ۲ هم‌خانواده فرض می‌شوند)
      if (active.length > 1) { const p1 = await tx.table('student_parents as sp').join('parents as p', 'p.id', 'sp.parent_id').select('p.id as pid').where('sp.student_id', active[0].id).where('sp.relation', 'father').first(); if (p1 && !(await tx.table('student_parents').where({ student_id: active[1].id, parent_id: p1.pid }).exists())) await insert('student_parents', { student_id: active[1].id, parent_id: p1.pid, relation: 'guardian', is_primary: 0, created_at: now }); }
      stats.parents = parentCount;
      const firstParent = await tx.findOne('students', { id: active[0].id });
      stats.demoParent = firstParent ? firstParent.father_phone : null;
    }
    // --- سوابق تحصیلی (سال به سال): ردیف فعال سال جاری برای همه + سابقهٔ سال گذشته برای پایه‌های هشتم و نهم ---
    {
      const yearRow = await tx.findById('academic_years', yearId);
      const prevStart = J.toGregorian(`${jy - 1}/07/01`), prevEnd = J.toGregorian(`${jy}/06/31`);
      let enrollCount = 0;
      for (const st of students) {
        const cls = CLASSES[st.classIdx]; const g = cls.grade;
        const status = st.inactive ? (await tx.findById('students', st.id)).status : 'active';
        const enrollStatus = status === 'active' ? 'active' : status === 'transferred' ? 'transferred' : status === 'dropped' ? 'dropped' : 'active';
        await tx.insert('enrollments', { student_id: st.id, academic_year_id: yearId, class_id: classIds[st.classIdx], class_title: cls.title, grade_level_id: gradeIds[g], grade_title: GRADES[g].title, status: enrollStatus, enrolled_at: yearRow ? yearRow.start_date : now, left_at: enrollStatus === 'active' ? null : J.addDays(J.todayISO(), -ri(5, 30)), note: enrollStatus === 'active' ? null : 'ثبت در پروندهٔ دانش‌آموز', created_at: now, updated_at: now });
        enrollCount++;
        if (g > 0) {
          // سال گذشته در پایهٔ پایین‌تر (چند نفر تکرار پایه)
          const retained = chance(0.03);
          const pg = retained ? g : g - 1;
          const prevTitle = cls.title.replace(GRADES[g].title, GRADES[pg].title);
          await tx.insert('enrollments', { student_id: st.id, academic_year_id: prevYearId, class_id: null, class_title: prevTitle, grade_level_id: gradeIds[pg], grade_title: GRADES[pg].title, status: retained ? 'retained' : 'promoted', enrolled_at: prevStart, left_at: prevEnd, note: retained ? 'تکرار پایه — پایان سال ' + (jy - 1) + '-' + jy : 'ارتقا — پایان سال ' + (jy - 1) + '-' + jy, created_at: now, updated_at: now });
          enrollCount++;
        }
      }
      stats.enrollments = enrollCount;
    }
    // انتقال بین کلاس‌ها
    for (let i = 0; i < 5; i++) {
      const s = pick(active); const from = pick(classIds.filter((c) => c !== classIds[s.classIdx]));
      await insert('student_transfers', { student_id: s.id, from_class_id: from, to_class_id: classIds[s.classIdx], reason: pick(['درخواست ولی', 'تعادل تعداد دانش‌آموزان', 'تغییر شیفت']), transferred_by: adminId, created_at: J.addDays(today, -ri(5, 40)) + ' 10:00:00' });
    }
    // یادداشت‌ها
    for (let i = 0; i < 45; i++) {
      const s = pick(active);
      await insert('student_notes', { student_id: s.id, author_id: chance(0.5) ? adminId : teacherUserIds[homeroom[s.classIdx]], content: pick(NOTES), type: pick(['general', 'academic', 'behavior', 'parent']), is_private: chance(0.4) ? 1 : 0, created_at: J.addDays(today, -ri(0, 45)) + ' ' + pad(ri(8, 14), 2) + ':' + pad(ri(0, 59), 2) + ':00' });
    }

    // --- حضور و غیاب (۴۵ روز مدرسه) ---
    let attCount = 0, absentTotal = 0;
    const absentByStudent = {};
    const lateProne = new Set(shuffle(active).slice(0, 15).map((s) => s.id));
    const absentProne = new Set(shuffle(active).slice(0, 12).map((s) => s.id));
    const absentRows = []; // برای عذرها
    for (const date of demoDays) {
      const isToday = date === today;
      for (let ci = 0; ci < CLASSES.length; ci++) {
        if (isToday && ci >= 7) continue; // امروز برخی کلاس‌ها هنوز ثبت نشده‌اند
        const recorder = teacherUserIds[homeroom[ci]];
        for (const s of active.filter((x) => x.classIdx === ci)) {
          let status = 'present', minutes = null, note = null;
          const pAbs = absentProne.has(s.id) ? 0.18 : 0.035;
          const pLate = lateProne.has(s.id) ? 0.2 : 0.03;
          const r = rnd();
          if (r < pAbs) { status = chance(0.3) ? 'excused' : 'absent'; if (status === 'excused') note = pick(['گواهی پزشک', 'با هماهنگی ولی', 'مسافرت خانوادگی']); }
          else if (r < pAbs + pLate) { status = 'late'; minutes = pick([5, 10, 10, 15, 20, 30]); }
          else if (r < pAbs + pLate + 0.01) { status = 'leave'; note = 'خروج زودهنگام با اجازهٔ دفتر'; }
          const id = await insert('attendance', { date, class_id: classIds[ci], student_id: s.id, class_subject_id: null, period: null, session_key: 'daily', status, minutes_late: minutes, note, recorded_by: recorder, created_at: date + ' 08:05:00' });
          attCount++;
          if (status === 'absent') { absentTotal++; absentByStudent[s.id] = (absentByStudent[s.id] || 0) + 1; absentRows.push({ id, sid: s.id, date, classIdx: ci }); }
        }
      }
      // حضور و غیاب زنگ‌به‌زنگ برای دو کلاس در روزهای اخیر
      if (J.diffDays(date, today) <= 10) {
        for (const ci of [0, 7]) {
          const sessions = csByClass[ci].slice(0, 2);
          for (const cs of sessions) {
            for (const s of active.filter((x) => x.classIdx === ci)) {
              const st = chance(0.05) ? 'absent' : chance(0.04) ? 'late' : 'present';
              await insert('attendance', { date, class_id: classIds[ci], student_id: s.id, class_subject_id: cs.id, period: 1, session_key: 'cs:' + cs.id, status: st, minutes_late: st === 'late' ? 10 : null, note: null, recorded_by: teacherUserIds[cs.teacherIdx], created_at: date + ' 09:00:00' });
              attCount++;
            }
          }
        }
      }
    }
    stats.attendance = attCount;
    // عذرهای غیبت
    const excuseRows = shuffle(absentRows).slice(0, 14);
    for (let i = 0; i < excuseRows.length; i++) {
      const a = excuseRows[i];
      const status = i < 5 ? 'pending' : i < 11 ? 'approved' : 'rejected';
      await insert('absence_excuses', { student_id: a.sid, date: a.date, attendance_id: a.id, reason: pick(['بیماری و مراجعه به پزشک — گواهی پیوست است', 'فوت یکی از بستگان', 'مسافرت ضروری خانوادگی', 'مراجعه به درمانگاه برای واکسیناسیون', 'مشکل سرویس مدرسه']), file_path: null, status, reviewed_by: status === 'pending' ? null : adminId, reviewed_at: status === 'pending' ? null : J.addDays(a.date, 1) + ' 11:30:00', review_note: status === 'rejected' ? 'مدرک معتبر ارائه نشده است' : null, created_at: a.date + ' 18:00:00' });
      if (status === 'approved') await tx.update('attendance', { status: 'excused', note: 'موجه‌شده با تأیید مدیر' }, { id: a.id });
    }
    // حضور کارکنان (۲۰ روز اخیر)
    for (const date of demoDays.slice(-20)) {
      for (const uid of teacherUserIds.concat([staffUid])) {
        const r = rnd(); const st = r < 0.04 ? 'absent' : r < 0.1 ? 'late' : r < 0.13 ? 'leave' : r < 0.15 ? 'mission' : 'present';
        await insert('staff_attendance', { user_id: uid, date, status: st, check_in: st === 'present' ? '07:' + pad(ri(15, 40), 2) : st === 'late' ? '08:' + pad(ri(0, 30), 2) : null, check_out: ['present', 'late'].includes(st) ? '13:' + pad(ri(0, 30), 2) : null, note: null, recorded_by: adminId, created_at: date + ' 07:50:00' });
      }
    }
    // درخواست مرخصی
    for (let i = 0; i < 10; i++) {
      const from = J.addDays(today, ri(-30, 10));
      await insert('leave_requests', { user_id: pick(teacherUserIds), type: pick(['استحقاقی', 'استعلاجی', 'ساعتی', 'بدون حقوق']), from_date: from, to_date: J.addDays(from, ri(0, 2)), hours: chance(0.3) ? ri(1, 4) : null, reason: pick(['امور شخصی', 'بیماری', 'مراجعه به پزشک', 'سفر خانوادگی', 'شرکت در دورهٔ آموزشی']), status: i < 3 ? 'pending' : i < 8 ? 'approved' : 'rejected', reviewed_by: i < 3 ? null : adminId, reviewed_at: i < 3 ? null : now, created_at: J.addDays(from, -ri(1, 5)) + ' 09:00:00' });
    }

    // --- آزمون‌ها و نمرات ---
    let examCount = 0, gradeCount = 0;
    const studentScores = {}; // sid -> [scores]
    for (let ci = 0; ci < CLASSES.length; ci++) {
      const cls = active.filter((x) => x.classIdx === ci);
      for (const cs of csByClass[ci]) {
        const nExams = cs.hours >= 3 ? 3 : cs.hours === 2 ? 2 : 1;
        for (let e = 0; e < nExams; e++) {
          const type = e === nExams - 1 && cs.hours >= 2 ? EXAM_TYPES[1] : pick([EXAM_TYPES[0], EXAM_TYPES[2], EXAM_TYPES[3]]);
          const date = pick(demoDays.slice(5, -2));
          const max = type[0] === 'midterm' ? 20 : pick([5, 10, 20]);
          const published = J.diffDays(date, today) > 3 || chance(0.5);
          const examId = await insert('exams', { class_id: classIds[ci], subject_id: cs.subjectId, class_subject_id: cs.id, term_id: term1, title: `${type[1]} ${cs.title}${e > 0 ? ' ' + J.toPersianDigits(e + 1) : ''}`, type: type[0], date, start_time: null, max_score: max, weight: type[0] === 'midterm' ? 2 : 1, description: null, created_by: teacherUserIds[cs.teacherIdx], is_published: published ? 1 : 0, created_at: J.addDays(date, -3) + ' 10:00:00' });
          examCount++;
          for (const s of cls) {
            if (chance(0.03)) continue; // غایب در آزمون
            let ratio = 0.72 + s.ability * 0.1 + gauss() * 0.1;
            ratio = Math.max(0.15, Math.min(1, ratio));
            const score = Math.round(ratio * max * 4) / 4;
            await insert('grades', { exam_id: examId, student_id: s.id, score, descriptive: null, note: null, graded_by: teacherUserIds[cs.teacherIdx], created_at: J.addDays(date, 1) + ' 12:00:00' });
            gradeCount++;
            (studentScores[s.id] = studentScores[s.id] || []).push(score / max * 20);
          }
        }
      }
      // آزمون آینده
      const cs = csByClass[ci][ri(0, 3)];
      await insert('exams', { class_id: classIds[ci], subject_id: cs.subjectId, class_subject_id: cs.id, term_id: term1, title: `آزمون کتبی ${cs.title}`, type: 'written', date: J.addDays(today, ri(2, 12)), start_time: '08:00', max_score: 20, weight: 2, description: 'از ابتدای کتاب تا پایان فصل ۳', created_by: teacherUserIds[cs.teacherIdx], is_published: 0, created_at: now });
      examCount++;
    }
    stats.exams = examCount; stats.grades = gradeCount;
    // نظر معلم در کارنامه
    for (const s of shuffle(active).slice(0, 40)) {
      const avg = (studentScores[s.id] || [12]).reduce((a, b) => a + b, 0) / ((studentScores[s.id] || [12]).length);
      await insert('term_remarks', { student_id: s.id, term_id: term1, remark: avg >= 17 ? 'عملکرد بسیار عالی؛ ادامه دهید.' : avg >= 14 ? 'عملکرد خوب؛ با تلاش بیشتر می‌توانید به سطح عالی برسید.' : 'نیاز به تلاش و برنامه‌ریزی بیشتر دارید. با معلمان خود مشورت کنید.', author_id: teacherUserIds[homeroom[s.classIdx]], created_at: now });
    }

    // --- تکالیف و محتوا ---
    let hwCount = 0, subCount = 0;
    for (let ci = 0; ci < CLASSES.length; ci++) {
      const cls = active.filter((x) => x.classIdx === ci);
      for (const cs of csByClass[ci]) {
        const titles = HOMEWORK_TITLES[cs.code] || ['تکلیف هفتگی'];
        const n = cs.hours >= 3 ? 2 : 1;
        for (let h = 0; h < n; h++) {
          const created = pick(demoDays.slice(0, -1));
          const due = J.addDays(created, ri(4, 10));
          const hwId = await insert('homework', { class_id: classIds[ci], class_subject_id: cs.id, subject_id: cs.subjectId, title: titles[h % titles.length], description: 'لطفاً تکلیف را با دقت انجام داده و تا موعد مقرر ارسال کنید. در صورت ابهام از طریق تیکت سؤال بپرسید.', due_date: due, file_path: null, file_name: null, max_score: 20, allow_submission: 1, created_by: teacherUserIds[cs.teacherIdx], created_at: created + ' 13:00:00' });
          hwCount++;
          const past = J.diffDays(due, today) >= 0;
          for (const s of cls) {
            const p = past ? 0.75 : 0.35;
            if (!chance(p + s.ability * 0.08)) continue;
            const submitted = J.addDays(due, -ri(0, 4));
            const graded = past && chance(0.7);
            const score = graded ? Math.max(5, Math.min(20, Math.round((14 + s.ability * 2 + gauss() * 2) * 2) / 2)) : null;
            await insert('homework_submissions', { homework_id: hwId, student_id: s.id, content: pick(['تکلیف انجام شد. فایل پیوست است.', 'پاسخ‌ها را در دفتر نوشتم و عکس گرفتم.', 'تمرین‌ها حل شد؛ سؤال ۴ را متوجه نشدم.', 'انجام شد.']), file_path: null, file_name: null, score, feedback: graded ? pick(['آفرین، عالی بود.', 'خوب بود؛ به نکات نگارشی توجه کنید.', 'سؤال ۳ اشتباه حل شده است.', 'کامل و منظم. ممنون.']) : null, status: graded ? 'graded' : 'submitted', submitted_at: submitted + ' 19:' + pad(ri(0, 59), 2) + ':00', graded_at: graded ? J.addDays(due, 1) + ' 10:00:00' : null, graded_by: graded ? teacherUserIds[cs.teacherIdx] : null });
            subCount++;
          }
        }
      }
      // محتوای آموزشی
      for (const cs of csByClass[ci].slice(0, 3)) {
        await insert('materials', { class_id: classIds[ci], class_subject_id: cs.id, subject_id: cs.subjectId, title: `جزوهٔ ${cs.title} — فصل ${J.toPersianDigits(ri(1, 3))}`, description: 'خلاصهٔ درس و نکات مهم برای آمادگی آزمون', file_path: null, file_name: null, link: 'https://example.com/material', created_by: teacherUserIds[cs.teacherIdx], created_at: J.addDays(today, -ri(1, 30)) + ' 12:00:00' });
      }
    }
    stats.homework = hwCount; stats.submissions = subCount;

    // --- تیکت‌ها ---
    let tkCount = 0;
    for (let i = 0; i < 40; i++) {
      // سه تیکت اول برای دانش‌آموز نمونه (۴۰۰۰۱) تا پنل دمو خالی نباشد
      const s = i < 3 ? active[0] : pick(active);
      const topic = TICKET_TOPICS[i % TICKET_TOPICS.length];
      const toTeacher = i === 1 ? true : i < 3 ? false : chance(0.4);
      const assigned = toTeacher ? teacherUserIds[homeroom[s.classIdx]] : adminId;
      const created = J.addDays(today, -ri(0, 40));
      const statusR = rnd();
      const status = statusR < 0.25 ? 'open' : statusR < 0.5 ? 'answered' : statusR < 0.6 ? 'pending' : 'closed';
      const code = 'TK-' + pad(10231 + i * 7, 5);
      const tid = await insert('tickets', { code, subject: topic[0], department: toTeacher ? 'teacher' : 'admin', created_by: s.uid, student_id: s.id, assigned_to: assigned, class_id: classIds[s.classIdx], category: topic[2], priority: pick(['low', 'normal', 'normal', 'normal', 'high', 'urgent']), status, last_reply_at: created + ' 10:00:00', last_reply_by: s.uid, closed_at: status === 'closed' ? J.addDays(created, 2) + ' 12:00:00' : null, rating: status === 'closed' && chance(0.7) ? ri(3, 5) : null, created_at: created + ' 09:' + pad(ri(0, 59), 2) + ':00', updated_at: now });
      await insert('ticket_replies', { ticket_id: tid, user_id: s.uid, message: topic[1], is_internal: 0, created_at: created + ' 09:' + pad(ri(0, 59), 2) + ':00' });
      if (status !== 'open') {
        const t1 = J.addDays(created, 1) + ' 10:' + pad(ri(0, 59), 2) + ':00';
        await insert('ticket_replies', { ticket_id: tid, user_id: assigned, message: pick(REPLIES_STAFF), is_internal: 0, created_at: t1 });
        if (chance(0.3)) await insert('ticket_replies', { ticket_id: tid, user_id: adminId, message: 'یادداشت داخلی: با معلم مربوطه هماهنگ شود.', is_internal: 1, created_at: t1 });
        await tx.update('tickets', { last_reply_at: t1, last_reply_by: assigned }, { id: tid });
        if (status === 'pending' || (status === 'closed' && chance(0.5))) {
          const t2 = J.addDays(created, 1) + ' 18:' + pad(ri(0, 59), 2) + ':00';
          await insert('ticket_replies', { ticket_id: tid, user_id: s.uid, message: pick(REPLIES_STUDENT), is_internal: 0, created_at: t2 });
          await tx.update('tickets', { last_reply_at: t2, last_reply_by: s.uid }, { id: tid });
        }
      }
      tkCount++;
    }
    // چند تیکت از معلمان به مدیر
    for (let i = 0; i < 5; i++) {
      const tu = pick(teacherUserIds);
      const created = J.addDays(today, -ri(0, 20));
      const tid = await insert('tickets', { code: 'TK-' + pad(10600 + i * 3, 5), subject: pick(['درخواست ویدئو پروژکتور برای کلاس', 'نیاز به تعمیر تخته هوشمند', 'درخواست برگزاری کلاس جبرانی', 'گزارش وضعیت کلاس', 'درخواست مرخصی ساعتی']), department: 'admin', created_by: tu, student_id: null, assigned_to: adminId, class_id: null, category: 'admin', priority: 'normal', status: pick(['open', 'answered', 'closed']), last_reply_at: created + ' 11:00:00', last_reply_by: tu, created_at: created + ' 11:00:00', updated_at: now });
      await insert('ticket_replies', { ticket_id: tid, user_id: tu, message: 'با سلام و احترام، خواهشمند است در این خصوص اقدام لازم صورت گیرد. با تشکر.', is_internal: 0, created_at: created + ' 11:00:00' });
      tkCount++;
    }
    stats.tickets = tkCount;

    // --- پیام‌ها ---
    for (let i = 0; i < 30; i++) {
      const m = pick(MESSAGES);
      const fromAdmin = chance(0.6);
      const sender = fromAdmin ? adminId : pick(teacherUserIds);
      let receiver = fromAdmin ? pick(teacherUserIds) : adminId;
      if (chance(0.2)) receiver = pick(students).uid;
      const created = J.addDays(today, -ri(0, 30)) + ' ' + pad(ri(7, 20), 2) + ':' + pad(ri(0, 59), 2) + ':00';
      const read = chance(0.6);
      await insert('messages', { sender_id: sender, receiver_id: receiver, subject: m[0], body: m[1], is_read: read ? 1 : 0, read_at: read ? created : null, parent_id: null, deleted_by_sender: 0, deleted_by_receiver: 0, created_at: created });
    }

    // --- اطلاعیه‌ها ---
    for (let i = 0; i < ANNOUNCEMENTS.length; i++) {
      const a = ANNOUNCEMENTS[i];
      const created = J.addDays(today, -ri(0, 25));
      await insert('announcements', { title: a[0], body: a[1], audience: a[2], class_id: null, author_id: adminId, is_pinned: a[3], publish_at: created + ' 08:00:00', expires_at: i === 4 ? J.addDays(today, -2) : null, is_active: 1, views: ri(10, 300), created_at: created + ' 08:00:00' });
    }
    await insert('announcements', { title: 'یادآوری تکلیف ریاضی', body: 'دانش‌آموزان عزیز، تمرین‌های فصل دوم را تا شنبه آماده کنید.', audience: 'class', class_id: classIds[0], author_id: teacherUserIds[0], is_pinned: 0, publish_at: now, expires_at: null, is_active: 1, views: 12, created_at: now });

    // --- اعلان‌ها ---
    for (const s of shuffle(active).slice(0, 60)) {
      await insert('notifications', { user_id: s.uid, title: pick(['نمرهٔ جدید ثبت شد', 'تکلیف جدید', 'پاسخ تیکت', 'اطلاعیهٔ جدید']), body: pick(['نمرهٔ آزمون شما ثبت شد.', 'تکلیف جدیدی برای کلاس شما تعریف شد.', 'به تیکت شما پاسخ داده شد.', 'اطلاعیهٔ جدید منتشر شد.']), link: pick(['/exams/my', '/homework', '/tickets', '/announcements']), type: pick(['info', 'success', 'warning']), is_read: chance(0.5) ? 1 : 0, created_at: J.addDays(today, -ri(0, 10)) + ' 12:00:00' });
    }
    for (const uid of teacherUserIds) await insert('notifications', { user_id: uid, title: 'تیکت جدید', body: 'یک تیکت جدید به شما ارجاع شده است.', link: '/tickets', type: 'info', is_read: 0, created_at: now });
    await insert('notifications', { user_id: adminId, title: 'به سامانه خوش آمدید', body: 'دادهٔ نمونه با موفقیت بارگذاری شد. از منوی «ماژول‌ها» می‌توانید قابلیت‌ها را فعال/غیرفعال کنید.', link: '/system/modules', type: 'success', is_read: 0, created_at: now });

    // --- انضباطی ---
    for (let i = 0; i < 70; i++) {
      const s = pick(active);
      const positive = chance(0.45);
      const d = positive ? pick(DISCIPLINE_POS) : pick(DISCIPLINE_NEG);
      await insert('discipline_records', { student_id: s.id, type: positive ? 'positive' : 'negative', category: d[0], points: d[1], description: positive ? 'ثبت امتیاز مثبت توسط معلم' : pick(['تذکر شفاهی داده شد', 'با ولی تماس گرفته شد', 'تعهد کتبی گرفته شد', '']), date: pick(demoDays), action_taken: positive ? null : pick(['تذکر شفاهی', 'تذکر کتبی', 'تماس با ولی', null]), recorded_by: chance(0.5) ? adminId : teacherUserIds[homeroom[s.classIdx]], parent_notified: positive ? 0 : chance(0.5) ? 1 : 0, created_at: now });
    }

    // --- تقویم ---
    for (const e of EVENTS) {
      const y = parseInt(e[2].split('/')[0], 10) <= 6 ? jy + 1 : jy;
      await insert('events', { title: e[0], description: null, type: e[1], start_date: isoFromJalali(y, e[2]), end_date: isoFromJalali(y, e[3]), start_time: e[1] === 'meeting' ? '16:00' : null, end_time: e[1] === 'meeting' ? '18:00' : null, class_id: null, audience: e[1] === 'meeting' && e[0].includes('شورا') ? 'teachers' : 'all', color: e[4], created_by: adminId, created_at: now });
    }

    // --- مالی ---
    const feeIds = {};
    for (let g = 0; g < GRADES.length; g++) {
      feeIds[g] = await insert('fees', { academic_year_id: yearId, grade_level_id: gradeIds[g], class_id: null, title: `شهریهٔ سال تحصیلی ${ay.title} — پایهٔ ${GRADES[g].title}`, amount: 45000000 + g * 3000000, due_date: J.toGregorian(`${jy}/08/30`), type: 'tuition', description: 'قابل پرداخت در سه قسط', created_at: now });
    }
    const bookFee = await insert('fees', { academic_year_id: yearId, grade_level_id: null, class_id: null, title: 'هزینهٔ کتاب و لوازم‌التحریر', amount: 2500000, due_date: J.toGregorian(`${jy}/07/30`), type: 'other', description: null, created_at: now });
    const routeFee = await insert('fees', { academic_year_id: yearId, grade_level_id: null, class_id: null, title: 'سرویس ایاب و ذهاب (نوبت اول)', amount: 9000000, due_date: J.toGregorian(`${jy}/07/30`), type: 'transport', description: null, created_at: now });
    let invNo = 1001, invCount = 0, payCount = 0;
    const PAY_METHODS = ['cash', 'card', 'transfer', 'online'];
    const payDate = (created) => { const d = J.addDays(created, ri(1, 20)); return (d < today ? d : today) + ' ' + pad(ri(8, 14), 2) + ':' + pick(['00', '15', '30', '45']) + ':00'; };
    const addInvoice = async (s, feeId, title, amount, due, created) => {
      const r = rnd();
      let paid = 0, discount = 0;
      if (chance(0.1)) discount = Math.round(amount * 0.1);
      const payable = amount - discount;
      const status = r < 0.5 ? 'paid' : r < 0.8 ? 'partial' : 'unpaid';
      if (status === 'paid') paid = payable; else if (status === 'partial') paid = Math.round(payable * pick([0.33, 0.5, 0.66]) / 10000) * 10000;
      const invId = await insert('invoices', { number: 'INV-' + jy + '-' + pad(invNo++, 4), student_id: s.id, fee_id: feeId, title, amount, paid_amount: paid, discount, due_date: due, status, notes: discount ? 'تخفیف ۱۰٪ فرزند دوم/ممتاز' : null, created_by: adminId, created_at: created + ' 10:00:00', updated_at: now });
      invCount++;
      if (paid > 0) {
        const parts = status === 'paid' && chance(0.4) ? 2 : 1;
        let remain = paid;
        for (let k = 0; k < parts; k++) {
          const amt = k === parts - 1 ? remain : Math.round(paid / 2 / 10000) * 10000;
          remain -= amt;
          await insert('payments', { invoice_id: invId, student_id: s.id, amount: amt, method: pick(PAY_METHODS), reference: chance(0.7) ? digits(12) : null, paid_at: payDate(created), note: null, recorded_by: chance(0.5) ? adminId : staffUid, created_at: now });
          payCount++;
        }
      }
    };
    for (const s of active) {
      const g = CLASSES[s.classIdx].grade;
      await addInvoice(s, feeIds[g], `شهریهٔ ${ay.title}`, 45000000 + g * 3000000, J.toGregorian(`${jy}/08/30`), ay.startDate);
      if (chance(0.7)) await addInvoice(s, bookFee, 'کتاب و لوازم‌التحریر', 2500000, J.toGregorian(`${jy}/07/30`), ay.startDate);
      if (s.routeId) await addInvoice(s, routeFee, 'سرویس ایاب و ذهاب — نوبت اول', 9000000, J.toGregorian(`${jy}/07/30`), ay.startDate);
    }
    stats.invoices = invCount; stats.payments = payCount;

    // --- کتابخانه ---
    const bookIds = [];
    for (let i = 0; i < BOOKS.length; i++) {
      const b = BOOKS[i];
      const total = ri(1, 4);
      bookIds.push({ id: await insert('books', { title: b[0], author: b[1], publisher: b[2], isbn: '978-600-' + digits(3) + '-' + digits(3) + '-' + ri(0, 9), category: b[3], shelf: pick(['A', 'B', 'C', 'D']) + ri(1, 6), total_copies: total, available_copies: total, description: null, created_at: now }), total, out: 0 });
    }
    let loanCount = 0;
    for (let i = 0; i < 55; i++) {
      const b = pick(bookIds);
      if (b.out >= b.total) continue;
      const s = pick(active);
      const loaned = J.addDays(today, -ri(1, 50));
      const due = J.addDays(loaned, 14);
      const returned = J.diffDays(due, today) > 0 ? chance(0.75) : chance(0.3);
      await insert('book_loans', { book_id: b.id, student_id: s.id, user_id: null, loaned_at: loaned, due_at: due, returned_at: returned ? J.addDays(loaned, ri(3, 20)) : null, status: returned ? 'returned' : 'loaned', note: null, created_by: staffUid, created_at: loaned + ' 10:00:00' });
      if (!returned) { b.out++; await tx.table('books').where('id', b.id).update({ available_copies: b.total - b.out }); }
      loanCount++;
    }
    for (let i = 0; i < 3; i++) await insert('book_loans', { book_id: pick(bookIds).id, student_id: null, user_id: pick(teacherUserIds), loaned_at: J.addDays(today, -ri(1, 20)), due_at: J.addDays(today, ri(1, 10)), returned_at: null, status: 'loaned', note: 'امانت همکار', created_by: staffUid, created_at: now });
    stats.books = BOOKS.length; stats.loans = loanCount + 3;

    // --- سلامت ---
    for (let i = 0; i < 35; i++) {
      const s = pick(active); const h = pick(HEALTH);
      await insert('health_records', { student_id: s.id, date: pick(demoDays), type: h[0], title: h[1], description: h[2], action: h[3] || null, referred: h[0] === 'injury' && chance(0.3) ? 1 : 0, recorded_by: staffUid, created_at: now });
    }
    // --- مشاوره ---
    for (let i = 0; i < 25; i++) {
      const s = pick(active);
      const d = pick(demoDays);
      await insert('counseling_sessions', { student_id: s.id, date: d, counselor_id: adminId, topic: pick(COUNSEL), summary: 'جلسهٔ گفتگو با دانش‌آموز برگزار شد؛ راهکارهای عملی ارائه و قرار پیگیری گذاشته شد.', follow_up_date: chance(0.6) ? J.addDays(d, 14) : null, is_confidential: chance(0.5) ? 1 : 0, created_at: d + ' 10:00:00' });
    }
    // --- نظرسنجی ---
    const polls = [
      ['رضایت شما از کیفیت سرویس مدرسه چقدر است؟', ['بسیار راضی', 'راضی', 'متوسط', 'ناراضی'], 'all', 0],
      ['کدام فعالیت فوق‌برنامه را ترجیح می‌دهید؟', ['رباتیک', 'تئاتر', 'ورزش', 'نقاشی', 'موسیقی'], 'students', 1],
      ['بهترین زمان برای جلسهٔ اولیا و مربیان؟', ['صبح پنج‌شنبه', 'عصر سه‌شنبه', 'عصر چهارشنبه'], 'all', 0]
    ];
    for (const p of polls) {
      const pid = await insert('polls', { question: p[0], description: null, options: JSON.stringify(p[1]), audience: p[2], class_id: null, is_active: 1, multiple: p[3], ends_at: J.addDays(today, ri(5, 20)), created_by: adminId, created_at: J.addDays(today, -ri(1, 8)) + ' 09:00:00' });
      for (const s of shuffle(active).slice(0, ri(40, 120))) await insert('poll_votes', { poll_id: pid, user_id: s.uid, option_index: ri(0, p[1].length - 1), created_at: now });
    }
    // --- اسناد رسمی (گواهی اشتغال به تحصیل، نامه، کارنامهٔ رسمی) ---
    {
      const jy = J.toJalaliParts(today).jy;
      const yearRow = await tx.table('academic_years').where('is_current', 1).first();
      const yearTitle = yearRow ? yearRow.title : '';
      const recipients = ['ادارهٔ بیمهٔ سلامت', 'باشگاه فرهنگی ورزشی', 'سفارت', 'بانک ملی', 'ادارهٔ گذرنامه', 'کانون پرورش فکری', 'شرکت بیمهٔ ایران', 'فدراسیون شطرنج'];
      const docStudents = shuffle(active).slice(0, 14);
      let cnt = { 'گ': 0, 'ن': 0, 'ک': 0 };
      const codeOf = () => Array.from({ length: 10 }, () => '0123456789ABCDEF'[ri(0, 15)]).join('');
      for (let i = 0; i < docStudents.length; i++) {
        const st = docStudents[i];
        const full = await tx.table('students as s').leftJoin('classes as c', 'c.id', 's.class_id').leftJoin('grade_levels as g', 'g.id', 's.grade_level_id').select('s.*', 'c.title as class_title', 'g.title as grade_title').where('s.id', st.id).first();
        const issuedAt = J.addDays(today, -ri(1, 40));
        const type = i < 9 ? 'certificate' : i < 11 ? 'letter' : 'report_card';
        const prefix = type === 'certificate' ? 'گ' : type === 'letter' ? 'ن' : 'ک';
        cnt[prefix]++;
        const serial = `${prefix}-${jy}-${String(cnt[prefix]).padStart(4, '0')}`;
        const recipient = pick(recipients);
        let row = { type, serial, student_id: st.id, issued_at: issuedAt, issued_by: adminId, verify_code: codeOf(), status: i === 2 ? 'revoked' : 'valid', revoked_at: i === 2 ? now : null, revoke_reason: i === 2 ? 'اشتباه در نام گیرنده؛ نسخهٔ جدید صادر شد' : null, class_id: full.class_id, created_at: now };
        if (type === 'certificate') {
          row.title = 'گواهی اشتغال به تحصیل'; row.recipient = recipient; row.purpose = 'ارائه به ' + recipient;
          row.body = `بدین‌وسیله گواهی می‌شود ${full.first_name} ${full.last_name} فرزند ${full.father_name || '—'} به شمارهٔ دانش‌آموزی ${J.toPersianDigits(full.student_number)} و کد ملی ${J.toPersianDigits(full.national_id || '')}، در سال تحصیلی ${J.toPersianDigits(yearTitle)} در پایهٔ ${full.grade_title || ''} کلاس ${full.class_title || ''} این آموزشگاه مشغول به تحصیل است.\nاین گواهی بنا به درخواست نامبرده جهت ارائه به ${recipient} صادر گردیده و فاقد هرگونه ارزش دیگری است.`;
        } else if (type === 'letter') {
          row.title = 'معرفی‌نامه برای شرکت در مسابقات'; row.recipient = 'ادارهٔ تربیت بدنی'; row.purpose = 'معرفی دانش‌آموز';
          row.body = `با سلام و احترام\nبدین‌وسیله دانش‌آموز ${full.first_name} ${full.last_name} از کلاس ${full.class_title || ''} این آموزشگاه جهت شرکت در مسابقات ورزشی منطقه معرفی می‌گردد. خواهشمند است همکاری لازم را مبذول فرمایید.\nبا تشکر`;
        } else {
          row.title = `کارنامهٔ نوبت اول — ${full.first_name} ${full.last_name}`; row.term_id = term1;
          const subjRows = await tx.table('class_subjects as cs').join('subjects as sb', 'sb.id', 'cs.subject_id').select('sb.title', 'cs.weekly_hours', 'sb.id as sid').where('cs.class_id', full.class_id).all();
          const subjects = subjRows.map((r) => ({ title: r.title, hours: r.weekly_hours, score: Math.round((11 + rnd() * 9) * 100) / 100, desc: null, classAvg: Math.round((12 + rnd() * 5) * 100) / 100 }));
          const gpa = subjects.length ? Math.round(subjects.reduce((a, b) => a + b.score, 0) / subjects.length * 100) / 100 : null;
          row.data = JSON.stringify({ student: { id: full.id, name: `${full.first_name} ${full.last_name}`, father: full.father_name, student_number: full.student_number, national_id: full.national_id, class: full.class_title, grade: full.grade_title, class_id: full.class_id }, term: { id: term1, title: 'نوبت اول', year: yearTitle, is_locked: 0 }, subjects, gpa, rank: ri(1, 20), classSize: 20, classAvg: 15.2, attendance: { absent: ri(0, 3), late: ri(0, 2), excused: ri(0, 1), leave: 0 }, remark: 'عملکرد خوب؛ با تلاش بیشتر می‌تواند بهتر شود.', pass: 10, descriptive: false });
        }
        await insert('documents', row);
      }
    }
    // --- سرفصل‌ها و دفتر کلاسی (گزارش تدریس بر اساس برنامهٔ هفتگی) ---
    {
      const CHAPTERS = {
        MATH: ['عددهای صحیح و گویا', 'جبر و معادله', 'هندسه و استدلال', 'توان و جذر', 'نسبت و تناسب', 'آمار و احتمال', 'بردار و مختصات', 'چندضلعی‌ها و مساحت', 'حجم و سطح'],
        SCI: ['ماده و تغییرات آن', 'اتم‌ها و الفبای مواد', 'منابع انرژی', 'گرما و بهینه‌سازی مصرف', 'سفر آب روی زمین', 'سلول و سازمان‌بندی آن', 'گوارش و تبادل مواد', 'الکتریسیته و مغناطیس'],
        LIT: ['ستایش و زیبایی آفرینش', 'شکفتن و ادبیات تعلیمی', 'سبک زندگی و اخلاق', 'نام‌ها و یادها', 'اسلام و انقلاب اسلامی', 'ادبیات بومی و جهان', 'نگارش و انشای توصیفی', 'دستور زبان: جمله و اجزای آن'],
        SOC: ['حقوق و تکالیف شهروندی', 'مصرف و تولید', 'جغرافیای ایران: ناهمواری‌ها', 'آب و هوای ایران', 'جمعیت و شهرنشینی', 'تاریخ ایران باستان', 'ایران در عصر اسلامی', 'میراث فرهنگی'],
        ARB: ['قواعد: اسم اشاره و ضمایر', 'فعل ماضی و مضارع', 'جملهٔ اسمیه و فعلیه', 'ترجمهٔ متن و واژگان', 'اعداد و زمان', 'مرور و تمرین جامع'],
        ENG: ['My Name / Greetings', 'My Family', 'My Age and Numbers', 'My Address and Places', 'My Appearance', 'Review and Speaking Practice'],
        QRN: ['روخوانی و تجوید: مد و تنوین', 'سورهٔ یس: آیات ۱ تا ۳۰', 'پیام قرآنی: احسان', 'ترجمهٔ عبارات پرکاربرد', 'حفظ سوره‌های کوتاه', 'مرور و ارزشیابی قرائت'],
        REL: ['خدای مهربان و نعمت‌ها', 'پیامبران و رسالت', 'نماز و راز و نیاز', 'اخلاق فردی: راست‌گویی', 'خانواده و احترام', 'مرور و پرسش کلاسی'],
        THK: ['خودشناسی و توانمندی‌ها', 'تصمیم‌گیری و حل مسئله', 'مدیریت زمان و برنامه‌ریزی', 'ارتباط مؤثر و همدلی'],
        TEC: ['ایمنی و ابزارشناسی', 'کار با رایانه و اسناد', 'پروژهٔ ساخت و فناوری', 'کسب‌وکار و کارآفرینی'],
        ART: ['طراحی با خط و نقطه', 'رنگ‌شناسی و ترکیب رنگ', 'خوشنویسی و نگارگری', 'پروژهٔ هنری پایان نوبت'],
        PE: ['آمادگی جسمانی و گرم‌کردن', 'دو و میدانی', 'بازی‌های گروهی: والیبال', 'بازی‌های گروهی: فوتسال']
      };
      const ACTS = ['تدریس مفاهیم با مثال و حل تمرین پای تابلو', 'کار گروهی و ارائهٔ دانش‌آموزان', 'پرسش کلاسی از درس جلسهٔ قبل و رفع اشکال', 'استفاده از فیلم آموزشی و بحث کلاسی', 'آزمونک ۱۰ دقیقه‌ای و حل تمرین', 'مرور درس و پاسخ به سؤالات دانش‌آموزان'];
      const HW = (code) => (code === 'PE' ? null : code === 'ART' ? 'تکمیل طرح شروع‌شده در کلاس' : code === 'ENG' ? 'Workbook: exercises of this lesson' : `حل تمرین‌های صفحهٔ ${ri(12, 90)} تا ${ri(91, 140)}`);
      const sylIds = {}; // `${g}-${code}` -> [ids]
      const yStart = ay.startDate; const yEnd = J.toGregorian(`${jy + 1}/02/31`);
      const spanDays = Math.max(1, Math.round((new Date(yEnd) - new Date(yStart)) / 86400000));
      for (let g = 0; g < GRADES.length; g++) {
        for (const sub of SUBJECTS) {
          const chapters = CHAPTERS[sub.code] || ['فصل ۱', 'فصل ۲', 'فصل ۳', 'فصل ۴'];
          const ids = [];
          for (let k = 0; k < chapters.length; k++) {
            const from = J.addDays(yStart, Math.floor(spanDays * k / chapters.length)); const to = J.addDays(yStart, Math.floor(spanDays * (k + 1) / chapters.length) - 1);
            ids.push(await insert('syllabus_items', { academic_year_id: yearId, subject_id: subjectIds[g][sub.code], grade_level_id: gradeIds[g], title: `فصل ${J.toPersianDigits(k + 1)}: ${chapters[k]}`, description: k === 0 ? 'یادآوری پیش‌نیازها و ورود به مبحث' : null, sort_order: k + 1, planned_hours: Math.max(2, Math.round(sub.hours * 30 / chapters.length)), planned_from: from, planned_to: to, created_at: now }));
          }
          sylIds[`${g}-${sub.code}`] = ids;
        }
      }
      stats.syllabus = Object.values(sylIds).reduce((a, b) => a + b.length, 0);
      // گزارش تدریس برای روزهای گذشته: اکثر معلمان منظم‌اند، چند نفر کمتر ثبت می‌کنند
      const diligence = TEACHERS.map(() => pick([0.95, 0.92, 0.9, 0.88, 0.8, 0.7]));
      const slotsByDay = {}; slotRows.forEach((r) => { (slotsByDay[r.d] = slotsByDay[r.d] || []).push(r); });
      let logCount = 0;
      const todayPeriodLimit = 2; // امروز فقط زنگ‌های اول ثبت شده‌اند
      for (let di = 0; di < demoDays.length; di++) {
        const date = demoDays[di];
        const w = J.weekdayIndex(date);
        for (const r of slotsByDay[w] || []) {
          if (date === today && r.p > todayPeriodLimit) continue;
          if (!chance(diligence[r.cs.teacherIdx])) continue;
          const g = CLASSES[r.ci].grade;
          const ids = sylIds[`${g}-${r.cs.code}`];
          const chapters = CHAPTERS[r.cs.code] || [];
          const progress = Math.min(ids.length - 1, Math.floor((di / demoDays.length) * Math.max(1, Math.round(ids.length * 0.35)) + (chance(0.15) ? 1 : 0)));
          const chapterTitle = chapters[progress] || `فصل ${progress + 1}`;
          await insert('lesson_logs', {
            class_id: classIds[r.ci], class_subject_id: r.cs.id, subject_id: r.cs.subjectId, teacher_id: teacherIds[r.cs.teacherIdx], date, period: r.p,
            topic: `${chapterTitle} — ${pick(['بخش اول', 'بخش دوم', 'ادامهٔ مبحث', 'حل تمرین', 'جمع‌بندی', 'مثال‌های کاربردی'])}`, description: chance(0.7) ? pick(ACTS) : null, homework: chance(0.55) ? HW(r.cs.code) : null,
            syllabus_item_id: ids[progress], created_by: teacherUserIds[r.cs.teacherIdx], created_at: `${date} ${pick(['12:35', '13:05', '13:40', '18:20'])}:00`
          });
          logCount++;
        }
      }
      stats.lessonLogs = logCount;
    }
    // --- پیش‌ثبت‌نام (درخواست‌های خانواده‌ها با وضعیت‌های مختلف) ---
    {
      const APP_STATUS = ['pending', 'pending', 'pending', 'pending', 'reviewing', 'reviewing', 'docs_requested', 'accepted', 'accepted', 'rejected', 'pending', 'reviewing', 'accepted', 'pending'];
      const notes = { reviewing: null, docs_requested: 'لطفاً تصویر کارنامهٔ سال قبل و عکس ۳×۴ را به دفتر مدرسه تحویل دهید.', accepted: 'برای ثبت‌نام قطعی تا پایان هفته با مدارک به دفتر مدرسه مراجعه کنید.', rejected: 'ظرفیت پایهٔ درخواستی تکمیل شده است.', pending: null };
      for (let i = 0; i < APP_STATUS.length; i++) {
        const status = APP_STATUS[i];
        const gender = chance(0.5) ? 'male' : 'female';
        const first = pick(gender === 'male' ? MALE : FEMALE); const last = pick(LAST);
        const g = status === 'rejected' ? 2 : pick([0, 0, 0, 1, 2]);
        let nid; do { nid = nationalId(); } while (usedNid.has(nid)); usedNid.add(nid);
        const created = J.addDays(J.todayISO(), -ri(1, 25));
        const reviewed = status === 'pending' ? null : J.addDays(created, ri(0, 3));
        await insert('applications', {
          code: `AP-${jy}-${String(i + 1).padStart(5, '0')}`, academic_year_id: yearId, grade_level_id: gradeIds[g], first_name: first, last_name: last, national_id: nid,
          birth_date: J.toGregorian(`${jy - 13 - g}/${ri(1, 12)}/${ri(1, 29)}`), birth_place: pick(CITIES), gender, previous_school: pick(['دبستان شهید رجایی', 'دبستان امام رضا', 'دبستان فرهنگ', 'مدرسهٔ نمونهٔ فردوسی', 'دبستان شهدا']),
          previous_average: Math.round((15 + rnd() * 5) * 100) / 100, father_name: `${pick(['محمد', 'علی', 'حسین', 'رضا', 'مهدی', 'سعید', 'جواد'])} ${last}`, father_phone: mobile(), father_national_id: nationalId(), father_job: pick(FATHER_JOBS), father_education: pick(['diploma', 'bachelor', 'master', 'associate']),
          mother_name: `${pick(['فاطمه', 'زهرا', 'مریم', 'لیلا', 'سمیه', 'الهام'])} ${pick(LAST)}`, mother_phone: mobile(), mother_job: pick(MOTHER_JOBS), mother_education: pick(['diploma', 'bachelor', 'associate']),
          address: `${pick(CITIES)}، ${pick(STREETS)}، پلاک ${ri(1, 150)}`, postal_code: digits(10), home_phone: '021' + digits(8), email: chance(0.4) ? `parent${i + 1}@example.com` : null,
          notes: chance(0.2) ? 'علاقه‌مند به کلاس‌های فوق‌برنامهٔ رباتیک' : null, status, review_note: notes[status], reviewed_by: reviewed ? adminId : null, reviewed_at: reviewed ? reviewed + ' 10:30:00' : null,
          ip: `5.${ri(1, 250)}.${ri(1, 250)}.${ri(1, 250)}`, created_at: created + ` ${String(ri(8, 22)).padStart(2, '0')}:${String(ri(0, 59)).padStart(2, '0')}:00`, updated_at: reviewed ? reviewed + ' 10:30:00' : null
        });
      }
    }
    // --- فعالیت‌ها ---
    await insert('activity_logs', { user_id: adminId, action: 'seed', entity: 'system', description: 'بارگذاری دادهٔ نمونه', ip: '127.0.0.1', created_at: now });
    for (let i = 0; i < 20; i++) await insert('activity_logs', { user_id: pick([adminId].concat(teacherUserIds)), action: pick(['login', 'update', 'create']), entity: pick(['students', 'attendance', 'exams', 'tickets']), entity_id: ri(1, 200), description: pick(['ورود به سامانه', 'ویرایش پرونده', 'ثبت حضور و غیاب', 'ثبت نمره', 'پاسخ به تیکت']), ip: '192.168.1.' + ri(2, 250), created_at: J.addDays(today, -ri(0, 10)) + ' ' + pad(ri(7, 15), 2) + ':' + pad(ri(0, 59), 2) + ':00' });
    // --- لاگ ورود ---
    for (let i = 0; i < 30; i++) { const ok = chance(0.85); const u = pick([{ id: adminId, u: adminUsername || 'admin' }].concat(teacherUserIds.map((id, k) => ({ id, u: 'teacher' + (k + 1) })))); await insert('login_logs', { user_id: ok ? u.id : null, username: u.u, ip: '192.168.1.' + ri(2, 250), user_agent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120', success: ok ? 1 : 0, created_at: J.addDays(today, -ri(0, 7)) + ' ' + pad(ri(7, 15), 2) + ':' + pad(ri(0, 59), 2) + ':00' }); }

    // --- تنظیمات نمایشی ---
    const setRows = { demo_mode: '1', demo_staff_username: 'staff1', demo_parent_username: stats.demoParent || '', admissions_open: '1', admissions_text: 'پیش‌ثبت‌نام پایه‌های هفتم تا نهم سال تحصیلی آینده. پس از بررسی اولیه، نتیجه از طریق پیامک اعلام می‌شود.', demo_admin_username: adminUsername || 'admin', demo_admin_password: 'admin123', demo_teacher_username: 'teacher1', demo_student_username: '40001', demo_user_password: '123456', weekly_periods: String(PERIOD_TIMES.length), period_times: PERIOD_TIMES.join(','), school_days: SCHOOL_DAYS.join(','), student_number_next: String(num), student_number_prefix: '', school_slogan: 'دانایی، توانایی، شایستگی', principal_name: 'مدیر مدرسه', school_district: 'ادارهٔ آموزش و پرورش ناحیهٔ ۱', letterhead_header: 'جمهوری اسلامی ایران\nوزارت آموزش و پرورش', signatory_title: 'مدیر مدرسه' };
    for (const [k, v] of Object.entries(setRows)) {
      const ex = await tx.findOne('settings', { key: k });
      if (ex) await tx.update('settings', { value: v, updated_at: now }, { key: k }); else await tx.insert('settings', { key: k, value: v, updated_at: now });
    }
  });
  try { await settingsStore.load(); } catch (e) { /* ignore */ }
  log(`دادهٔ نمونه: ${stats.teachers} معلم، ${stats.classes} کلاس، ${stats.students} دانش‌آموز، ${stats.attendance} رکورد حضور، ${stats.exams} آزمون، ${stats.grades} نمره، ${stats.homework} تکلیف، ${stats.tickets} تیکت، ${stats.invoices} فاکتور، ${stats.books} کتاب، ${stats.lessonLogs} گزارش تدریس، ${stats.enrollments} سابقهٔ تحصیلی، ${stats.parents} حساب ولی`);
  return stats;
}

module.exports = { run };
