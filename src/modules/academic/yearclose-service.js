'use strict';
/**
 * پایان سال تحصیلی و ارتقای پایه:
 *  - plan(): ساخت نقشهٔ اجرا از ورودی فرم (بدون تغییر در پایگاه داده) + اعتبارسنجی
 *  - execute(): اجرای نقشه در یک تراکنش و ثبت تغییرات برای بازگردانی
 *  - revert(): بازگردانی آخرین اجرا در صورتی که دادهٔ جدیدی روی کلاس‌های ساخته‌شده ثبت نشده باشد
 */
const db = require('../../core/db');
const J = require('../../core/jalali');
const settings = require('../../core/settings');
const modules = require('../../core/modules');

const shiftYear = (iso, n) => { if (!iso) return null; const p = J.toJalaliParts(iso); if (!p) return null; const jd = Math.min(p.jd, J.monthLength(p.jy + n, p.jm)); return J.toGregorian(`${p.jy + n}/${p.jm}/${jd}`); };

async function context() {
  const source = await db.table('academic_years').where('is_current', 1).first();
  if (!source) return null;
  const grades = await db.table('grade_levels').orderBy('sort_order').orderBy('id').all();
  const classes = await db.table('classes as c').leftJoin('grade_levels as g', 'g.id', 'c.grade_level_id').leftJoin('teachers as t', 't.id', 'c.teacher_id').leftJoin('users as u', 'u.id', 't.user_id')
    .select('c.*', 'g.title as grade_title', 'g.sort_order as grade_sort', 'u.name as teacher_name', '(SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.status = \'active\') as student_count')
    .where('c.academic_year_id', source.id).where('c.is_active', 1).orderBy('g.sort_order').orderBy('c.title').all();
  const otherYears = await db.table('academic_years').where('id', '!=', source.id).orderBy('start_date', 'desc').all();
  const nextGradeOf = (gid) => { const i = grades.findIndex((g) => g.id === Number(gid)); return i >= 0 && i < grades.length - 1 ? grades[i + 1] : null; };
  const sp = J.toJalaliParts(source.start_date || J.todayISO());
  const defaults = { title: `${sp.jy + 1}-${sp.jy + 2}`, start_date: shiftYear(source.start_date, 1) || J.todayISO(), end_date: shiftYear(source.end_date, 1) || J.addDays(J.todayISO(), 300) };
  const terms = await db.table('terms').where('academic_year_id', source.id).orderBy('number').all();
  const lastRun = await db.table('year_close_runs').orderBy('id', 'desc').first();
  const warnings = [];
  const openTerms = terms.filter((t) => !Number(t.is_locked)).length;
  if (modules.isEnabled('exams.lock') && openTerms) warnings.push(`${J.toPersianDigits(openTerms)} نوبت از سال جاری هنوز قفل/نهایی نشده است؛ بهتر است پیش از پایان سال نمرات نهایی شوند.`);
  const unassigned = await db.table('students').where('status', 'active').whereNull('class_id').count();
  if (unassigned) warnings.push(`${J.toPersianDigits(unassigned)} دانش‌آموز فعال بدون کلاس هستند و در این فرایند تغییری نمی‌کنند.`);
  const otherYearClasses = await db.table('classes').where('academic_year_id', '!=', source.id).where('is_active', 1).count();
  if (otherYearClasses) warnings.push(`${J.toPersianDigits(otherYearClasses)} کلاس فعال متعلق به سال‌های دیگر وجود دارد.`);
  return { source, grades, classes, otherYears, nextGradeOf, defaults, terms, lastRun, warnings };
}

/** ساخت عنوان کلاس مقصد: «هفتم الف» → «هشتم الف» */
function nextTitle(title, fromGrade, toGrade) {
  if (!title) return toGrade ? toGrade.title : title;
  if (fromGrade && toGrade && title.includes(fromGrade.title)) return title.replace(fromGrade.title, toGrade.title);
  return toGrade ? `${toGrade.title} ${title}`.trim() : title;
}

/**
 * نقشهٔ اجرا از ورودی فرم:
 * body.target_mode: 'new' | 'existing'; body.target_year_id; body.year_title/start/end; body.copy_terms
 * body.cls[c<classId>][action] (پیشوند c چون qs کلیدهای عددی را آرایه می‌کند): 'promote' | 'graduate' | 'keep'; [title]; [grade_level_id]; [keep_teacher]; [copy_subjects]
 * body.entry_classes: '1' → ساخت کلاس‌های ورودی برای پایین‌ترین پایه با عنوان کلاس‌های فعلی آن پایه
 * body.retain: آرایهٔ شناسهٔ دانش‌آموزان تکرار پایه
 * body.archive_old, body.set_current, body.backup
 */
async function plan(body) {
  const ctx = await context();
  if (!ctx) throw new Error('سال تحصیلی جاری تعریف نشده است.');
  const errors = [];
  const P = {
    source: { id: ctx.source.id, title: ctx.source.title, start_date: ctx.source.start_date, end_date: ctx.source.end_date },
    target: null, copyTerms: body.copy_terms === '1', archiveOld: body.archive_old !== '0', setCurrent: body.set_current !== '0', backup: body.backup === '1',
    classes: [], entryClasses: [], retain: {}, graduates: [], counts: { promote: 0, graduate: 0, retain: 0, keep: 0, newClasses: 0 }
  };
  if (body.target_mode === 'existing') {
    const y = ctx.otherYears.find((x) => x.id === Number(body.target_year_id));
    if (!y) errors.push('سال مقصد انتخاب نشده است.');
    else P.target = { id: y.id, title: y.title, start_date: y.start_date, end_date: y.end_date, create: false };
  } else {
    const title = String(body.year_title || '').trim() || ctx.defaults.title;
    const start = body.year_start ? J.toGregorian(body.year_start) : ctx.defaults.start_date;
    const end = body.year_end ? J.toGregorian(body.year_end) : ctx.defaults.end_date;
    if (!start || !end) errors.push('تاریخ شروع/پایان سال جدید نامعتبر است.');
    else if (end <= start) errors.push('تاریخ پایان سال جدید باید بعد از شروع باشد.');
    if (await db.exists('academic_years', { title })) errors.push(`سال تحصیلی با عنوان «${title}» از قبل وجود دارد؛ گزینهٔ «سال موجود» را انتخاب کنید.`);
    P.target = { id: null, title, start_date: start, end_date: end, create: true };
  }
  const retainIds = new Set([].concat(body.retain || []).map(Number).filter(Boolean));
  const cls = body.cls || {};
  const lowest = ctx.grades[0];
  for (const c of ctx.classes) {
    const inp = cls['c' + c.id] || {};
    const next = ctx.nextGradeOf(c.grade_level_id);
    let action = inp.action || (next ? 'promote' : 'graduate');
    if (action === 'promote' && !next && !inp.grade_level_id) action = 'graduate';
    const item = { id: c.id, title: c.title, grade_level_id: c.grade_level_id, grade_title: c.grade_title, students: Number(c.student_count), teacher_id: c.teacher_id, teacher_name: c.teacher_name, action, keepTeacher: inp.keep_teacher !== '0', copySubjects: inp.copy_subjects !== '0' };
    if (action === 'promote') {
      const g = inp.grade_level_id ? ctx.grades.find((x) => x.id === Number(inp.grade_level_id)) : next;
      if (!g) { errors.push(`پایهٔ مقصد برای کلاس «${c.title}» مشخص نیست.`); continue; }
      item.newGradeId = g.id; item.newGradeTitle = g.title; item.newTitle = String(inp.title || '').trim() || nextTitle(c.title, ctx.grades.find((x) => x.id === c.grade_level_id), g);
      P.counts.newClasses++;
    }
    P.classes.push(item);
  }
  // کلاس‌های ورودی برای پایین‌ترین پایه
  if (body.entry_classes === '1' && lowest) {
    for (const c of ctx.classes.filter((x) => x.grade_level_id === lowest.id)) { P.entryClasses.push({ title: c.title, grade_level_id: lowest.id, grade_title: lowest.title, from_class_id: c.id, copySubjects: true, keepTeacher: false }); P.counts.newClasses++; }
  }
  // دانش‌آموزان تکرار پایه: مقصد = کلاسی در سال مقصد با همان پایه (کلاس ورودی یا کلاس ارتقایافته از پایهٔ پایین‌تر)
  const plannedByGrade = {};
  P.classes.filter((c) => c.action === 'promote').forEach((c) => { (plannedByGrade[c.newGradeId] = plannedByGrade[c.newGradeId] || []).push({ key: 'c' + c.id, title: c.newTitle }); });
  P.entryClasses.forEach((e, i) => { (plannedByGrade[e.grade_level_id] = plannedByGrade[e.grade_level_id] || []).push({ key: 'e' + i, title: e.title }); });
  if (retainIds.size) {
    const rows = await db.table('students').select('id', 'first_name', 'last_name', 'class_id', 'grade_level_id', 'student_number').whereIn('id', [...retainIds]).where('status', 'active').all();
    for (const s of rows) {
      const c = P.classes.find((x) => x.id === s.class_id);
      if (!c) continue;
      const choices = plannedByGrade[c.grade_level_id] || [];
      const want = (cls['c' + c.id] || {}).retain_target;
      const target = choices.find((x) => x.key === want) || choices[0];
      if (!target) { errors.push(`برای تکرار پایهٔ «${s.first_name} ${s.last_name}» کلاسی با پایهٔ ${c.grade_title} در سال مقصد ساخته نمی‌شود (گزینهٔ «کلاس‌های ورودی» را فعال کنید یا کلاس پایین‌تر را ارتقا دهید).`); continue; }
      P.retain[s.id] = { name: `${s.first_name} ${s.last_name}`, student_number: s.student_number, from_class_id: c.id, from_title: c.title, targetKey: target.key, targetTitle: target.title };
      P.counts.retain++;
    }
  }
  for (const c of P.classes) {
    const retainedHere = Object.values(P.retain).filter((r) => r.from_class_id === c.id).length;
    const movers = Math.max(0, c.students - retainedHere);
    if (c.action === 'promote') P.counts.promote += movers; else if (c.action === 'graduate') P.counts.graduate += movers; else P.counts.keep += movers;
    c.movers = movers; c.retained = retainedHere;
  }
  P.plannedByGrade = plannedByGrade;
  P.errors = errors;
  return P;
}

/** یافتن درس معادل در پایهٔ مقصد (عنوان یکسان، یا کد با پیشوند یکسان) */
async function matchSubject(tx, srcSubjectId, targetGradeId, cache) {
  const key = srcSubjectId + '|' + targetGradeId;
  if (cache.has(key)) return cache.get(key);
  const src = await tx.findById('subjects', srcSubjectId);
  let found = null;
  if (src) {
    if (src.grade_level_id === targetGradeId || !src.grade_level_id) found = src;
    if (!found) found = await tx.table('subjects').where('title', src.title).where('grade_level_id', targetGradeId).first();
    if (!found && src.code) { const prefix = String(src.code).replace(/\d+$/, ''); if (prefix) found = await tx.table('subjects').where('code', 'like', prefix + '%').where('grade_level_id', targetGradeId).first(); }
    if (!found) found = await tx.table('subjects').where('title', src.title).whereNull('grade_level_id').first();
  }
  cache.set(key, found);
  return found;
}

async function execute(P, userId) {
  if (!P || (P.errors && P.errors.length)) throw new Error('نقشهٔ اجرا معتبر نیست.');
  const fresh = await db.table('academic_years').where('is_current', 1).first();
  if (!fresh || fresh.id !== P.source.id) throw new Error('سال جاری تغییر کرده است؛ صفحه را دوباره باز کنید.');
  const now = db.now();
  const today = J.todayISO();
  const changes = { year: null, terms: [], classes: [], class_subjects: [], students: [], enrollments_new: [], enrollments_old: [], archived: [], current: null, settings: { current_year_id: settings.get('current_year_id') } };
  const summary = { promoted: 0, graduated: 0, retained: 0, kept: 0, classes: 0, subjects: 0, terms: 0 };
  const enrollmentsOn = modules.isEnabled('enrollments');
  const runId = await db.transaction(async (tx) => {
    // ۱) سال مقصد
    let targetId = P.target.id;
    if (P.target.create) {
      targetId = await tx.insert('academic_years', { title: P.target.title, start_date: P.target.start_date, end_date: P.target.end_date, is_current: 0, created_at: now, updated_at: now });
      changes.year = targetId;
    }
    const target = await tx.findById('academic_years', targetId);
    // ۲) نوبت‌ها
    if (P.copyTerms) {
      const srcTerms = await tx.table('terms').where('academic_year_id', P.source.id).orderBy('number').all();
      const have = await tx.table('terms').where('academic_year_id', targetId).count();
      if (!have) for (const t of srcTerms) { const id = await tx.insert('terms', { academic_year_id: targetId, title: t.title, number: t.number, start_date: shiftYear(t.start_date, 1), end_date: shiftYear(t.end_date, 1), is_current: 0, is_locked: 0, created_at: now, updated_at: now }); changes.terms.push(id); summary.terms++; }
    }
    // ۳) کلاس‌های جدید
    const newClassByKey = {};
    const subjCache = new Map();
    const makeClass = async (key, src, title, gradeId, keepTeacher, copySubjects) => {
      const id = await tx.insert('classes', { academic_year_id: targetId, grade_level_id: gradeId, title, teacher_id: keepTeacher ? src.teacher_id : null, room_id: src.room_id, capacity: src.capacity, shift: src.shift, description: src.description, is_active: 1, created_at: now, updated_at: now });
      changes.classes.push(id); summary.classes++; newClassByKey[key] = id;
      if (copySubjects) {
        const list = await tx.table('class_subjects').where('class_id', src.id).all();
        for (const cs of list) {
          const sub = await matchSubject(tx, cs.subject_id, gradeId, subjCache);
          if (!sub) continue;
          if (await tx.table('class_subjects').where({ class_id: id, subject_id: sub.id }).exists()) continue;
          const csId = await tx.insert('class_subjects', { class_id: id, subject_id: sub.id, teacher_id: keepTeacher ? cs.teacher_id : null, weekly_hours: sub.weekly_hours || cs.weekly_hours || 2, created_at: now });
          changes.class_subjects.push(csId); summary.subjects++;
        }
      }
      return id;
    };
    for (const c of P.classes) {
      if (c.action !== 'promote') continue;
      const src = await tx.findById('classes', c.id);
      await makeClass('c' + c.id, src, c.newTitle, c.newGradeId, c.keepTeacher, c.copySubjects);
    }
    for (let i = 0; i < P.entryClasses.length; i++) {
      const e = P.entryClasses[i]; const src = await tx.findById('classes', e.from_class_id);
      await makeClass('e' + i, src, e.title, e.grade_level_id, false, true);
    }
    // ۴) دانش‌آموزان
    /** بستن ردیف سال مبدأ (یا ساخت آن اگر وجود نداشت تا سابقه کامل بماند) */
    const closeSource = async (s, status, note) => {
      if (!enrollmentsOn) return;
      const old = await tx.table('enrollments').where({ student_id: s.id, academic_year_id: P.source.id }).first();
      if (old) { changes.enrollments_old.push({ id: old.id, status: old.status, left_at: old.left_at, note: old.note }); await tx.update('enrollments', { status, left_at: P.source.end_date || today, note, updated_at: now }, { id: old.id }); return; }
      const from = s.class_id ? await classMeta(s.class_id) : null;
      const nid = await tx.insert('enrollments', { student_id: s.id, academic_year_id: P.source.id, class_id: from ? from.id : null, class_title: from ? from.title : null, grade_level_id: from ? from.grade_level_id : s.grade_level_id, grade_title: from ? from.grade_title : null, status, enrolled_at: P.source.start_date || today, left_at: P.source.end_date || today, note, created_at: now, updated_at: now });
      changes.enrollments_new.push(nid);
    };
    const classMeta = async (id) => { const c = await tx.table('classes as c').leftJoin('grade_levels as g', 'g.id', 'c.grade_level_id').select('c.id', 'c.title', 'c.grade_level_id', 'g.title as grade_title').where('c.id', id).first(); return c; };
    const moveStudent = async (s, toClassId, oldStatus, note) => {
      const to = await classMeta(toClassId);
      changes.students.push({ id: s.id, class_id: s.class_id, grade_level_id: s.grade_level_id, status: s.status });
      await tx.update('students', { class_id: to.id, grade_level_id: to.grade_level_id, updated_at: now }, { id: s.id });
      await closeSource(s, oldStatus, note);
      if (enrollmentsOn) {
        const exist = await tx.table('enrollments').where({ student_id: s.id, academic_year_id: targetId }).first();
        if (!exist) { const nid = await tx.insert('enrollments', { student_id: s.id, academic_year_id: targetId, class_id: to.id, class_title: to.title, grade_level_id: to.grade_level_id, grade_title: to.grade_title, status: 'active', enrolled_at: target.start_date || today, left_at: null, note: note, created_at: now, updated_at: now }); changes.enrollments_new.push(nid); }
      }
    };
    for (const c of P.classes) {
      const students = await tx.table('students').where('class_id', c.id).where('status', 'active').all();
      for (const s of students) {
        const r = P.retain[s.id];
        if (r) { await moveStudent(s, newClassByKey[r.targetKey], 'retained', 'تکرار پایه — پایان سال ' + P.source.title); summary.retained++; continue; }
        if (c.action === 'promote') { await moveStudent(s, newClassByKey['c' + c.id], 'promoted', 'ارتقا — پایان سال ' + P.source.title); summary.promoted++; }
        else if (c.action === 'graduate') {
          changes.students.push({ id: s.id, class_id: s.class_id, grade_level_id: s.grade_level_id, status: s.status });
          await closeSource(s, 'graduated', 'فارغ‌التحصیلی — پایان سال ' + P.source.title);
          await tx.update('students', { status: 'graduated', class_id: null, updated_at: now }, { id: s.id });
          summary.graduated++;
        } else summary.kept++;
      }
    }
    // ۵) بایگانی کلاس‌های قدیمی (کلاس‌هایی که ارتقا یافته یا فارغ‌التحصیل شده‌اند)
    if (P.archiveOld) for (const c of P.classes) { if (c.action === 'keep') continue; await tx.update('classes', { is_active: 0, updated_at: now }, { id: c.id }); changes.archived.push(c.id); }
    // ۶) سال جاری
    if (P.setCurrent) {
      const curTerm = await tx.table('terms').where('is_current', 1).first(); changes.current = { old_year: P.source.id, old_term: curTerm ? curTerm.id : null };
      await tx.table('academic_years').update({ is_current: 0 });
      await tx.update('academic_years', { is_current: 1, updated_at: now }, { id: targetId });
      await tx.table('terms').update({ is_current: 0 });
      const first = await tx.table('terms').where('academic_year_id', targetId).orderBy('number').first();
      if (first) await tx.update('terms', { is_current: 1 }, { id: first.id });
    }
    changes.target = targetId;
    return tx.insert('year_close_runs', { source_year_id: P.source.id, target_year_id: targetId, created_year: P.target.create ? 1 : 0, summary: JSON.stringify(summary), changes: JSON.stringify(changes), status: 'done', created_by: userId || null, created_at: now });
  });
  if (P.setCurrent) await settings.set('current_year_id', String(changes.target));
  return { runId, summary, targetId: changes.target };
}

/** بررسی امکان بازگردانی: روی کلاس‌های ساخته‌شده نباید دادهٔ جدید ثبت شده باشد */
async function revertBlockers(run) {
  const ch = JSON.parse(run.changes || '{}');
  const blockers = [];
  if (run.status !== 'done') blockers.push('این اجرا قبلاً بازگردانی شده است.');
  const latest = await db.table('year_close_runs').orderBy('id', 'desc').first();
  if (latest && latest.id !== run.id) blockers.push('فقط آخرین اجرا قابل بازگردانی است.');
  const ids = ch.classes || [];
  if (ids.length) {
    const checks = [['attendance', 'class_id', 'حضور و غیاب'], ['exams', 'class_id', 'آزمون'], ['homework', 'class_id', 'تکلیف'], ['lesson_logs', 'class_id', 'گزارش تدریس'], ['schedule_slots', 'class_id', 'برنامهٔ هفتگی']];
    for (const [t, col, label] of checks) { try { const n = await db.table(t).whereIn(col, ids).count(); if (n) blockers.push(`${J.toPersianDigits(n)} رکورد ${label} روی کلاس‌های جدید ثبت شده است.`); } catch (e) { /* جدول ممکن است وجود نداشته باشد */ } }
    const newStudents = await db.table('students').whereIn('class_id', ids).whereNotIn('id', (ch.students || []).map((s) => s.id)).count();
    if (newStudents) blockers.push(`${J.toPersianDigits(newStudents)} دانش‌آموز جدید در کلاس‌های سال جدید ثبت‌نام شده‌اند.`);
  }
  if (ch.year) { const other = await db.table('classes').where('academic_year_id', ch.year).whereNotIn('id', ids.length ? ids : [-1]).count(); if (other) blockers.push('در سال جدید کلاس‌های دیگری به‌صورت دستی ساخته شده‌اند.'); }
  return blockers;
}

async function revert(run, userId) {
  const blockers = await revertBlockers(run);
  if (blockers.length) throw new Error(blockers.join(' '));
  const ch = JSON.parse(run.changes || '{}');
  const now = db.now();
  await db.transaction(async (tx) => {
    for (const s of ch.students || []) await tx.update('students', { class_id: s.class_id, grade_level_id: s.grade_level_id, status: s.status, updated_at: now }, { id: s.id });
    if ((ch.enrollments_new || []).length) await tx.table('enrollments').whereIn('id', ch.enrollments_new).delete();
    for (const e of ch.enrollments_old || []) await tx.update('enrollments', { status: e.status, left_at: e.left_at, note: e.note, updated_at: now }, { id: e.id });
    for (const id of ch.archived || []) await tx.update('classes', { is_active: 1, updated_at: now }, { id });
    if ((ch.class_subjects || []).length) await tx.table('class_subjects').whereIn('id', ch.class_subjects).delete();
    if ((ch.classes || []).length) { await tx.table('schedule_slots').whereIn('class_id', ch.classes).delete(); await tx.table('classes').whereIn('id', ch.classes).delete(); }
    if ((ch.terms || []).length) await tx.table('terms').whereIn('id', ch.terms).delete();
    if (ch.year) await tx.table('academic_years').where('id', ch.year).delete();
    if (ch.current) {
      await tx.table('academic_years').update({ is_current: 0 });
      await tx.update('academic_years', { is_current: 1, updated_at: now }, { id: ch.current.old_year });
      await tx.table('terms').update({ is_current: 0 });
      if (ch.current.old_term) await tx.update('terms', { is_current: 1 }, { id: ch.current.old_term });
    }
    await tx.update('year_close_runs', { status: 'reverted', reverted_at: now, reverted_by: userId || null }, { id: run.id });
  });
  if (ch.current) await settings.set('current_year_id', String(ch.current.old_year));
  return true;
}

module.exports = { context, plan, execute, revert, revertBlockers, nextTitle, shiftYear };
