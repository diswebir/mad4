'use strict';
/**
 * موتور برنامهٔ هفتگی
 *  - بارگذاری وضعیت (کلاس‌ها، دروس/معلمان، زنگ‌های پرشده، ساعات در دسترس‌نبودن معلمان)
 *  - slotInfo: وضعیت هر درس/معلم برای یک خانهٔ مشخص (آزاد / تداخل / در دسترس نیست / بدون معلم / سقف روز)
 *  - generate: تولید خودکار برنامه برای یک یا چند کلاس (حریصانه با چند تلاش تصادفی + ترمیم یک‌مرحله‌ای)
 *  - apply: ثبت نتیجه در پایگاه داده
 */
const db = require('../../core/db');
const settings = require('../../core/settings');
const J = require('../../core/jalali');

const PERIODS = () => Math.min(12, Math.max(1, settings.getInt('weekly_periods', 4)));
const periodTimes = () => { const t = settings.getList('period_times'); return t.length ? t : ['07:45-08:30', '08:40-09:25', '09:45-10:30', '10:40-11:25', '11:35-12:20', '12:30-13:15']; };
const SCHOOL_DAYS = () => { const d = settings.getList('school_days'); const n = d.map(Number).filter((x) => x >= 0 && x <= 6); return n.length ? n : [0, 1, 2, 3, 4]; };
const key = (d, p) => `${d}:${p}`;

/** بارگذاری تمام داده‌های لازم برای کلاس‌های داده‌شده (یا همهٔ کلاس‌های فعال سال) */
async function loadContext({ classIds = null, yearId = null } = {}) {
  let cq = db.table('classes as c').leftJoin('grade_levels as g', 'g.id', 'c.grade_level_id').select('c.id', 'c.title', 'c.room_id', 'g.title as grade_title').where('c.is_active', 1);
  if (classIds && classIds.length) cq = cq.whereIn('c.id', classIds); else if (yearId) cq = cq.where('c.academic_year_id', yearId);
  const classes = await cq.orderBy('g.sort_order').orderBy('c.title').all();
  const ids = classes.map((c) => c.id);
  const subjects = ids.length ? await db.table('class_subjects as cs').join('subjects as s', 's.id', 'cs.subject_id').leftJoin('teachers as t', 't.id', 'cs.teacher_id').leftJoin('users as u', 'u.id', 't.user_id')
    .select('cs.id', 'cs.class_id', 'cs.subject_id', 'cs.teacher_id', 'cs.weekly_hours', 's.title', 'u.name as teacher_name').whereIn('cs.class_id', ids).orderBy('s.title').all() : [];
  // همهٔ زنگ‌های مدرسه (برای تداخل معلمان با کلاس‌های خارج از محدوده هم لازم است)
  const slots = await db.table('schedule_slots as ss').join('class_subjects as cs', 'cs.id', 'ss.class_subject_id').join('classes as c', 'c.id', 'ss.class_id')
    .select('ss.id', 'ss.class_id', 'ss.class_subject_id', 'ss.day_of_week as day', 'ss.period', 'ss.room_id', 'cs.teacher_id', 'c.title as class_title').all();
  const unavailable = new Map(); // teacher_id → Map('d:p' → note)
  for (const r of await db.table('teacher_availability').where('status', 'unavailable').all()) { if (!unavailable.has(r.teacher_id)) unavailable.set(r.teacher_id, new Map()); unavailable.get(r.teacher_id).set(key(r.day_of_week, r.period), r.note || ''); }
  return { days: SCHOOL_DAYS(), periods: PERIODS(), times: periodTimes(), classes, subjects, slots, unavailable };
}

/** وضعیت هر درس کلاس برای خانهٔ (day, period) — برای مودال هوشمند */
async function slotInfo(classId, day, period) {
  const ctx = await loadContext({ classIds: [classId] });
  const mine = ctx.subjects.filter((s) => s.class_id === classId);
  const current = ctx.slots.find((s) => s.class_id === classId && s.day === day && s.period === period) || null;
  const placedCount = {}; const placedDay = {};
  for (const s of ctx.slots) { if (s.class_id !== classId) continue; placedCount[s.class_subject_id] = (placedCount[s.class_subject_id] || 0) + 1; if (s.day === day) placedDay[s.class_subject_id] = (placedDay[s.class_subject_id] || 0) + 1; }
  const out = mine.map((cs) => {
    const info = { id: cs.id, title: cs.title, teacher_id: cs.teacher_id, teacher_name: cs.teacher_name || '', hours: Number(cs.weekly_hours || 0), placed: placedCount[cs.id] || 0, same_day: placedDay[cs.id] || 0, status: 'free', detail: '' };
    if (current && current.class_subject_id === cs.id) { info.status = 'current'; info.detail = 'در همین زنگ قرار دارد'; return info; }
    if (!cs.teacher_id) { info.status = 'no_teacher'; info.detail = 'معلمی تعیین نشده است'; return info; }
    const clash = ctx.slots.find((s) => s.teacher_id === cs.teacher_id && s.day === day && s.period === period && s.class_id !== classId);
    if (clash) { info.status = 'busy'; info.detail = `در کلاس «${clash.class_title}» درس دارد`; info.busy_in = clash.class_title; info.busy_class_id = clash.class_id; return info; }
    const un = ctx.unavailable.get(cs.teacher_id); const note = un && un.get(key(day, period));
    if (note !== undefined) { info.status = 'unavailable'; info.detail = note ? `در دسترس نیست (${note})` : 'در این زنگ در دسترس نیست'; return info; }
    if (info.hours && info.placed >= info.hours) { info.status = 'complete'; info.detail = 'ساعات هفتگی این درس تکمیل شده است'; return info; }
    if (info.same_day) { info.status = 'same_day'; info.detail = `امروز ${J.toPersianDigits(info.same_day)} زنگ دیگر از این درس دارد`; }
    return info;
  });
  // معلمان: بار همان روز (برای نمایش «۳ زنگ امروز»)
  const dayLoad = {}; for (const s of ctx.slots) if (s.day === day && s.teacher_id) dayLoad[s.teacher_id] = (dayLoad[s.teacher_id] || 0) + 1;
  for (const i of out) i.teacher_day_load = i.teacher_id ? (dayLoad[i.teacher_id] || 0) : 0;
  // اتاق‌ها: کدام اتاق‌ها در این زنگ توسط کلاس دیگری اشغال‌اند
  const rooms = await db.table('rooms').orderBy('title').all();
  const roomBusy = {}; for (const s of ctx.slots) if (s.day === day && s.period === period && s.room_id && s.class_id !== classId) roomBusy[s.room_id] = s.class_title;
  return { day, period, current: current ? current.class_subject_id : null, current_room: current ? current.room_id : null, subjects: out, rooms: rooms.map((r) => ({ id: r.id, title: r.title, busy_in: roomBusy[r.id] || null })) };
}

/** بررسی یک قرارگیری دستی: خطا (رشته) یا null */
async function checkPlacement(classId, cs, day, period) {
  if (!cs.teacher_id) return null;
  const clash = await db.table('schedule_slots as ss').join('class_subjects as c2', 'c2.id', 'ss.class_subject_id').join('classes as c', 'c.id', 'ss.class_id').select('c.title').where('c2.teacher_id', cs.teacher_id).where('ss.day_of_week', day).where('ss.period', period).where('ss.class_id', '!=', classId).first();
  if (clash) return `تداخل: ${cs.teacher_name} در این زنگ در کلاس «${clash.title}» درس دارد`;
  const un = await db.table('teacher_availability').where({ teacher_id: cs.teacher_id, day_of_week: day, period, status: 'unavailable' }).first();
  if (un) return `${cs.teacher_name} در ${J.WEEKDAYS[day]} زنگ ${J.toPersianDigits(period)} در دسترس نیست${un.note ? ' (' + un.note + ')' : ''}`;
  return null;
}

/**
 * تولید خودکار برنامه
 * @param {object} o
 * @param {number[]} o.classIds کلاس‌های هدف
 * @param {'fill'|'replace'} o.mode  fill = حفظ زنگ‌های موجود و تکمیل؛ replace = پاک‌کردن برنامهٔ کلاس‌های هدف و ساخت از نو
 * @param {number} o.maxPerDay حداکثر زنگ یک درس در یک روز (۱..۳)
 * @param {boolean} o.allowDouble اجازهٔ زنگ‌های دوتایی پشت‌سرهم برای دروس ≥۲ ساعت
 * @param {number} o.attempts تعداد تلاش تصادفی
 */
async function generate({ classIds, mode = 'fill', maxPerDay = 2, allowDouble = true, attempts = 40, seed = Date.now() } = {}) {
  const ctx = await loadContext({ classIds });
  const targets = new Set(ctx.classes.map((c) => c.id));
  const days = ctx.days, periods = ctx.periods;
  const cells = []; for (const d of days) for (let p = 1; p <= periods; p++) cells.push({ d, p });
  // زنگ‌های ثابت: همهٔ زنگ‌های کلاس‌های غیرهدف + (در حالت fill) زنگ‌های کلاس‌های هدف
  const fixed = ctx.slots.filter((s) => !targets.has(s.class_id) || mode === 'fill');
  const classTitle = Object.fromEntries(ctx.classes.map((c) => [c.id, c.title]));
  const subjById = Object.fromEntries(ctx.subjects.map((s) => [s.id, s]));
  // نیازها
  const placedFixed = {}; for (const s of fixed) if (targets.has(s.class_id)) placedFixed[s.class_subject_id] = (placedFixed[s.class_subject_id] || 0) + 1;
  const demands = ctx.subjects.map((s) => ({ cs: s, need: Math.max(0, Number(s.weekly_hours || 0) - (placedFixed[s.id] || 0)) })).filter((x) => x.need > 0);
  const noTeacher = demands.filter((x) => !x.cs.teacher_id);
  const solvable = demands.filter((x) => x.cs.teacher_id);
  // سختی: مجموع ساعات معلم در همهٔ کلاس‌ها + تعداد زنگ‌های در دسترس‌نبودن + ساعات این درس
  const teacherLoad = {}; for (const s of ctx.subjects) if (s.teacher_id) teacherLoad[s.teacher_id] = (teacherLoad[s.teacher_id] || 0) + Number(s.weekly_hours || 0);
  for (const s of ctx.slots) if (s.teacher_id && !targets.has(s.class_id)) teacherLoad[s.teacher_id] = (teacherLoad[s.teacher_id] || 0) + 1;
  const difficulty = (x) => (teacherLoad[x.cs.teacher_id] || 0) * 2 + ((ctx.unavailable.get(x.cs.teacher_id) || new Map()).size) + x.need * 3;

  let rnd = mulberry32(seed >>> 0);
  let best = null;
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt++) {
    // وضعیت اولیه
    const classBusy = new Map(); // class_id → Map('d:p' → cs_id)
    const teacherBusy = new Map(); // teacher_id → Map('d:p' → class_id)
    const subjDay = new Map(); // cs_id → Map(d → n)
    const mark = (classId, teacherId, csId, d, p) => {
      if (!classBusy.has(classId)) classBusy.set(classId, new Map()); classBusy.get(classId).set(key(d, p), csId);
      if (teacherId) { if (!teacherBusy.has(teacherId)) teacherBusy.set(teacherId, new Map()); teacherBusy.get(teacherId).set(key(d, p), classId); }
      if (!subjDay.has(csId)) subjDay.set(csId, new Map()); subjDay.get(csId).set(d, (subjDay.get(csId).get(d) || 0) + 1);
    };
    const unmark = (classId, teacherId, csId, d, p) => {
      classBusy.get(classId).delete(key(d, p));
      if (teacherId && teacherBusy.has(teacherId)) teacherBusy.get(teacherId).delete(key(d, p));
      const m = subjDay.get(csId); if (m) m.set(d, Math.max(0, (m.get(d) || 0) - 1));
    };
    for (const s of fixed) mark(s.class_id, s.teacher_id, s.class_subject_id, s.day, s.period);
    const free = (classId, teacherId, d, p) => {
      const k = key(d, p);
      if (classBusy.get(classId) && classBusy.get(classId).has(k)) return false;
      if (teacherId && teacherBusy.get(teacherId) && teacherBusy.get(teacherId).has(k)) return false;
      const un = ctx.unavailable.get(teacherId); if (un && un.has(k)) return false;
      return true;
    };
    const score = (x, d, p) => {
      const sd = (subjDay.get(x.cs.id) && subjDay.get(x.cs.id).get(d)) || 0;
      if (sd >= maxPerDay) return null;
      let sc = sd * 40 + p * 2 + rnd() * 6; // پخش در روزها، ترجیح زنگ‌های اولیه
      // چسبیدن به زنگ‌های همان معلم در همان روز (کاهش ساعت‌های خالی معلم)
      const tb = teacherBusy.get(x.cs.teacher_id);
      if (tb) {
        const hasAdj = tb.has(key(d, p - 1)) || tb.has(key(d, p + 1));
        const anyToday = [...tb.keys()].some((k) => k.startsWith(d + ':'));
        if (hasAdj) sc -= 12; else if (anyToday) sc += 4; // اگر امروز هست ولی نچسبیده، کمی جریمه (فاصله)
      }
      // بار روزانهٔ کلاس: روزهای کم‌بارتر ترجیح
      const cb = classBusy.get(x.cs.class_id); const classDayLoad = cb ? [...cb.keys()].filter((k) => k.startsWith(d + ':')).length : 0;
      sc += classDayLoad * 3;
      return sc;
    };
    const plan = []; const unplaced = [];
    const order = solvable.map((x) => ({ x, need: x.need, w: difficulty(x) + rnd() * 4 })).sort((a, b) => b.w - a.w);
    // دور به دور: هر دور یک ساعت از هر درس (برای توزیع منصفانه)، سخت‌ترها اول
    let progress = true;
    while (progress) {
      progress = false;
      for (const o of order) {
        if (o.need <= 0) continue;
        const x = o.x; const cid = x.cs.class_id, tid = x.cs.teacher_id;
        let bestCell = null, bestSc = Infinity, dbl = false;
        for (const c of cells) {
          if (!free(cid, tid, c.d, c.p)) continue;
          let sc = score(x, c.d, c.p); if (sc == null) continue;
          let isDbl = false;
          if (allowDouble && o.need >= 2 && c.p < periods && free(cid, tid, c.d, c.p + 1)) { const sd = (subjDay.get(x.cs.id) && subjDay.get(x.cs.id).get(c.d)) || 0; if (sd + 2 <= maxPerDay) { sc -= 8; isDbl = true; } }
          if (sc < bestSc) { bestSc = sc; bestCell = c; dbl = isDbl; }
        }
        if (!bestCell) continue;
        mark(cid, tid, x.cs.id, bestCell.d, bestCell.p); plan.push({ class_id: cid, class_subject_id: x.cs.id, teacher_id: tid, day: bestCell.d, period: bestCell.p }); o.need--; progress = true;
        if (dbl && o.need > 0) { mark(cid, tid, x.cs.id, bestCell.d, bestCell.p + 1); plan.push({ class_id: cid, class_subject_id: x.cs.id, teacher_id: tid, day: bestCell.d, period: bestCell.p + 1 }); o.need--; }
      }
    }
    // ترمیم: برای نیازهای باقی‌مانده، با جابه‌جایی/تعویض زنگ‌های تولیدشده جا باز کن
    const sdOk = (csId, d, extra = 1) => (((subjDay.get(csId) && subjDay.get(csId).get(d)) || 0) + extra) <= maxPerDay;
    const planAt = (classId, d, p) => plan.find((pl) => pl.class_id === classId && pl.day === d && pl.period === p);
    const place = (x, d, p) => { mark(x.cs.class_id, x.cs.teacher_id, x.cs.id, d, p); plan.push({ class_id: x.cs.class_id, class_subject_id: x.cs.id, teacher_id: x.cs.teacher_id, day: d, period: p }); };
    const movePlan = (pl, d, p) => { unmark(pl.class_id, pl.teacher_id, pl.class_subject_id, pl.day, pl.period); pl.day = d; pl.period = p; mark(pl.class_id, pl.teacher_id, pl.class_subject_id, d, p); };
    const tryRepair = (x) => {
      const cid = x.cs.class_id, tid = x.cs.teacher_id; const un = ctx.unavailable.get(tid);
      for (const c of cells) {
        const k = key(c.d, c.p);
        if (un && un.has(k)) continue;
        if (!sdOk(x.cs.id, c.d)) continue;
        const ownBusy = classBusy.get(cid) && classBusy.get(cid).has(k);
        const otherClass = teacherBusy.get(tid) && teacherBusy.get(tid).get(k);
        if (!ownBusy && otherClass) {
          const s1 = planAt(otherClass, c.d, c.p); if (!s1) continue; // زنگ ثابت است
          // (الف) انتقال زنگ کلاس دیگر به خانهٔ آزاد
          unmark(s1.class_id, s1.teacher_id, s1.class_subject_id, s1.day, s1.period);
          const s1cs = subjById[s1.class_subject_id];
          let alt = null, altSc = Infinity;
          for (const c2 of cells) { if (c2.d === c.d && c2.p === c.p) continue; if (!free(s1.class_id, s1.teacher_id, c2.d, c2.p)) continue; const sc = score({ cs: s1cs }, c2.d, c2.p); if (sc != null && sc < altSc) { altSc = sc; alt = c2; } }
          if (alt) { s1.day = alt.d; s1.period = alt.p; mark(s1.class_id, s1.teacher_id, s1.class_subject_id, alt.d, alt.p); place(x, c.d, c.p); return true; }
          mark(s1.class_id, s1.teacher_id, s1.class_subject_id, s1.day, s1.period);
          // (ب) تعویض دو زنگ درون کلاس دیگر: s1 ↔ s2
          for (const s2 of plan) {
            if (s2.class_id !== otherClass || s2 === s1 || s2.teacher_id === tid) continue;
            const k2 = key(s2.day, s2.period);
            if (un && un.has(k2)) continue;
            // معلم ما (s1) باید در k2 آزاد باشد (به‌جز همین s1)، معلم s2 باید در k آزاد باشد (به‌جز همین s2)
            const tB = teacherBusy.get(tid); if (tB && tB.has(k2)) continue;
            const t2B = teacherBusy.get(s2.teacher_id); if (t2B && t2B.has(k) && !(t2B.get(k) === otherClass && s2.day === c.d && s2.period === c.p)) continue;
            const un2 = ctx.unavailable.get(s2.teacher_id); if (un2 && un2.has(k)) continue;
            if (!sdOk(s1.class_subject_id, s2.day, 1) && s2.day !== s1.day) continue;
            if (!sdOk(s2.class_subject_id, c.d, 1) && s2.day !== c.d) continue;
            unmark(s1.class_id, s1.teacher_id, s1.class_subject_id, s1.day, s1.period); unmark(s2.class_id, s2.teacher_id, s2.class_subject_id, s2.day, s2.period);
            const d1 = s1.day, p1 = s1.period; s1.day = s2.day; s1.period = s2.period; s2.day = d1; s2.period = p1;
            mark(s1.class_id, s1.teacher_id, s1.class_subject_id, s1.day, s1.period); mark(s2.class_id, s2.teacher_id, s2.class_subject_id, s2.day, s2.period);
            place(x, c.d, c.p); return true;
          }
        } else if (ownBusy && !otherClass) {
          // (ج) زنگ خودِ کلاس را به خانهٔ دیگری ببر و این خانه را به درس جامانده بده
          const s0 = planAt(cid, c.d, c.p); if (!s0 || s0.class_subject_id === x.cs.id) continue;
          const s0cs = subjById[s0.class_subject_id];
          unmark(s0.class_id, s0.teacher_id, s0.class_subject_id, s0.day, s0.period);
          let alt = null, altSc = Infinity;
          for (const c2 of cells) { if (c2.d === c.d && c2.p === c.p) continue; if (!free(cid, s0.teacher_id, c2.d, c2.p)) continue; const sc = score({ cs: s0cs }, c2.d, c2.p); if (sc != null && sc < altSc) { altSc = sc; alt = c2; } }
          if (alt) { s0.day = alt.d; s0.period = alt.p; mark(s0.class_id, s0.teacher_id, s0.class_subject_id, alt.d, alt.p); place(x, c.d, c.p); return true; }
          mark(s0.class_id, s0.teacher_id, s0.class_subject_id, s0.day, s0.period);
        }
      }
      return false;
    };
    for (let round = 0; round < 3; round++) for (const o of order) while (o.need > 0 && tryRepair(o.x)) o.need--;
    for (const o of order) if (o.need > 0) unplaced.push({ class_id: o.x.cs.class_id, class_title: classTitle[o.x.cs.class_id], class_subject_id: o.x.cs.id, title: o.x.cs.title, teacher_name: o.x.cs.teacher_name, missing: o.need, reason: reasonFor(o.x, ctx, classBusy, teacherBusy, cells) });
    // کیفیت: تعداد قرارگرفته (اصلی)، سپس کمینهٔ فاصله‌های خالی معلمان
    const gaps = teacherGaps(teacherBusy, days, periods);
    const quality = plan.length * 1000 - gaps;
    if (!best || quality > best.quality) best = { plan, unplaced, quality, gaps };
    if (!unplaced.length && gaps === 0) break;
  }
  for (const x of noTeacher) best.unplaced.push({ class_id: x.cs.class_id, class_title: classTitle[x.cs.class_id], class_subject_id: x.cs.id, title: x.cs.title, teacher_name: '', missing: x.need, reason: 'معلم تعیین نشده است' });
  const classesTouched = [...targets];
  return { ctx, mode, plan: best.plan, unplaced: best.unplaced, gaps: best.gaps, classes: classesTouched, kept: fixed.filter((s) => targets.has(s.class_id)).length, demand: demands.reduce((a, x) => a + x.need, 0) };
}

function reasonFor(x, ctx, classBusy, teacherBusy, cells) {
  const cid = x.cs.class_id, tid = x.cs.teacher_id;
  let classFull = 0, teacherFull = 0, unavailable = 0;
  const un = ctx.unavailable.get(tid);
  for (const c of cells) { const k = key(c.d, c.p); if (classBusy.get(cid) && classBusy.get(cid).has(k)) { classFull++; continue; } if (un && un.has(k)) { unavailable++; continue; } if (teacherBusy.get(tid) && teacherBusy.get(tid).has(k)) teacherFull++; }
  if (classFull === cells.length) return 'همهٔ زنگ‌های کلاس پر است';
  if (teacherFull + unavailable + classFull >= cells.length) return `معلم در زنگ‌های خالی کلاس مشغول (${J.toPersianDigits(teacherFull)}) یا در دسترس نیست (${J.toPersianDigits(unavailable)})`;
  return 'به‌دلیل سقف زنگ در روز یا تداخل‌های پی‌درپی جا نشد';
}
function teacherGaps(teacherBusy, days, periods) {
  let gaps = 0;
  for (const m of teacherBusy.values()) for (const d of days) { let first = -1, last = -1, n = 0; for (let p = 1; p <= periods; p++) if (m.has(key(d, p))) { if (first < 0) first = p; last = p; n++; } if (n) gaps += (last - first + 1) - n; }
  return gaps;
}
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** ثبت نتیجهٔ تولید در پایگاه داده (replace: پاک‌کردن برنامهٔ کلاس‌های هدف) */
async function apply(result) {
  const times = periodTimes();
  if (result.mode === 'replace') for (const cid of result.classes) await db.remove('schedule_slots', { class_id: cid });
  let n = 0;
  for (const pl of result.plan) {
    const exists = await db.table('schedule_slots').where({ class_id: pl.class_id, day_of_week: pl.day, period: pl.period }).first();
    if (exists) continue;
    const [start_time, end_time] = (times[pl.period - 1] || '').split('-');
    await db.insert('schedule_slots', { class_id: pl.class_id, class_subject_id: pl.class_subject_id, day_of_week: pl.day, period: pl.period, start_time: start_time || null, end_time: end_time || null, room_id: null, created_at: db.now() }); n++;
  }
  return n;
}

/** خلاصهٔ وضعیت برنامهٔ کلاس‌ها: نیاز، قرارگرفته، کسری — برای صفحهٔ فهرست و صفحهٔ تولید خودکار */
async function coverage(classIds = null, yearId = null) {
  const ctx = await loadContext({ classIds, yearId });
  const placed = {}; for (const s of ctx.slots) placed[s.class_subject_id] = (placed[s.class_subject_id] || 0) + 1;
  const byClass = {};
  for (const c of ctx.classes) byClass[c.id] = { class_id: c.id, title: c.title, grade_title: c.grade_title, need: 0, placed: 0, missing: [], over: [], no_teacher: [] };
  for (const s of ctx.subjects) {
    const b = byClass[s.class_id]; if (!b) continue;
    const need = Number(s.weekly_hours || 0), got = placed[s.id] || 0;
    b.need += need; b.placed += Math.min(got, need);
    if (!s.teacher_id) b.no_teacher.push(s.title);
    if (got < need) b.missing.push({ title: s.title, teacher_name: s.teacher_name, missing: need - got });
    if (got > need) b.over.push({ title: s.title, over: got - need });
  }
  const capacity = ctx.days.length * ctx.periods;
  return { classes: Object.values(byClass).map((b) => Object.assign(b, { capacity, pct: b.need ? Math.round((b.placed / b.need) * 100) : 0 })), capacity, days: ctx.days, periods: ctx.periods };
}

module.exports = { loadContext, slotInfo, checkPlacement, generate, apply, coverage, PERIODS, periodTimes, SCHOOL_DAYS };
